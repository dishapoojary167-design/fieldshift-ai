import type {
  ClimateTrendSummary,
  ClimateTrendsQuery,
  ServiceReadinessStatus,
  WeatherTelemetryRequest,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import type { IWeatherRepository } from '../../repositories/index.ts';
import type { IWeatherService } from '../interfaces/index.ts';

export class WeatherServiceStub implements IWeatherService {
  private readonly repository: IWeatherRepository;

  constructor(repository: IWeatherRepository) {
    this.repository = repository;
  }

  getStatus(): ServiceReadinessStatus {
    return 'stub';
  }

  async getWeatherTelemetry(request: WeatherTelemetryRequest): Promise<WeatherTelemetrySnapshot> {
    return this.repository.fetchWeatherTelemetry(request);
  }

  async getClimateTrends(query: ClimateTrendsQuery): Promise<ClimateTrendSummary> {
    return this.repository.fetchClimateTrends(query);
  }
}
