import type {
  CropIntelligenceRequest,
  CropIntelligenceResult,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';

export interface ICropIntelligenceService {
  getStatus(): ServiceReadinessStatus;
  analyzeSuitability(request: CropIntelligenceRequest): Promise<CropIntelligenceResult>;
}
