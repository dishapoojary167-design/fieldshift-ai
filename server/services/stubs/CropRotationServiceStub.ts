import type {
  CropRotationPlanRequest,
  CropRotationPlanResult,
  RotationCompareRequest,
  RotationGenerateRequest,
  RotationPlannerResult,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';
import type { IRotationRepository } from '../../repositories/index.ts';
import type { ICropRotationService } from '../interfaces/index.ts';

export class CropRotationServiceStub implements ICropRotationService {
  private readonly repository: IRotationRepository;

  constructor(repository: IRotationRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'stub';
  }

  async generateRotationPlan(request: CropRotationPlanRequest): Promise<CropRotationPlanResult> {
    return this.repository.buildRotationSchedule(request);
  }

  async generateRotationStrategies(
    request: RotationGenerateRequest,
  ): Promise<RotationPlannerResult> {
    return this.repository.generateRotationStrategies(request);
  }

  async compareRotationStrategies(
    request: RotationCompareRequest,
  ): Promise<RotationPlannerResult> {
    return this.repository.compareRotationStrategies(request);
  }
}
