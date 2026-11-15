import type {
  EnvironmentalDataQuery,
  NasaWeatherProvider,
  ProviderDescriptor,
  WeatherObservation,
} from '../../../shared/types/index.ts';
import { getServerEnv } from '../../utils/env.ts';
import { fetchWithNasaRetry } from './nasa.http.ts';
import { getNasaProviderConfig } from './nasa.config.ts';

export class NasaPowerWeatherProvider implements NasaWeatherProvider {
  public readonly descriptor: ProviderDescriptor;

  constructor() {
    const env = getServerEnv();
    const config = getNasaProviderConfig();
    this.descriptor = {
      id: 'nasa-power',
      name: 'NASA POWER Agroclimatology',
      category: 'nasa_weather',
      status: 'configured',
      requiresCredentials: false,
      credentialsPresent: true,
      supportedParameters: [
        'air_temperature_2m',
        'air_temperature_min_2m',
        'air_temperature_max_2m',
        'relative_humidity_2m',
        'solar_radiation_sw_down',
        'wind_speed_2m',
        'evapotranspiration_et0',
      ],
      spatialResolutionLabel: '0.5° × 0.625° (~55 km)',
      provenance: {
        providerId: 'nasa-power',
        providerName: 'NASA Langley Research Center (POWER)',
        datasetName: 'NASA POWER Agroclimatology Daily',
        endpoint: config.powerBaseUrl,
        license: 'Public Domain (NASA Earthdata)',
      },
      plannedModule: 'Module 01',
    };
  }

  async fetchWeatherTimeSeries(query: EnvironmentalDataQuery): Promise<WeatherObservation[]> {
    const config = getNasaProviderConfig();
    const { latitude, longitude } = query.location;
    const start = query.dateRange.startDate.replaceAll('-', '');
    const end = query.dateRange.endDate.replaceAll('-', '');
    const url = `${config.powerBaseUrl}?parameters=T2M,T2M_MIN,T2M_MAX,RH2M,ALLSKY_SFC_SW_DWN,WS2M,PRECTOTCORR&community=AG&longitude=${longitude}&latitude=${latitude}&start=${start}&end=${end}&format=JSON`;

    const response = await fetchWithNasaRetry(url);
    if (!response.ok) {
      throw new Error(`NASA POWER API error: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      properties?: {
        parameter?: {
          T2M?: Record<string, number>;
          T2M_MIN?: Record<string, number>;
          T2M_MAX?: Record<string, number>;
          RH2M?: Record<string, number>;
          ALLSKY_SFC_SW_DWN?: Record<string, number>;
          WS2M?: Record<string, number>;
        };
      };
    };

    const parameters = data.properties?.parameter;
    if (!parameters?.T2M) {
      return [];
    }

    const t2mMap = parameters.T2M;
    const tMinMap = parameters.T2M_MIN || {};
    const tMaxMap = parameters.T2M_MAX || {};
    const rhMap = parameters.RH2M || {};
    const swMap = parameters.ALLSKY_SFC_SW_DWN || {};
    const wsMap = parameters.WS2M || {};

    const observations: WeatherObservation[] = [];
    const retrievalTimestamp = new Date().toISOString();

    for (const [dateKey, tempVal] of Object.entries(t2mMap)) {
      if (tempVal === -999 || tempVal === undefined) continue;
      const formattedDate = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;

      observations.push({
        id: `power-${latitude}-${longitude}-${dateKey}`,
        location: { latitude, longitude },
        spatialCoverage: { kind: 'point', centroid: { latitude, longitude } },
        parameter: 'air_temperature_2m',
        value: tempVal,
        unit: '°C',
        observationTimestamp: formattedDate,
        retrievalTimestamp,
        dataSource: this.descriptor.provenance,
        spatialResolution: { value: 55, unit: 'km', label: this.descriptor.spatialResolutionLabel },
        quality: { flag: 'measured', confidence: 95, notes: 'NASA POWER validated daily synthesis' },
        temporalAggregation: 'daily',
        metadata: {
          tMin: tMinMap[dateKey] !== -999 ? tMinMap[dateKey] : null,
          tMax: tMaxMap[dateKey] !== -999 ? tMaxMap[dateKey] : null,
          relativeHumidity: rhMap[dateKey] !== -999 ? rhMap[dateKey] : null,
          solarRadiation: swMap[dateKey] !== -999 ? swMap[dateKey] : null,
          windSpeed: wsMap[dateKey] !== -999 ? wsMap[dateKey] : null,
        },
      });
    }

    return observations;
  }
}
