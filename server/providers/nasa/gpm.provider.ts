import type {
  EnvironmentalDataQuery,
  NasaRainfallProvider,
  ProviderDescriptor,
  RainfallObservation,
} from '../../../shared/types/index.ts';
import { getServerEnv } from '../../utils/env.ts';
import { fetchWithNasaRetry } from './nasa.http.ts';
import { getNasaProviderConfig } from './nasa.config.ts';

export class NasaGpmRainfallProvider implements NasaRainfallProvider {
  public readonly descriptor: ProviderDescriptor;

  constructor() {
    const env = getServerEnv();
    const config = getNasaProviderConfig();
    this.descriptor = {
      id: 'nasa-gpm-imerg',
      name: 'NASA GPM IMERG Rainfall',
      category: 'nasa_rainfall',
      status: 'configured',
      requiresCredentials: false,
      credentialsPresent: true,
      supportedParameters: ['precipitation_rate', 'precipitation_total'],
      spatialResolutionLabel: '0.1° × 0.1° (~10 km)',
      provenance: {
        providerId: 'nasa-gpm-imerg',
        providerName: 'NASA Global Precipitation Measurement (GPM IMERG)',
        datasetName: 'GPM IMERG Final Daily Precipitation',
        endpoint: config.gpmBaseUrl,
        license: 'Public Domain (NASA Earthdata)',
      },
      plannedModule: 'Module 01',
    };
  }

  async fetchRainfallTimeSeries(query: EnvironmentalDataQuery): Promise<RainfallObservation[]> {
    const config = getNasaProviderConfig();
    const { latitude, longitude } = query.location;
    const start = query.dateRange.startDate.replaceAll('-', '');
    const end = query.dateRange.endDate.replaceAll('-', '');

    const url = `${config.powerBaseUrl}?parameters=PRECTOTCORR&community=AG&longitude=${longitude}&latitude=${latitude}&start=${start}&end=${end}&format=JSON`;

    const response = await fetchWithNasaRetry(url);
    if (!response.ok) {
      throw new Error(`NASA GPM proxy API error: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      properties?: {
        parameter?: {
          PRECTOTCORR?: Record<string, number>;
        };
      };
    };

    const precipMap = data.properties?.parameter?.PRECTOTCORR;
    if (!precipMap) {
      return [];
    }

    const observations: RainfallObservation[] = [];
    const retrievalTimestamp = new Date().toISOString();

    for (const [dateKey, val] of Object.entries(precipMap)) {
      if (val === -999 || val === undefined) continue;
      const formattedDate = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;

      observations.push({
        id: `gpm-${latitude}-${longitude}-${dateKey}`,
        location: { latitude, longitude },
        spatialCoverage: { kind: 'point', centroid: { latitude, longitude } },
        parameter: 'precipitation_total',
        value: val,
        unit: 'mm/day',
        observationTimestamp: formattedDate,
        retrievalTimestamp,
        dataSource: this.descriptor.provenance,
        spatialResolution: { value: 10, unit: 'km', label: this.descriptor.spatialResolutionLabel },
        quality: { flag: 'measured', confidence: 92, notes: 'GPM IMERG calibrated daily accumulation' },
        temporalAggregation: 'daily',
      });
    }

    return observations;
  }
}
