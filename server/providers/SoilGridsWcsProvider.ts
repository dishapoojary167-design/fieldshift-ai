import type { GeoCoordinates, SoilDepthLayer, SoilMeasurementStats } from '../../shared/index.ts';
import { env } from '../config/env.ts';
import { ExternalServiceError } from '../errors/AppError.ts';
import { parseSingleBandInt16Tiff } from '../utils/binaryImageDecoders.ts';
import type { FetchLike } from '../utils/resilientHttp.ts';
import {
  assertCentroidSamplingSupported,
  type SpatialProviderOptions,
} from '../utils/spatialRequest.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import type { ISoilGridsProvider, SoilGridsProviderResult } from './ISoilGridsProvider.ts';
import {
  createEmptyDepthLayer,
  finalizeDepthLayers,
  scaleSoilGridsValue,
  SOILGRIDS_DEPTHS,
  SOILGRIDS_PROPERTY_META,
  type SoilGridsPropertyName,
} from './soilGridsShared.ts';

export interface SoilGridsWcsProviderOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
  concurrency?: number;
}

const WCS_PROPERTIES: readonly SoilGridsPropertyName[] = [
  'phh2o',
  'soc',
  'nitrogen',
  'sand',
  'silt',
  'clay',
  'bdod',
  'cec',
];

type WcsStatName = 'mean' | 'Q0.05' | 'Q0.95' | 'uncertainty';

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function setLayerProperty(
  layer: SoilDepthLayer,
  prop: SoilGridsPropertyName,
  stat: SoilMeasurementStats,
): void {
  switch (prop) {
    case 'phh2o':
      layer.ph = stat;
      break;
    case 'soc':
      layer.organicCarbonGKg = stat;
      break;
    case 'nitrogen':
      layer.nitrogenGKg = stat;
      break;
    case 'sand':
      layer.sandPercent = stat;
      break;
    case 'silt':
      layer.siltPercent = stat;
      break;
    case 'clay':
      layer.clayPercent = stat;
      break;
    case 'bdod':
      layer.bulkDensityKgDm3 = stat;
      break;
    case 'cec':
      layer.cecCmolKg = stat;
      break;
  }
}

/**
 * Fallback ISRIC SoilGrids provider using OGC WCS 2.0.1 GeoTIFF point subsets
 * served by maps.isric.org when rest.isric.org is throttled or unavailable.
 */
export class SoilGridsWcsProvider implements ISoilGridsProvider {
  public readonly providerId = 'soilgrids-wcs-fallback';
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cache: TtlCache<SoilGridsProviderResult>;

  constructor(options: SoilGridsWcsProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.soilGridsWcsBaseUrl).replace(/\?+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? env.soilHttpTimeoutMs;
    this.concurrency = options.concurrency ?? 12;
    this.cache = new TtlCache<SoilGridsProviderResult>(
      options.cacheTtlMs ?? env.soilCacheTtlMs,
      200,
    );
  }

  private buildCoverageUrl(
    location: GeoCoordinates,
    prop: SoilGridsPropertyName,
    depthLabel: string,
    stat: WcsStatName,
  ): string {
    const halfBox = 0.0015;
    const minLon = Math.max(-180, location.longitude - halfBox).toFixed(5);
    const maxLon = Math.min(180, location.longitude + halfBox).toFixed(5);
    const minLat = Math.max(-85, location.latitude - halfBox).toFixed(5);
    const maxLat = Math.min(85, location.latitude + halfBox).toFixed(5);

    const url = new URL(this.baseUrl);
    url.searchParams.set('map', `/map/${prop}.map`);
    url.searchParams.set('SERVICE', 'WCS');
    url.searchParams.set('VERSION', '2.0.1');
    url.searchParams.set('REQUEST', 'GetCoverage');
    url.searchParams.set('COVERAGEID', `${prop}_${depthLabel}_${stat}`);
    url.searchParams.set('FORMAT', 'image/tiff');
    url.searchParams.append('SUBSET', `Long(${minLon},${maxLon})`);
    url.searchParams.append('SUBSET', `Lat(${minLat},${maxLat})`);
    url.searchParams.set('SUBSETTINGCRS', 'http://www.opengis.net/def/crs/EPSG/0/4326');
    return url.toString();
  }

