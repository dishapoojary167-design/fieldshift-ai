import type {
  LocationContext,
  LocationResolveRequest,
  RegionSummary,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';
import type { ILocationRepository } from '../../repositories/index.ts';
import type { ILocationService } from '../interfaces/index.ts';

export class LocationServiceStub implements ILocationService {
  private readonly repository: ILocationRepository;

  constructor(repository: ILocationRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'stub';
  }

  async resolveLocation(request: LocationResolveRequest): Promise<LocationContext> {
    return this.repository.resolveLocation(request);
  }

  async listRegions(): Promise<RegionSummary[]> {
    return this.repository.listRegions();
  }
}
