import { Router } from 'express';
import type { WeatherController } from '../../controllers/weather.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import {
  weatherQuerySchema,
  weatherTelemetryBodySchema,
  weatherTrendsQuerySchema,
} from '../../validation/schemas.ts';

export function createWeatherRoutes(controller: WeatherController): Router {
  const router = Router();

  router.get(
    '/',
    validateRequest({ query: weatherQuerySchema }),
    asyncHandler(controller.getWeather),
  );
  router.post(
    '/telemetry',
    validateRequest({ body: weatherTelemetryBodySchema }),
    asyncHandler(controller.getTelemetry),
  );
  router.get(
    '/trends',
    validateRequest({ query: weatherTrendsQuerySchema }),
    asyncHandler(controller.getTrends),
  );

  return router;
}
