import type { GeoCoordinates, SoilDepthLayer, SoilMeasurementStats } from '../../shared/index.ts';
import { env } from '../config/env.ts';
import { fetchJsonWithRetry, type FetchLike } from '../utils/resilientHttp.ts';
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

interface SoilGridsRestResponse {
  properties?: {
    layers?: Array<{
      name?: string;
      unit_measure?: {
        d_factor?: number;
      };
      depths?: Array<{
        label?: string;
        values?: {
          mean?: number | null;
          'Q0.05'?: number | null;
          'Q0.95'?: number | null;
          uncertainty?: number | null;
        };
      }>;
    }>;
  };
}

export interface SoilGridsRestProviderOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

const PROPERTY_BATCH_A: readonly SoilGridsPropertyName[] = ['phh2o', 'soc', 'nitrogen', 'bdod'];
const PROPERTY_BATCH_B: readonly SoilGridsPropertyName[] = ['sand', 'silt', 'clay', 'cec'];

function assignStatToLayer(
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

export class SoilGridsRestProvider implements ISoilGridsProvider {
  public readonly providerId = 'soilgrids-rest-v2';
  private readonly baseUrl: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;
  private readonly cache: TtlCache<SoilGridsProviderResult>;

  constructor(options: SoilGridsRestProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.soilGridsBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? Math.min(env.soilHttpTimeoutMs, 3_500);
    this.cache = new TtlCache<SoilGridsProviderResult>(
      options.cacheTtlMs ?? env.soilCacheTtlMs,
      200,
    );
  }

  private buildQueryUrl(
    location: GeoCoordinates,
    properties: readonly SoilGridsPropertyName[],
  ): string {
    const url = new URL(`${this.baseUrl}/properties/query`);
    url.searchParams.set('lon', location.longitude.toFixed(5));
    url.searchParams.set('lat', location.latitude.toFixed(5));
    for (const prop of properties) {
      url.searchParams.append('property', prop);
    }
    for (const depth of SOILGRIDS_DEPTHS) {
      url.searchParams.append('depth', depth.label);
    }
    for (const stat of ['mean', 'Q0.05', 'Q0.95', 'uncertainty']) {
      url.searchParams.append('value', stat);
    }
    return url.toString();
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

    const [batchA, batchB] = await Promise.all([
      fetchJsonWithRetry<SoilGridsRestResponse>(this.buildQueryUrl(location, PROPERTY_BATCH_A), {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        maxRetries: 0,
        serviceName: 'ISRIC SoilGrids REST v2.0',
      }),
      fetchJsonWithRetry<SoilGridsRestResponse>(this.buildQueryUrl(location, PROPERTY_BATCH_B), {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        maxRetries: 0,
        serviceName: 'ISRIC SoilGrids REST v2.0',
      }),
    ]);

    const layerMap = new Map<string, SoilDepthLayer>();
    for (const d of SOILGRIDS_DEPTHS) {
      layerMap.set(d.label, createEmptyDepthLayer(d.interval, d.topCm, d.bottomCm));
    }

    const allLayers = [
      ...(batchA.properties?.layers ?? []),
      ...(batchB.properties?.layers ?? []),
    ];

    for (const apiLayer of allLayers) {
      const propName = apiLayer.name as SoilGridsPropertyName | undefined;
      if (!propName || !(propName in SOILGRIDS_PROPERTY_META)) {
        continue;
      }
      const meta = SOILGRIDS_PROPERTY_META[propName];
      const dFactor = apiLayer.unit_measure?.d_factor ?? meta.dFactor;

      for (const depthEntry of apiLayer.depths ?? []) {
        const target = depthEntry.label ? layerMap.get(depthEntry.label) : undefined;
        if (!target || !depthEntry.values) {
          continue;
        }
        const rawMean = depthEntry.values.mean;
        const rawQ05 = depthEntry.values['Q0.05'];
        const rawQ95 = depthEntry.values['Q0.95'];
        const rawUnc = depthEntry.values.uncertainty;

        const stat: SoilMeasurementStats = {
          mean: scaleSoilGridsValue(rawMean, dFactor, meta.decimals),
          q05: scaleSoilGridsValue(rawQ05, dFactor, meta.decimals),
          q95: scaleSoilGridsValue(rawQ95, dFactor, meta.decimals),
          uncertainty:
            rawUnc !== null && rawUnc !== undefined && Number.isFinite(rawUnc)
              ? Number((rawUnc / 10).toFixed(2))
              : null,
          unit: meta.unit,
        };

        assignStatToLayer(target, propName, stat);
      }
    }

    const orderedLayers = SOILGRIDS_DEPTHS.map((d) => layerMap.get(d.label)!);
    const { layers, hasAnySoilData, isComplete } = finalizeDepthLayers(orderedLayers);
    const retrievedAt = new Date().toISOString();

    const result: SoilGridsProviderResult = {
      status: !hasAnySoilData ? 'unavailable' : isComplete ? 'available' : 'partial',
      providerUsed: 'soilgrids-rest-v2',
      fallbackUsed: false,
      depthLayers: layers,
      sourceAttribution: {
        id: 'isric-soilgrids-rest',
        name: 'ISRIC SoilGrids v2.0 (REST API)',
        attribution: 'ISRIC — World Soil Information (SoilGrids 250 m v2.0, CC-BY 4.0)',
        url: 'https://rest.isric.org/soilgrids/v2.0',
        cached: false,
        retrievedAt,
      },
      caveats: hasAnySoilData
        ? [
            'Values are 250 m spatial predictions from machine-learning soil mapping, not direct laboratory measurements of your parcel.',
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
