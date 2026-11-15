import type { CropIntelligenceRequest, CropIntelligenceResult } from '../../../shared/index.ts';

export interface ICropRepository {
  evaluateSuitability(request: CropIntelligenceRequest): Promise<CropIntelligenceResult>;
}
