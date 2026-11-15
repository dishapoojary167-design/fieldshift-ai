import type {
  DateRange,
  GeoCoordinates,
  SmapDailyMoisturePoint,
  SoilMoistureSnapshot,
} from '../../shared/index.ts';
import { env } from '../config/env.ts';
import {
  extractPngPixelRgba,
  latLonToWebMercatorTilePixel,
} from '../utils/binaryImageDecoders.ts';
import type { FetchLike } from '../utils/resilientHttp.ts';
import {
  resolveSpatialRequestContext,
  type SpatialProviderOptions,
} from '../utils/spatialRequest.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import type { ISoilMoistureProvider } from './ISoilMoistureProvider.ts';

interface ColormapBin {
  rgbKey: string;
  min: number;
  max: number | null;
  midpoint: number;
}

export interface NasaSmapMoistureProviderOptions {
  gibsBaseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

const SURFACE_LAYER_ID = 'SMAP_L4_Analyzed_Surface_Soil_Moisture';
const ROOT_ZONE_LAYER_ID = 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture';
const COLORMAP_PATH = '/colormaps/v1.3/SMAP_Analyzed_Soil_Moisture.xml';
const SMAP_ZOOM_LEVEL = 6;
const MAX_SERIES_DAYS = 7;

function buildDefaultDates(dateRange?: DateRange): string[] {
  // NASA SMAP L4 typically lags ~3-4 days behind UTC current day on GIBS
  const fallbackEnd = new Date();
  fallbackEnd.setUTCDate(fallbackEnd.getUTCDate() - 4);
  const endStr = dateRange?.endDate ?? fallbackEnd.toISOString().slice(0, 10);

  const endMs = Date.parse(`${endStr}T00:00:00Z`);
  if (!Number.isFinite(endMs)) {
    return [fallbackEnd.toISOString().slice(0, 10)];
  }

  let count = MAX_SERIES_DAYS;
  if (dateRange?.startDate) {
    const startMs = Date.parse(`${dateRange.startDate}T00:00:00Z`);
    if (Number.isFinite(startMs) && startMs <= endMs) {
      const diff = Math.floor((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
      count = Math.min(MAX_SERIES_DAYS, Math.max(1, diff));
    }
  }

  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endMs);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function parseGibsColormapXml(xmlText: string): Map<string, ColormapBin> {
  const map = new Map<string, ColormapBin>();
  const regex = /<ColorMapEntry\s+([^>]+)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xmlText)) !== null) {
    const attrs = match[1];
    if (attrs.includes('nodata="true"') || attrs.includes('transparent="true"')) {
      continue;
    }
    const rgbMatch = attrs.match(/rgb="([^"]+)"/);
    const valMatch = attrs.match(/value="([^"]+)"/);
    if (!rgbMatch || !valMatch) {
      continue;
    }

    const rangeRaw = valMatch[1].replace(/^[\[(]/, '').replace(/[\])]$/, '');
    const [minStr, maxStr] = rangeRaw.split(',');
    const min = Number.parseFloat(minStr);
    const max = maxStr && !maxStr.includes('INF') ? Number.parseFloat(maxStr) : null;
    if (!Number.isFinite(min)) {
      continue;
    }
    const midpoint =
      max !== null && Number.isFinite(max)
        ? Number(((min + max) / 2).toFixed(3))
        : Number(min.toFixed(3));

    map.set(rgbMatch[1], {
      rgbKey: rgbMatch[1],
      min: Number(min.toFixed(3)),
      max: max !== null && Number.isFinite(max) ? Number(max.toFixed(3)) : null,
      midpoint,
    });
  }

  return map;
}

/**
 * Queries NASA GIBS SMAP L4 Analyzed Surface (0–5 cm) and Root-Zone (0–100 cm)
 * WMTS tiles and maps exact pixel RGB values via NASA's official GIBS ColorMap v1.3 XML
 * into volumetric soil moisture (m³/m³).
 */
export class NasaSmapMoistureProvider implements ISoilMoistureProvider {
  public readonly providerId = 'nasa-smap-l4-gibs';
  private readonly gibsBaseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly colormapCache: TtlCache<Map<string, ColormapBin>>;
  private readonly snapshotCache: TtlCache<SoilMoistureSnapshot>;

