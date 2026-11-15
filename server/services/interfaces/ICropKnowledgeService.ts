import type {
  AgroClimaticRegionsResult,
  CropCatalogFilter,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';

export interface ICropKnowledgeService {
  getStatus(): ServiceReadinessStatus;
  searchCrops(filter: CropCatalogFilter): Promise<CropKnowledgeCatalogResult>;
  getCropById(cropId: string): Promise<CropKnowledgeProfile>;
  getAgroClimaticRegions(): Promise<AgroClimaticRegionsResult>;
}
