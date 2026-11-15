import { Router } from 'express';
import type { VegetationController } from '../../controllers/vegetation.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import {
  hlsJobParamsSchema,
  hlsJobStatusQuerySchema,
  hlsJobSubmitBodySchema,
  vegetationQuerySchema,
} from '../../validation/schemas.ts';

export function createVegetationRoutes(controller: VegetationController): Router {
  const router = Router();

  router.get(
    '/',
    validateRequest({ query: vegetationQuerySchema }),
    asyncHandler(controller.getVegetation),
  );

  router.get('/products', asyncHandler(controller.getProducts));

  router.post(
    '/jobs',
    validateRequest({ body: hlsJobSubmitBodySchema }),
    asyncHandler(controller.submitJob),
  );

  router.get(
    '/jobs/:jobId',
    validateRequest({
      params: hlsJobParamsSchema,
      query: hlsJobStatusQuerySchema,
    }),
    asyncHandler(controller.getJobStatus),
  );

  router.get(
    '/jobs/:jobId/results',
    validateRequest({ params: hlsJobParamsSchema }),
    asyncHandler(controller.getJobResults),
  );

  return router;
}
