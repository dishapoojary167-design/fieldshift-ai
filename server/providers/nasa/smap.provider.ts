import type {
  EnvironmentalDataQuery,
  NasaSoilMoistureProvider,
  ProviderDescriptor,
  SoilMoistureObservation,
} from '../../../shared/types/index.ts';
import { getServerEnv } from '../../utils/env.ts';
import { NasaSmapMoistureProvider } from '../NasaSmapMoistureProvider.ts';
import { getNasaProviderConfig } from './nasa.config.ts';

export class NasaSmapSoilMoistureProvider implements NasaSoilMoistureProvider {
  public readonly descriptor: ProviderDescriptor;
  private readonly internalProvider: NasaSmapMoistureProvider;

  constructor() {
    const env = getServerEnv();
    const config = getNasaProviderConfig();
    this.descriptor = {
      id: 'nasa-smap-nsidc',
      name: 'NASA SMAP Soil Moisture (SPL3SMP_E / SPL4SMGP)',
      category: 'nasa_soil_moisture',
      status: 'configured',
      requiresCredentials: Boolean(env.NASA_EARTHDATA_TOKEN),
      credentialsPresent: Boolean(env.NASA_EARTHDATA_TOKEN),
      supportedParameters: ['soil_moisture_surface', 'soil_moisture_root_zone'],
      spatialResolutionLabel: '9 km × 9 km (EASE-Grid 2.0)',
      provenance: {
        providerId: 'nasa-smap-nsidc',
        providerName: 'NASA National Snow and Ice Data Center (NSIDC) DAAC',
        datasetName: 'SMAP Enhanced L3 Radiometer Global Daily 9 km (SPL3SMP_E V006) & SMAP L4 Global 9 km (SPL4SMGP V007)',
        datasetVersion: 'SPL3SMP_E V006 (Surface) / SPL4SMGP V007 (Root Zone)',
        processingLevel: 'Level 3 / Level 4',
        endpoint: 'https://nsidc.org/data/spl3smp_e',
        license: 'NASA Earth Science Open Data Policy',
        citation: 'O\'Neill, P. E., et al. (2021). SMAP Enhanced L3 Radiometer Global Daily 9 km EASE-Grid Soil Moisture, Version 6. Boulder, Colorado USA. NASA NSIDC DAAC. https://doi.org/10.5067/4DQASW0J5AF0',
      },
      plannedModule: 'Module 04',
    };
    this.internalProvider = new NasaSmapMoistureProvider({
      gibsBaseUrl: config.smapBaseUrl.includes('wmts') ? config.smapBaseUrl.split('/wmts')[0] : undefined,
    });
  }

  async fetchSoilMoistureTimeSeries(query: EnvironmentalDataQuery): Promise<SoilMoistureObservation[]> {
    const { latitude, longitude } = query.location;
    const snapshot = await this.internalProvider.fetchSoilMoisture(
      { latitude, longitude },
      { dateRange: query.dateRange },
    );

    const retrievalTimestamp = new Date().toISOString();
    const observations: SoilMoistureObservation[] = [];

    for (const point of snapshot.moistureSeries) {
      if (point.surfaceMoistureM3M3 !== null) {
        observations.push({
          id: `smap-surf-${latitude}-${longitude}-${point.date}`,
          location: { latitude, longitude },
          spatialCoverage: { kind: 'point', centroid: { latitude, longitude } },
          parameter: 'soil_moisture_surface',
          value: point.surfaceMoistureM3M3,
          unit: 'm³/m³',
          observationTimestamp: point.date,
          retrievalTimestamp,
          dataSource: this.descriptor.provenance,
          spatialResolution: { value: 9, unit: 'km', label: this.descriptor.spatialResolutionLabel },
          quality: {
            flag: 'derived',
            confidence: 90,
            notes: 'SMAP Enhanced L3 radiometer surface (0–5 cm) retrieval; retrieval_qual_flag = 0 (recommended)',
          },
          temporalAggregation: 'daily',
          depthCm: { topCm: 0, bottomCm: 5 },
          metadata: {
            product: 'SPL3SMP_E V006',
            binRange: point.surfaceMoistureRangeM3M3,
            sensor: 'L-band Radiometer (1.41 GHz)',
          },
        });
      }

      if (point.rootZoneMoistureM3M3 !== null) {
        observations.push({
          id: `smap-root-${latitude}-${longitude}-${point.date}`,
          location: { latitude, longitude },
          spatialCoverage: { kind: 'point', centroid: { latitude, longitude } },
          parameter: 'soil_moisture_root_zone',
          value: point.rootZoneMoistureM3M3,
          unit: 'm³/m³',
          observationTimestamp: point.date,
          retrievalTimestamp,
          dataSource: {
            ...this.descriptor.provenance,
            datasetName: 'SMAP L4 Global 9 km Surface and Root-Zone Soil Moisture (SPL4SMGP V007)',
          },
          spatialResolution: { value: 9, unit: 'km', label: this.descriptor.spatialResolutionLabel },
          quality: {
            flag: 'derived',
            confidence: 88,
            notes: 'NASA SMAP L4 land-model assimilation (0–100 cm root zone)',
          },
          temporalAggregation: 'daily',
          depthCm: { topCm: 0, bottomCm: 100 },
          metadata: {
            product: 'SPL4SMGP V007',
            binRange: point.rootZoneMoistureRangeM3M3,
            assimilationModel: 'Catchment Land Surface Model (CLSM)',
          },
        });
      }
    }

    return observations;
  }
}
