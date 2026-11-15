import type {
  DateRange,
  GeoCoordinates,
  SoilMoistureSnapshot,
} from '../../shared/index.ts';
import type { SpatialProviderOptions } from '../utils/spatialRequest.ts';

/**
 * Replaceable provider interface for satellite-derived soil moisture observations
 * (e.g., NASA SMAP L4 surface & root-zone volumetric soil moisture).
 */
export interface ISoilMoistureProvider {
  readonly providerId: string;
  fetchSoilMoisture(
    location: GeoCoordinates,
    options?: SpatialProviderOptions & {
      dateRange?: DateRange;
    },
  ): Promise<SoilMoistureSnapshot>;
}
