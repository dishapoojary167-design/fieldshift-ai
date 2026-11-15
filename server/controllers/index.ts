import { EcostressEvapotranspirationRepository } from '../repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { HlsVegetationRepository } from '../repositories/implementations/HlsVegetationRepository.ts';
import { EvapotranspirationService } from '../services/implementations/EvapotranspirationService.ts';
import { VegetationService } from '../services/implementations/VegetationService.ts';
import type { ServiceContainer } from '../services/index.ts';
import { AiAssistantController } from './aiAssistant.controller.ts';
import { CropIntelligenceController } from './cropIntelligence.controller.ts';
import { CropKnowledgeController } from './cropKnowledge.controller.ts';
import { CropRotationController } from './cropRotation.controller.ts';
import { EnvironmentalAnalyticsController } from './environmentalAnalytics.controller.ts';
import { EvapotranspirationController } from './evapotranspiration.controller.ts';
import { FarmIntelligenceController } from './farmIntelligence.controller.ts';
import { HealthController } from './health.controller.ts';
import { LocationController } from './location.controller.ts';
import { RainfallController } from './rainfall.controller.ts';
import { SoilController } from './soil.controller.ts';
import { SoilMoistureController } from './soilMoisture.controller.ts';
import { VegetationController } from './vegetation.controller.ts';
import { WeatherController } from './weather.controller.ts';

export interface ControllerContainer {
  health: HealthController;
  location: LocationController;
  weather: WeatherController;
  rainfall: RainfallController;
  soil: SoilController;
  soilMoisture: SoilMoistureController;
  cropKnowledge: CropKnowledgeController;
  cropIntelligence: CropIntelligenceController;
  cropRotation: CropRotationController;
  aiAssistant: AiAssistantController;
  evapotranspiration?: EvapotranspirationController;
  vegetation?: VegetationController;
  environmentalAnalytics?: EnvironmentalAnalyticsController;
  farmIntelligence?: FarmIntelligenceController;
}

export function createControllerContainer(services: ServiceContainer): ControllerContainer {
  const etService =
    services.evapotranspiration ??
    new EvapotranspirationService(new EcostressEvapotranspirationRepository());
  const vegService =
    services.vegetation ?? new VegetationService(new HlsVegetationRepository());

  return {
    health: new HealthController(services),
    location: new LocationController(services.location),
    weather: new WeatherController(services.weather),
    rainfall: new RainfallController(services.weather),
    soil: new SoilController(services.soil),
    soilMoisture: new SoilMoistureController(services.soil),
    cropKnowledge: new CropKnowledgeController(services.cropKnowledge),
    cropIntelligence: new CropIntelligenceController(services.cropIntelligence),
    cropRotation: new CropRotationController(services.cropRotation),
    aiAssistant: new AiAssistantController(services.aiAssistant),
    evapotranspiration: new EvapotranspirationController(etService),
    vegetation: new VegetationController(vegService),
    environmentalAnalytics: new EnvironmentalAnalyticsController(),
    farmIntelligence: new FarmIntelligenceController(),
  };
}
