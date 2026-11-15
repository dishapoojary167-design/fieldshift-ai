import type {
  AgroClimaticRegionsResult,
  CropCatalogFilter,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
} from '../../../shared/index.ts';

export interface ICropKnowledgeRepository {
  searchCrops(filter: CropCatalogFilter): Promise<CropKnowledgeCatalogResult>;
  getCropById(cropId: string): Promise<CropKnowledgeProfile | null>;
  getAgroClimaticRegions(): Promise<AgroClimaticRegionsResult>;
}
