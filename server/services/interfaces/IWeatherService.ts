import type {
  ClimateTrendSummary,
  ClimateTrendsQuery,
  ServiceReadinessStatus,
  WeatherTelemetryRequest,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';

export interface IWeatherService {
  getStatus(): ServiceReadinessStatus;
  getWeatherTelemetry(request: WeatherTelemetryRequest): Promise<WeatherTelemetrySnapshot>;
  getClimateTrends(query: ClimateTrendsQuery): Promise<ClimateTrendSummary>;
}
