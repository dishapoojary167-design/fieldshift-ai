import { Router } from 'express';
import type { FarmIntelligenceController } from '../../controllers/farmIntelligence.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { farmIntelligenceBodySchema } from '../../validation/schemas.ts';

export function createFarmIntelligenceRoutes(controller: FarmIntelligenceController): Router {
  const router = Router();

  router.post(
    '/summary',
    validateRequest({ body: farmIntelligenceBodySchema }),
    asyncHandler(controller.getSummary),
  );

  return router;
}
