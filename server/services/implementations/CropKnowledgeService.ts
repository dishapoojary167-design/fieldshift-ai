import type {
  AgroClimaticRegionsResult,
  CropCatalogFilter,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';
import { NotFoundError } from '../../errors/AppError.ts';
import type { ICropKnowledgeRepository } from '../../repositories/interfaces/ICropKnowledgeRepository.ts';
import type { ICropKnowledgeService } from '../interfaces/ICropKnowledgeService.ts';

export class CropKnowledgeService implements ICropKnowledgeService {
  private readonly repository: ICropKnowledgeRepository;

  constructor(repository: ICropKnowledgeRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'ready';
  }

  async searchCrops(filter: CropCatalogFilter): Promise<CropKnowledgeCatalogResult> {
    return this.repository.searchCrops(filter);
  }

  async getCropById(cropId: string): Promise<CropKnowledgeProfile> {
    const profile = await this.repository.getCropById(cropId);
    if (!profile) {
      throw new NotFoundError(`Crop knowledge profile '${cropId}' was not found.`, { cropId });
    }
    return profile;
  }

  async getAgroClimaticRegions(): Promise<AgroClimaticRegionsResult> {
    return this.repository.getAgroClimaticRegions();
  }
}
