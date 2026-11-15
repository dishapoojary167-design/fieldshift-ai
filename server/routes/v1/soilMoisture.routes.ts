import { Router } from 'express';
import type { SoilMoistureController } from '../../controllers/soilMoisture.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { soilMoistureQuerySchema } from '../../validation/schemas.ts';

export function createSoilMoistureRoutes(controller: SoilMoistureController): Router {
  const router = Router();

  router.get(
    '/',
    validateRequest({ query: soilMoistureQuerySchema }),
    asyncHandler(controller.getSoilMoisture),
  );

  return router;
}
