import type { CropIntelligenceRequest, CropIntelligenceResult } from '../../../shared/index.ts';
import { ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { ICropRepository } from '../interfaces/index.ts';

export class CropRepositoryStub implements ICropRepository {
  async evaluateSuitability(
    _request: CropIntelligenceRequest,
  ): Promise<CropIntelligenceResult> {
    throw new ServiceNotImplementedError('CropRepository', 'evaluateSuitability');
  }
}
