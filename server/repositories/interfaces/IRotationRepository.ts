import type {
  CropRotationPlanRequest,
  CropRotationPlanResult,
  RotationCompareRequest,
  RotationGenerateRequest,
  RotationPlannerResult,
} from '../../../shared/index.ts';

export interface IRotationRepository {
  buildRotationSchedule(request: CropRotationPlanRequest): Promise<CropRotationPlanResult>;
  generateRotationStrategies(request: RotationGenerateRequest): Promise<RotationPlannerResult>;
  compareRotationStrategies(request: RotationCompareRequest): Promise<RotationPlannerResult>;
}
