import type {
  GeoCoordinates,
  GpmImergRainfallObservation,
} from '../../shared/index.ts';
import type { SpatialProviderOptions } from '../utils/spatialRequest.ts';

/**
 * Replaceable provider interface for satellite-based precipitation observations
 * (e.g., NASA GPM IMERG half-hourly/daily products).
 */
export interface ISatelliteRainfallProvider {
  readonly providerId: string;
  getPointRainfall(
    location: GeoCoordinates,
    targetDate?: string,
    options?: SpatialProviderOptions,
  ): Promise<GpmImergRainfallObservation>;
}
