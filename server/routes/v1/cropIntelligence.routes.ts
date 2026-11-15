import { Router } from 'express';
import type { CropIntelligenceController } from '../../controllers/cropIntelligence.controller.ts';
import type { CropKnowledgeController } from '../../controllers/cropKnowledge.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import {
  cropCatalogQuerySchema,
  cropIdParamsSchema,
  cropIntelligenceBodySchema,
} from '../../validation/schemas.ts';

export function createCropIntelligenceRoutes(
  intelligenceController: CropIntelligenceController,
  knowledgeController: CropKnowledgeController,
): Router {
  const router = Router();

  // Crop Knowledge Base endpoints (Module 5 — strictly separate from recommendation logic)
  router.get('/regions', asyncHandler(knowledgeController.getRegions));
  router.get(
    '/catalog',
    validateRequest({ query: cropCatalogQuerySchema }),
    asyncHandler(knowledgeController.listCatalog),
  );
  router.get(
    '/:cropId',
    validateRequest({ params: cropIdParamsSchema }),
    asyncHandler(knowledgeController.getCropById),
  );

  // Explainable Crop Recommendation Engine endpoints (Module 7)
  router.post(
    '/recommend',
    validateRequest({ body: cropIntelligenceBodySchema }),
    asyncHandler(intelligenceController.analyzeSuitability),
  );

  router.post(
    '/suitability',
    validateRequest({ body: cropIntelligenceBodySchema }),
    asyncHandler(intelligenceController.analyzeSuitability),
  );

  return router;
}
