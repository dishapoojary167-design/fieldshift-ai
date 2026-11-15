import type {
  CropIntelligenceRequest,
  CropIntelligenceResult,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';
import type { ICropRepository } from '../../repositories/index.ts';
import type { ICropIntelligenceService } from '../interfaces/index.ts';

export class CropIntelligenceServiceStub implements ICropIntelligenceService {
  private readonly repository: ICropRepository;

  constructor(repository: ICropRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'stub';
  }

  async analyzeSuitability(request: CropIntelligenceRequest): Promise<CropIntelligenceResult> {
    return this.repository.evaluateSuitability(request);
  }
}
