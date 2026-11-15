import { Router } from 'express';
import type { EvapotranspirationController } from '../../controllers/evapotranspiration.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import {
  ecostressJobParamsSchema,
  ecostressJobStatusQuerySchema,
  ecostressJobSubmitBodySchema,
} from '../../validation/schemas.ts';

export function createEvapotranspirationRoutes(
  controller: EvapotranspirationController,
): Router {
  const router = Router();

  router.get('/products', asyncHandler(controller.getProducts));

  router.post(
    '/jobs',
    validateRequest({ body: ecostressJobSubmitBodySchema }),
    asyncHandler(controller.submitJob),
  );

  router.get(
    '/jobs/:jobId',
    validateRequest({
      params: ecostressJobParamsSchema,
      query: ecostressJobStatusQuerySchema,
    }),
    asyncHandler(controller.getJobStatus),
  );

  router.get(
    '/jobs/:jobId/results',
    validateRequest({ params: ecostressJobParamsSchema }),
    asyncHandler(controller.getJobResults),
  );

  return router;
}
