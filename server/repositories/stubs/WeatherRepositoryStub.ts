import type {
  ClimateTrendSummary,
  ClimateTrendsQuery,
  WeatherTelemetryRequest,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import { ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { IWeatherRepository } from '../interfaces/index.ts';

export class WeatherRepositoryStub implements IWeatherRepository {
  async fetchWeatherTelemetry(
    _request: WeatherTelemetryRequest,
  ): Promise<WeatherTelemetrySnapshot> {
    throw new ServiceNotImplementedError('WeatherRepository', 'fetchWeatherTelemetry');
  }

  async fetchClimateTrends(_query: ClimateTrendsQuery): Promise<ClimateTrendSummary> {
    throw new ServiceNotImplementedError('WeatherRepository', 'fetchClimateTrends');
  }
}
