import type {
  LocationContext,
  LocationResolveRequest,
  RegionSummary,
} from '../../../shared/index.ts';

export interface ILocationRepository {
  resolveLocation(request: LocationResolveRequest): Promise<LocationContext>;
  listRegions(): Promise<RegionSummary[]>;
}