  private async fetchCoverageScalar(
    location: GeoCoordinates,
    prop: SoilGridsPropertyName,
    depthLabel: string,
    stat: WcsStatName,
  ): Promise<number | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(this.buildCoverageUrl(location, prop, depthLabel, stat), {
          headers: {
            'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
            continue;
          }
          return null;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const arrayBuf = await response.arrayBuffer();
        const buf = Buffer.from(arrayBuf);

        if (contentType.includes('xml') || buf.subarray(0, 5).toString('ascii') === '<?xml') {
          return null;
        }

        const parsed = parseSingleBandInt16Tiff(buf);
        return parsed.value;
      } catch {
        if (attempt === 0) {
          continue;
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async fetchDepthProfile(
    location: GeoCoordinates,
    options?: SpatialProviderOptions,
  ): Promise<SoilGridsProviderResult> {
    assertCentroidSamplingSupported(options, this.providerId);

    const cacheKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        sourceAttribution: {
          ...cached.sourceAttribution,
          cached: true,
        },
      };
    }

    // Fast preflight check on surface pH and bulk density to detect ocean/masked pixels or WCS outage
    const [probePh, probeBdod] = await Promise.all([
      this.fetchCoverageScalar(location, 'phh2o', '0-5cm', 'mean'),
      this.fetchCoverageScalar(location, 'bdod', '0-5cm', 'mean'),
    ]);

    if (probePh === null && probeBdod === null) {
      throw new ExternalServiceError('ISRIC SoilGrids WCS coverage endpoint did not return raster data.');
    }

    if ((probePh === 0 || probePh === null) && (probeBdod === 0 || probeBdod === null)) {
      const emptyLayers = SOILGRIDS_DEPTHS.map((d) =>
        createEmptyDepthLayer(d.interval, d.topCm, d.bottomCm),
      );
      return {
        status: 'unavailable',
        providerUsed: 'soilgrids-wcs-fallback',
        fallbackUsed: true,
        depthLayers: emptyLayers,
        sourceAttribution: {
          id: 'isric-soilgrids-wcs',
          name: 'ISRIC SoilGrids v2.0 (OGC WCS Fallback)',
          attribution: 'ISRIC — World Soil Information (SoilGrids WCS 2.0.1 GeoTIFF)',
          url: this.baseUrl,
          cached: false,
          retrievedAt: new Date().toISOString(),
        },
        caveats: [
          'No soil coverage reported at this coordinate (may correspond to water body, glacier, or unmapped urban mask).',
        ],
      };
    }

    const statMatrix = new Map<string, SoilMeasurementStats>();
    for (const depth of SOILGRIDS_DEPTHS) {
      for (const prop of WCS_PROPERTIES) {
        const meta = SOILGRIDS_PROPERTY_META[prop];
        statMatrix.set(`${depth.label}:${prop}`, {
          mean: null,
          q05: null,
          q95: null,
          uncertainty: null,
          unit: meta.unit,
        });
      }
    }

    // Pre-populate probed 0-5cm phh2o mean
    const phTop = statMatrix.get('0-5cm:phh2o')!;
    phTop.mean = scaleSoilGridsValue(
      probePh,
      SOILGRIDS_PROPERTY_META.phh2o.dFactor,
      SOILGRIDS_PROPERTY_META.phh2o.decimals,
    );

    const tasks: Array<() => Promise<void>> = [];
    const statsToFetch: readonly WcsStatName[] = ['mean', 'Q0.05', 'Q0.95', 'uncertainty'];

    for (const depth of SOILGRIDS_DEPTHS) {
      for (const prop of WCS_PROPERTIES) {
        const meta = SOILGRIDS_PROPERTY_META[prop];
        const target = statMatrix.get(`${depth.label}:${prop}`)!;
        for (const statName of statsToFetch) {
          if (prop === 'phh2o' && depth.label === '0-5cm' && statName === 'mean') {
            continue;
          }
          tasks.push(async () => {
            const raw = await this.fetchCoverageScalar(location, prop, depth.label, statName);
            if (statName === 'mean') {
              target.mean = scaleSoilGridsValue(raw, meta.dFactor, meta.decimals);
            } else if (statName === 'Q0.05') {
              target.q05 = scaleSoilGridsValue(raw, meta.dFactor, meta.decimals);
            } else if (statName === 'Q0.95') {
              target.q95 = scaleSoilGridsValue(raw, meta.dFactor, meta.decimals);
            } else {
              target.uncertainty =
                raw !== null && Number.isFinite(raw) && raw >= 0
                  ? Number((raw / 10).toFixed(2))
                  : null;
            }
          });
        }
      }
    }

    await runWithConcurrency(tasks, this.concurrency);

    const rawLayers = SOILGRIDS_DEPTHS.map((depth) => {
      const layer = createEmptyDepthLayer(depth.interval, depth.topCm, depth.bottomCm);
      for (const prop of WCS_PROPERTIES) {
        const stat = statMatrix.get(`${depth.label}:${prop}`);
        if (stat) {
          setLayerProperty(layer, prop, stat);
        }
      }
      return layer;
    });

    const { layers, hasAnySoilData, isComplete } = finalizeDepthLayers(rawLayers);
    const retrievedAt = new Date().toISOString();

    const result: SoilGridsProviderResult = {
      status: !hasAnySoilData ? 'unavailable' : isComplete ? 'available' : 'partial',
      providerUsed: 'soilgrids-wcs-fallback',
      fallbackUsed: true,
      depthLayers: layers,
      sourceAttribution: {
        id: 'isric-soilgrids-wcs',
        name: 'ISRIC SoilGrids v2.0 (OGC WCS Fallback)',
        attribution: 'ISRIC — World Soil Information (SoilGrids WCS 2.0.1 GeoTIFF)',
        url: this.baseUrl,
        cached: false,
        retrievedAt,
      },
      caveats: hasAnySoilData
        ? [
            'Retrieved via ISRIC OGC WCS 2.0.1 GeoTIFF coverage service because SoilGrids REST v2.0 was unavailable or throttled.',
            'Values are 250 m spatial predictions from machine-learning soil mapping, not direct laboratory measurements.',
          ]
        : [
            'No soil coverage reported at this coordinate (may correspond to water body, glacier, or unmapped urban mask).',
          ],
    };

    if (hasAnySoilData) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }
}
