import { Router } from 'express';
import { env } from '../../config/env.ts';
import type { AiAssistantController } from '../../controllers/aiAssistant.controller.ts';
import { asyncHandler } from '../../middleware/errorHandler.ts';
import { createRateLimiter } from '../../middleware/rateLimiter.ts';
import { validateRequest } from '../../middleware/validateRequest.ts';
import { aiAssistantBodySchema } from '../../validation/schemas.ts';

export interface AiAssistantRouteOptions {
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
}

export function createAiAssistantRoutes(
  controller: AiAssistantController,
  options: AiAssistantRouteOptions = {},
): Router {
  const router = Router();
  const limiter = createRateLimiter({
    maxRequests: options.rateLimitMaxRequests ?? env.aiRateLimitMaxRequests,
    windowMs: options.rateLimitWindowMs ?? env.aiRateLimitWindowMs,
    keyPrefix: 'ai-ask',
  });

  router.post(
    '/ask',
    limiter,
    validateRequest({ body: aiAssistantBodySchema }),
    asyncHandler(controller.ask),
  );

  return router;
}
