import type {
  CropRotationPlanRequest,
  CropRotationPlanResult,
  RotationCompareRequest,
  RotationGenerateRequest,
  RotationPlannerResult,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';

export interface ICropRotationService {
  getStatus(): ServiceReadinessStatus;
  generateRotationPlan(request: CropRotationPlanRequest): Promise<CropRotationPlanResult>;
  generateRotationStrategies(request: RotationGenerateRequest): Promise<RotationPlannerResult>;
  compareRotationStrategies(request: RotationCompareRequest): Promise<RotationPlannerResult>;
}
