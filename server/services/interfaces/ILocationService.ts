import type {
  LocationContext,
  LocationResolveRequest,
  RegionSummary,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';

export interface ILocationService {
  getStatus(): ServiceReadinessStatus;
  resolveLocation(request: LocationResolveRequest): Promise<LocationContext>;
  listRegions(): Promise<RegionSummary[]>;
}
