import { Router } from 'express';
import type { ControllerContainer } from '../../controllers/index.ts';
import { createAiAssistantRoutes } from './aiAssistant.routes.ts';
import { createCropIntelligenceRoutes } from './cropIntelligence.routes.ts';
import { createCropRotationRoutes } from './cropRotation.routes.ts';
import { createEnvironmentalAnalyticsRoutes } from './environmentalAnalytics.routes.ts';
import { createEvapotranspirationRoutes } from './evapotranspiration.routes.ts';
import { createFarmIntelligenceRoutes } from './farmIntelligence.routes.ts';
import { createHealthRoutes } from './health.routes.ts';
import { createLocationRoutes } from './location.routes.ts';
import { createRainfallRoutes } from './rainfall.routes.ts';
import { createSoilRoutes } from './soil.routes.ts';
import { createSoilMoistureRoutes } from './soilMoisture.routes.ts';
import { createVegetationRoutes } from './vegetation.routes.ts';
import { createWeatherRoutes } from './weather.routes.ts';

export function createV1Router(controllers: ControllerContainer): Router {
  const router = Router();

  router.use('/health', createHealthRoutes(controllers.health));
  router.use('/location', createLocationRoutes(controllers.location));
  router.use('/weather', createWeatherRoutes(controllers.weather));
  router.use('/rainfall', createRainfallRoutes(controllers.rainfall));
  router.use('/soil', createSoilRoutes(controllers.soil));
  router.use('/soil-moisture', createSoilMoistureRoutes(controllers.soilMoisture));
  if (controllers.evapotranspiration) {
    router.use(
      '/evapotranspiration',
      createEvapotranspirationRoutes(controllers.evapotranspiration),
    );
  }
  if (controllers.vegetation) {
    router.use('/vegetation', createVegetationRoutes(controllers.vegetation));
  }
  if (controllers.environmentalAnalytics) {
    router.use('/environmental', createEnvironmentalAnalyticsRoutes(controllers.environmentalAnalytics));
  }
  if (controllers.farmIntelligence) {
    router.use('/farm-intelligence', createFarmIntelligenceRoutes(controllers.farmIntelligence));
  }
  router.use(
    '/crops',
    createCropIntelligenceRoutes(controllers.cropIntelligence, controllers.cropKnowledge),
  );
  router.use('/rotation', createCropRotationRoutes(controllers.cropRotation));
  router.use('/rotations', createCropRotationRoutes(controllers.cropRotation));
  router.use('/ai', createAiAssistantRoutes(controllers.aiAssistant));

  return router;
}
