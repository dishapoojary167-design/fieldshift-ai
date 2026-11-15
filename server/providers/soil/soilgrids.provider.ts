import type {
  GeoCoordinate,
  ProviderDescriptor,
  SoilCharacteristicsProvider,
  SoilObservation,
  SoilProfileSummary,
} from '../../../shared/types/index.ts';
import { getServerEnv } from '../../utils/env.ts';
import { NotImplementedModuleError } from '../../utils/errors.ts';

export class IsricSoilGridsProvider implements SoilCharacteristicsProvider {
  public readonly descriptor: ProviderDescriptor;

  constructor() {
    const env = getServerEnv();
    this.descriptor = {
      id: 'isric-soilgrids',
      name: 'ISRIC SoilGrids v2.0',
      category: 'soil_characteristics',
      status: 'interface_ready',
      requiresCredentials: false,
      credentialsPresent: true,
      supportedParameters: [
        'soil_ph',
        'soil_organic_carbon',
        'soil_clay_fraction',
        'soil_sand_fraction',
        'soil_silt_fraction',
        'soil_nitrogen_total',
        'soil_bulk_density',
        'soil_cec',
      ],
      spatialResolutionLabel: '250 m',
      provenance: {
        providerId: 'isric-soilgrids',
        providerName: 'ISRIC — World Soil Information',
        datasetName: 'SoilGrids v2.0 Global Gridded Soil Properties',
        endpoint: env.SOILGRIDS_BASE_URL,
        license: 'CC-BY 4.0',
      },
      plannedModule: 'Module 02',
    };
  }

  async fetchSoilProfile(_location: GeoCoordinate): Promise<SoilProfileSummary> {
    throw new NotImplementedModuleError('ISRIC SoilGrids soil profile ingestion', 'Module 02');
  }

  async fetchSoilObservations(_location: GeoCoordinate): Promise<SoilObservation[]> {
    throw new NotImplementedModuleError('ISRIC SoilGrids soil observation ingestion', 'Module 02');
  }
}
