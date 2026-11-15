import type {
  CropRotationPlanRequest,
  CropRotationPlanResult,
  RotationCompareRequest,
  RotationGenerateRequest,
  RotationPlannerResult,
} from '../../../shared/index.ts';
import { ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { IRotationRepository } from '../interfaces/index.ts';

export class RotationRepositoryStub implements IRotationRepository {
  async buildRotationSchedule(
    _request: CropRotationPlanRequest,
  ): Promise<CropRotationPlanResult> {
    throw new ServiceNotImplementedError('RotationRepository', 'buildRotationSchedule');
  }

  async generateRotationStrategies(
    _request: RotationGenerateRequest,
  ): Promise<RotationPlannerResult> {
    throw new ServiceNotImplementedError('RotationRepository', 'generateRotationStrategies');
  }

  async compareRotationStrategies(
    _request: RotationCompareRequest,
  ): Promise<RotationPlannerResult> {
    throw new ServiceNotImplementedError('RotationRepository', 'compareRotationStrategies');
  }
}
