import type {
  ServiceReadinessStatus,
  SoilMoistureRequest,
  SoilMoistureSnapshot,
  SoilProfile,
  SoilProfileRequest,
} from '../../../shared/index.ts';
import type { ISoilRepository } from '../../repositories/index.ts';
import type { ISoilService } from '../interfaces/index.ts';

export class SoilServiceStub implements ISoilService {
  private readonly repository: ISoilRepository;

  constructor(repository: ISoilRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'stub';
  }

  async getSoilProfile(request: SoilProfileRequest): Promise<SoilProfile> {
    return this.repository.fetchSoilProfile(request);
  }

  async getSoilMoisture(request: SoilMoistureRequest): Promise<SoilMoistureSnapshot> {
    return this.repository.fetchSoilMoisture(request);
  }
}
