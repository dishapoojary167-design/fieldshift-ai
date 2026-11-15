import type {
  ClimateTrendSummary,
  ClimateTrendsQuery,
  WeatherTelemetryRequest,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';

export interface IWeatherRepository {
  fetchWeatherTelemetry(request: WeatherTelemetryRequest): Promise<WeatherTelemetrySnapshot>;
  fetchClimateTrends(query: ClimateTrendsQuery): Promise<ClimateTrendSummary>;
}
