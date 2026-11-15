import type {
  AgriculturalKnowledgeProvider,
  CropCalendarEntry,
  CropProfile,
  ProviderDescriptor,
  RegionalKnowledgeBundle,
  RegionDescriptor,
  RotationRule,
} from '../../shared/types/index.ts';
import { KnowledgeRepository } from '../repositories/knowledge.repository.ts';

export class FileBasedAgriculturalKnowledgeProvider implements AgriculturalKnowledgeProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly repository: KnowledgeRepository;

  constructor(repository = new KnowledgeRepository()) {
    this.repository = repository;
    this.descriptor = {
      id: 'regional-ag-knowledge',
      name: 'Regional Agricultural Knowledge Base',
      category: 'agricultural_knowledge',
      status: 'active',
      requiresCredentials: false,
      credentialsPresent: true,
      supportedParameters: ['crop_profiles', 'crop_calendars', 'soil_zones', 'rotation_rules'],
      spatialResolutionLabel: 'Region / Agro-Climatic Zone',
      provenance: {
        providerId: 'regional-ag-knowledge',
        providerName: 'FieldShift AI Curated Agronomy Store',
        datasetName: 'Decoupled Regional Crop & Rotation Knowledge JSON',
        datasetVersion: '0.1.0',
      },
      plannedModule: 'Module 00 (Baseline) + Module 03 (Scoring)',
    };
  }

  async listRegions(): Promise<RegionDescriptor[]> {
    return this.repository.listSupportedRegions();
  }

  async getRegionKnowledge(
    countryCode: string,
    regionCode: string,
  ): Promise<RegionalKnowledgeBundle> {
    return this.repository.loadRegionBundle(countryCode, regionCode);
  }

  async getCropsForRegion(countryCode: string, regionCode: string): Promise<CropProfile[]> {
    const bundle = await this.repository.loadRegionBundle(countryCode, regionCode);
    return bundle.crops;
  }

  async getCropCalendars(countryCode: string, regionCode: string): Promise<CropCalendarEntry[]> {
    const bundle = await this.repository.loadRegionBundle(countryCode, regionCode);
    return bundle.calendars;
  }

  async getRotationRules(countryCode: string, regionCode: string): Promise<RotationRule[]> {
    const bundle = await this.repository.loadRegionBundle(countryCode, regionCode);
    return bundle.rotationRules;
  }
}
