import type {
  LocationContext,
  LocationResolveRequest,
  RegionSummary,
} from '../../../shared/index.ts';
import { ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { ILocationRepository } from '../interfaces/index.ts';

export class LocationRepositoryStub implements ILocationRepository {
  async resolveLocation(_request: LocationResolveRequest): Promise<LocationContext> {
    throw new ServiceNotImplementedError('LocationRepository', 'resolveLocation');
  }

  async listRegions(): Promise<RegionSummary[]> {
    throw new ServiceNotImplementedError('LocationRepository', 'listRegions');
  }
}
