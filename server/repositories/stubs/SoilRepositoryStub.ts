import type {
  SoilMoistureRequest,
  SoilMoistureSnapshot,
  SoilProfile,
  SoilProfileRequest,
} from '../../../shared/index.ts';
import { ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { ISoilRepository } from '../interfaces/index.ts';

export class SoilRepositoryStub implements ISoilRepository {
  async fetchSoilProfile(_request: SoilProfileRequest): Promise<SoilProfile> {
    throw new ServiceNotImplementedError('SoilRepository', 'fetchSoilProfile');
  }

  async fetchSoilMoisture(_request: SoilMoistureRequest): Promise<SoilMoistureSnapshot> {
    throw new ServiceNotImplementedError('SoilRepository', 'fetchSoilMoisture');
  }
}
