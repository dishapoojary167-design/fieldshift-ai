import { Router } from 'express';
import type { SoilController } from '../../controllers/soil.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { soilMoistureBodySchema, soilProfileBodySchema } from '../../validation/schemas.ts';

export function createSoilRoutes(controller: SoilController): Router {
  const router = Router();

  router.post(
    '/profile',
    validateRequest({ body: soilProfileBodySchema }),
    asyncHandler(controller.getProfile),
  );
  router.post(
    '/moisture',
    validateRequest({ body: soilMoistureBodySchema }),
    asyncHandler(controller.getMoisture),
  );

  return router;
}
