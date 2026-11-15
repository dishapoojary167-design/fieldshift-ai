import type { Request, Response } from 'express';
import type {
  BoundingBox,
  ClimateTrendsQuery,
  GeoJsonPolygon,
  SpatialProcessingMode,
  WeatherTelemetryRequest,
} from '../../shared/index.ts';
import type { IWeatherService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class WeatherController {
  private readonly weatherService: IWeatherService;

  constructor(weatherService: IWeatherService) {
    this.weatherService = weatherService;
  }

  getWeather = async (req: Request, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? req.query) as {
      latitude?: number;
      longitude?: number;
      polygon?: GeoJsonPolygon;
      bbox?: BoundingBox;
      spatialProcessingMode?: SpatialProcessingMode;
      startDate: string;
      endDate: string;
    };
    const snapshot = await this.weatherService.getWeatherTelemetry({
      ...(query.latitude !== undefined && query.longitude !== undefined
        ? { location: { latitude: Number(query.latitude), longitude: Number(query.longitude) } }
        : {}),
      ...(query.polygon ? { geometry: query.polygon } : {}),
      ...(query.bbox ? { bbox: query.bbox } : {}),
      ...(query.spatialProcessingMode
        ? { spatialProcessingMode: query.spatialProcessingMode }
        : {}),
      dateRange: { startDate: query.startDate, endDate: query.endDate },
      includeGpmImerg: true,
    });
    sendSuccess(res, req, snapshot, 200);
  };

  getTelemetry = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as WeatherTelemetryRequest;
    const snapshot = await this.weatherService.getWeatherTelemetry(payload);
    sendSuccess(res, req, snapshot, 200);
  };

  getTrends = async (req: Request, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? req.query) as unknown as ClimateTrendsQuery;
    const summary = await this.weatherService.getClimateTrends(query);
    sendSuccess(res, req, summary, 200);
  };
}
