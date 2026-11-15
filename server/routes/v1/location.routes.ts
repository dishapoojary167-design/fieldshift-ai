import { Router } from 'express';
import type { LocationController } from '../../controllers/location.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { locationResolveBodySchema } from '../../validation/schemas.ts';

export function createLocationRoutes(controller: LocationController): Router {
  const router = Router();

  router.post(
    '/resolve',
    validateRequest({ body: locationResolveBodySchema }),
    asyncHandler(controller.resolveLocation),
  );
  router.get('/regions', asyncHandler(controller.listRegions));

  return router;
}
