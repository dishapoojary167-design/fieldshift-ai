import type {
  GeoCoordinates,
  GpmImergRainfallObservation,
} from '../../shared/index.ts';
import { env } from '../config/env.ts';
import { fetchJsonWithRetry, type FetchLike } from '../utils/resilientHttp.ts';
import {
  assertCentroidSamplingSupported,
  type SpatialProviderOptions,
} from '../utils/spatialRequest.ts';
import { TtlCache } from '../utils/ttlCache.ts';
import type { ISatelliteRainfallProvider } from './ISatelliteRainfallProvider.ts';

interface ImageServerMetadataResponse {
  timeInfo?: {
    timeExtent?: [number, number];
  };
}

interface ImageServerIdentifyResponse {
  value?: string | number;
  properties?: {
    Values?: Array<string | number>;
  };
  catalogItems?: {
    features?: Array<{
      attributes?: {
        stdtime?: number;
      };
    }>;
  };
}

export interface GpmImergProviderOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export class GpmImergArcGisProvider implements ISatelliteRainfallProvider {
  public readonly providerId = 'nasa-gpm-imerg-gis';
  private readonly baseUrl: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;
  private readonly cache: TtlCache<GpmImergRainfallObservation>;
  private readonly metaCache: TtlCache<number>;

  constructor(options: GpmImergProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.nasaGpmImergBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? env.weatherHttpTimeoutMs;
    const ttl = options.cacheTtlMs ?? env.weatherCacheTtlMs;
    this.cache = new TtlCache<GpmImergRainfallObservation>(ttl, 200);
    this.metaCache = new TtlCache<number>(ttl, 10);
  }

  private async resolveTimestampMs(targetDate?: string): Promise<number | null> {
    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      const noonUtc = Date.parse(`${targetDate}T12:00:00Z`);
      if (Number.isFinite(noonUtc)) {
        const latest = await this.fetchLatestExtentMs();
        if (latest !== null && noonUtc > latest) {
          return latest;
        }
        return noonUtc;
      }
    }
    return this.fetchLatestExtentMs();
  }

  private async fetchLatestExtentMs(): Promise<number | null> {
    const cached = this.metaCache.get('latest-extent');
    if (cached !== undefined) {
      return cached;
    }
    const meta = await fetchJsonWithRetry<ImageServerMetadataResponse>(
      `${this.baseUrl}?f=json`,
      {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        maxRetries: 1,
        serviceName: 'NASA GPM IMERG Metadata',
      },
    );
    const endMs = meta.timeInfo?.timeExtent?.[1];
    if (typeof endMs === 'number' && Number.isFinite(endMs)) {
      this.metaCache.set('latest-extent', endMs);
      return endMs;
    }
    return null;
  }

  async getPointRainfall(
    location: GeoCoordinates,
    targetDate?: string,
    options?: SpatialProviderOptions,
  ): Promise<GpmImergRainfallObservation> {
    assertCentroidSamplingSupported(options, this.providerId);

    const cacheKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}:${targetDate ?? 'latest'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const timeMs = await this.resolveTimestampMs(targetDate);
      const url = new URL(`${this.baseUrl}/identify`);
      url.searchParams.set('geometry', `${location.longitude},${location.latitude}`);
      url.searchParams.set('geometryType', 'esriGeometryPoint');
      url.searchParams.set('sr', '4326');
      url.searchParams.set('returnGeometry', 'false');
      url.searchParams.set('returnCatalogItems', 'true');
      if (timeMs !== null) {
        url.searchParams.set('time', String(timeMs));
      }
      url.searchParams.set('f', 'json');

      const response = await fetchJsonWithRetry<ImageServerIdentifyResponse>(url.toString(), {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        maxRetries: 2,
        serviceName: 'NASA GPM IMERG',
      });

      const rawValue = response.value ?? response.properties?.Values?.[0];
      const stdtime = response.catalogItems?.features?.[0]?.attributes?.stdtime ?? timeMs;
      const observationTimestamp =
        typeof stdtime === 'number' && Number.isFinite(stdtime)
          ? new Date(stdtime).toISOString()
          : null;

      if (rawValue === undefined || rawValue === null || String(rawValue).toLowerCase() === 'nodata') {
        const result: GpmImergRainfallObservation = {
          status: 'unavailable',
          provider: 'NASA GES DISC GPM IMERG',
          product: 'GPM_3IMERGHHE V07 (Half-Hourly Early)',
          precipitationRateMmHr: null,
          units: 'mm/hr',
          observationTimestamp,
          message: 'No GPM IMERG precipitation pixel value available at this timestamp/coordinate.',
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      const parsed = typeof rawValue === 'number' ? rawValue : Number.parseFloat(String(rawValue));
      if (!Number.isFinite(parsed) || parsed < 0) {
        const result: GpmImergRainfallObservation = {
          status: 'unavailable',
          provider: 'NASA GES DISC GPM IMERG',
          product: 'GPM_3IMERGHHE V07 (Half-Hourly Early)',
          precipitationRateMmHr: null,
          units: 'mm/hr',
          observationTimestamp,
          message: 'GPM IMERG returned a non-numeric or fill pixel value.',
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      const result: GpmImergRainfallObservation = {
        status: 'available',
        provider: 'NASA GES DISC GPM IMERG',
        product: 'GPM_3IMERGHHE V07 (Half-Hourly Early)',
        precipitationRateMmHr: Number(parsed.toFixed(3)),
        units: 'mm/hr',
        observationTimestamp,
      };
      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      return {
        status: 'unavailable',
        provider: 'NASA GES DISC GPM IMERG',
        product: 'GPM_3IMERGHHE V07 (Half-Hourly Early)',
        precipitationRateMmHr: null,
        units: 'mm/hr',
        observationTimestamp: null,
        message:
          error instanceof Error
            ? `GPM IMERG satellite rainfall lookup unavailable: ${error.message}`
            : 'GPM IMERG satellite rainfall lookup unavailable.',
      };
    }
  }
}
