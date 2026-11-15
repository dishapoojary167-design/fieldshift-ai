import { Router } from 'express';
import type { HealthController } from '../../controllers/health.controller.ts';

export function createHealthRoutes(controller: HealthController): Router {
  const router = Router();
  router.get('/', controller.getHealth);
  return router;
}
