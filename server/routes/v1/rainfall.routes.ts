import { Router } from 'express';
import type { RainfallController } from '../../controllers/rainfall.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { rainfallQuerySchema } from '../../validation/schemas.ts';

export function createRainfallRoutes(controller: RainfallController): Router {
  const router = Router();

  router.get(
    '/',
    validateRequest({ query: rainfallQuerySchema }),
    asyncHandler(controller.getRainfall),
  );

  return router;
}