  constructor(options: NasaSmapMoistureProviderOptions = {}) {
    this.gibsBaseUrl = (options.gibsBaseUrl ?? env.gibsWmtsBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? env.soilHttpTimeoutMs;
    const ttl = options.cacheTtlMs ?? env.soilCacheTtlMs;
    this.colormapCache = new TtlCache<Map<string, ColormapBin>>(24 * 60 * 60 * 1000, 4);
    this.snapshotCache = new TtlCache<SoilMoistureSnapshot>(ttl, 200);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, {
        headers: {
          'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getColormap(): Promise<Map<string, ColormapBin>> {
    const cached = this.colormapCache.get('smap-v1.3');
    if (cached) {
      return cached;
    }

    const res = await this.fetchWithTimeout(`${this.gibsBaseUrl}${COLORMAP_PATH}`);
    if (!res.ok) {
      throw new Error(`NASA GIBS SMAP colormap returned HTTP ${res.status}.`);
    }
    const xml = await res.text();
    const parsed = parseGibsColormapXml(xml);
    if (parsed.size === 0) {
      throw new Error('NASA GIBS SMAP colormap XML contained no valid soil moisture entries.');
    }
    this.colormapCache.set('smap-v1.3', parsed);
    return parsed;
  }

  private async sampleLayerAtDate(
    layerId: string,
    date: string,
    z: number,
    x: number,
    y: number,
    px: number,
    py: number,
    colormap: Map<string, ColormapBin>,
  ): Promise<{ value: number | null; range: [number, number] | null }> {
    const url = `${this.gibsBaseUrl}/wmts/epsg3857/best/${layerId}/default/${date}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;

    try {
      const res = await this.fetchWithTimeout(url);
      if (!res.ok) {
        return { value: null, range: null };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const pixel = extractPngPixelRgba(buf, px, py);
      if (pixel.a === 0) {
        return { value: null, range: null };
      }
      const key = `${pixel.r},${pixel.g},${pixel.b}`;
      const bin = colormap.get(key);
      if (!bin) {
        return { value: null, range: null };
      }
      return {
        value: bin.midpoint,
        range: [bin.min, bin.max ?? bin.min],
      };
    } catch {
      return { value: null, range: null };
    }
  }

  async fetchSoilMoisture(
    location: GeoCoordinates,
    options?: SpatialProviderOptions & {
      dateRange?: DateRange;
    },
  ): Promise<SoilMoistureSnapshot> {
    const spatial = resolveSpatialRequestContext(
      {
        location,
        boundary: options?.boundary,
        geometry: options?.geometry,
        bbox: options?.bbox,
        spatialProcessingMode: options?.spatialProcessingMode,
      },
      this.providerId,
    );
    const targetLocation = spatial.targetLocation;

    const dates = buildDefaultDates(options?.dateRange);
    const cacheKey = `${targetLocation.latitude.toFixed(3)},${targetLocation.longitude.toFixed(3)}:${dates[0]}:${dates[dates.length - 1]}`;
    const cached = this.snapshotCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        boundaryContext: spatial.boundaryContext,
        spatialProcessing: spatial.spatialProcessing,
        sourceAttribution: {
          ...cached.sourceAttribution,
          cached: true,
        },
      };
    }

    const retrievedAt = new Date().toISOString();

    let colormap: Map<string, ColormapBin>;
    try {
      colormap = await this.getColormap();
    } catch (err) {
      return {
        location: targetLocation,
        boundaryContext: spatial.boundaryContext,
        spatialProcessing: spatial.spatialProcessing,
        dataClassification: 'satellite_derived',
        status: 'unavailable',
        product: 'NASA SMAP L4 Global 9 km Analyzed Surface & Root-Zone Soil Moisture (SPL4SMGP)',
        units: 'm³/m³',
        observationDate: null,
        surfaceMoistureM3M3: null,
        rootZoneMoistureM3M3: null,
        surfaceMoistureBinM3M3: null,
        rootZoneMoistureBinM3M3: null,
        moistureSeries: dates.map((date) => ({
          date,
          surfaceMoistureM3M3: null,
          surfaceMoistureRangeM3M3: null,
          rootZoneMoistureM3M3: null,
          rootZoneMoistureRangeM3M3: null,
        })),
        retrievalConfidenceNote:
          'NASA GIBS SMAP L4 tile colormap could not be retrieved; no soil moisture values fabricated.',
        sourceAttribution: {
          id: 'nasa-smap-l4-gibs',
          name: 'NASA SMAP L4 (GIBS WMTS)',
          attribution: 'NASA EOSDIS / NSIDC SMAP L4 Analyzed Soil Moisture via GIBS',
          url: `${this.gibsBaseUrl}/wmts/epsg3857/best/`,
          cached: false,
          retrievedAt,
        },
        message: err instanceof Error ? err.message : 'SMAP L4 colormap unavailable.',
        retrievedAt,
      };
    }

    const { z, x, y, px, py } = latLonToWebMercatorTilePixel(
      targetLocation.latitude,
      targetLocation.longitude,
      SMAP_ZOOM_LEVEL,
    );

    const series: SmapDailyMoisturePoint[] = await Promise.all(
      dates.map(async (date) => {
        const [surface, rootZone] = await Promise.all([
          this.sampleLayerAtDate(SURFACE_LAYER_ID, date, z, x, y, px, py, colormap),
          this.sampleLayerAtDate(ROOT_ZONE_LAYER_ID, date, z, x, y, px, py, colormap),
        ]);

        return {
          date,
          surfaceMoistureM3M3: surface.value,
          surfaceMoistureRangeM3M3: surface.range,
          rootZoneMoistureM3M3: rootZone.value,
          rootZoneMoistureRangeM3M3: rootZone.range,
        };
      }),
    );

    const latestValid = [...series]
      .reverse()
      .find((pt) => pt.surfaceMoistureM3M3 !== null || pt.rootZoneMoistureM3M3 !== null);

    const hasSurface = latestValid?.surfaceMoistureM3M3 !== null && latestValid?.surfaceMoistureM3M3 !== undefined;
    const hasRoot = latestValid?.rootZoneMoistureM3M3 !== null && latestValid?.rootZoneMoistureM3M3 !== undefined;

    const status =
      hasSurface && hasRoot
        ? 'available'
        : hasSurface || hasRoot
          ? 'partial'
          : 'unavailable';

    const snapshot: SoilMoistureSnapshot = {
      location: targetLocation,
      boundaryContext: spatial.boundaryContext,
      spatialProcessing: spatial.spatialProcessing,
      dataClassification: 'satellite_derived',
      status,
      product: 'NASA SMAP L4 Global 9 km Analyzed Surface (0–5 cm) & Root-Zone (0–100 cm) Soil Moisture',
      units: 'm³/m³',
      observationDate: latestValid?.date ?? null,
      surfaceMoistureM3M3: latestValid?.surfaceMoistureM3M3 ?? null,
      rootZoneMoistureM3M3: latestValid?.rootZoneMoistureM3M3 ?? null,
      surfaceMoistureBinM3M3: latestValid?.surfaceMoistureRangeM3M3 ?? null,
      rootZoneMoistureBinM3M3: latestValid?.rootZoneMoistureRangeM3M3 ?? null,
      moistureSeries: series,
      retrievalConfidenceNote:
        'Decoded from NASA GIBS SMAP L4 indexed raster tiles (~9 km grid, ±0.002 m³/m³ colormap quantization). Represents satellite/model-assimilated regional moisture rather than an in-field sensor.',
      sourceAttribution: {
        id: 'nasa-smap-l4-gibs',
        name: 'NASA SMAP L4 (GIBS WMTS)',
        attribution: 'NASA EOSDIS / NSIDC SMAP L4 Analyzed Soil Moisture via GIBS',
        url: `${this.gibsBaseUrl}/wmts/epsg3857/best/`,
        cached: false,
        retrievedAt,
      },
      ...(status === 'unavailable'
        ? {
            message:
              'No SMAP L4 soil moisture pixel reported for these coordinates and dates (water body, frozen ground, snow cover, or latency gap).',
          }
        : {}),
      retrievedAt,
    };

    if (status !== 'unavailable') {
      this.snapshotCache.set(cacheKey, snapshot);
    }

    return snapshot;
  }
}
