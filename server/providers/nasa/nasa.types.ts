import type {
  EnvironmentalObservation,
  ObservationTimeSeries,
  ProviderDescriptor,
  NasaWeatherProvider,
  NasaRainfallProvider,
  NasaSoilMoistureProvider,
  SatelliteImageryProvider,
} from '../../../shared/types/index.ts';

export type {
  EnvironmentalObservation,
  ObservationTimeSeries,
  ProviderDescriptor,
  NasaWeatherProvider,
  NasaRainfallProvider,
  NasaSoilMoistureProvider,
  SatelliteImageryProvider,
};

export interface NasaHttpOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export interface NasaProviderConfig {
  powerBaseUrl: string;
  gpmBaseUrl: string;
  smapBaseUrl: string;
  gibsWmtsUrl: string;
  defaultTimeoutMs: number;
  maxRetries: number;
  userAgent: string;
}
