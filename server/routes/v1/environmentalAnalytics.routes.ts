import { Router } from 'express';
import type { EnvironmentalAnalyticsController } from '../../controllers/environmentalAnalytics.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { environmentalAnalyticsBodySchema } from '../../validation/schemas.ts';

export function createEnvironmentalAnalyticsRoutes(
  controller: EnvironmentalAnalyticsController,
): Router {
  const router = Router();

  router.post(
    '/analyze',
    validateRequest({ body: environmentalAnalyticsBodySchema }),
    asyncHandler(controller.analyze),
  );

  return router;
}
