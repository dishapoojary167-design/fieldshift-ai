import { Router } from 'express';
import type { CropRotationController } from '../../controllers/cropRotation.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import {
  cropRotationPlanBodySchema,
  rotationCompareBodySchema,
  rotationGenerateBodySchema,
} from '../../validation/schemas.ts';

export function createCropRotationRoutes(controller: CropRotationController): Router {
  const router = Router();

  router.post(
    '/generate',
    validateRequest({ body: rotationGenerateBodySchema }),
    asyncHandler(controller.generate),
  );

  router.post(
    '/compare',
    validateRequest({ body: rotationCompareBodySchema }),
    asyncHandler(controller.compare),
  );

  router.post(
    '/plan',
    validateRequest({ body: cropRotationPlanBodySchema }),
    asyncHandler(controller.generatePlan),
  );

  return router;
}
