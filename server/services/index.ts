import { EcostressEvapotranspirationRepository } from '../repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { HlsVegetationRepository } from '../repositories/implementations/HlsVegetationRepository.ts';
import { createRepositoryContainer, type RepositoryContainer } from '../repositories/index.ts';
import { AiAssistantService } from './implementations/AiAssistantService.ts';
import { CropIntelligenceService } from './implementations/CropIntelligenceService.ts';
import { CropKnowledgeService } from './implementations/CropKnowledgeService.ts';
import { CropRotationService } from './implementations/CropRotationService.ts';
import { EvapotranspirationService } from './implementations/EvapotranspirationService.ts';
import { FarmEnvironmentalContextService } from './implementations/FarmEnvironmentalContextService.ts';
import { LocationService } from './implementations/LocationService.ts';
import { SoilService } from './implementations/SoilService.ts';
import { VegetationService } from './implementations/VegetationService.ts';
import { WeatherService } from './implementations/WeatherService.ts';
import type {
  IAiAssistantService,
  ICropIntelligenceService,
  ICropKnowledgeService,
  ICropRotationService,
  IEvapotranspirationService,
  IFarmEnvironmentalContextService,
  ILocationService,
  ISoilService,
  IVegetationService,
  IWeatherService,
} from './interfaces/index.ts';

export * from './interfaces/index.ts';

export interface ServiceContainer {
  location: ILocationService;
  weather: IWeatherService;
  soil: ISoilService;
  cropKnowledge: ICropKnowledgeService;
  farmEnvironmentalContext: IFarmEnvironmentalContextService;
  cropIntelligence: ICropIntelligenceService;
  cropRotation: ICropRotationService;
  aiAssistant: IAiAssistantService;
  evapotranspiration?: IEvapotranspirationService;
  vegetation?: IVegetationService;
}

export function createServiceContainer(
  repositories: RepositoryContainer = createRepositoryContainer(),
): ServiceContainer {
  const evapotranspirationRepo =
    repositories.evapotranspiration ?? new EcostressEvapotranspirationRepository();
  const vegetationRepo = repositories.vegetation ?? new HlsVegetationRepository();

  const farmEnvironmentalContext = new FarmEnvironmentalContextService({
    weatherRepository: repositories.weather,
    soilRepository: repositories.soil,
    evapotranspirationRepository: evapotranspirationRepo,
    vegetationRepository: vegetationRepo,
  });

  return {
    location: new LocationService(repositories.location),
    weather: new WeatherService(repositories.weather),
    soil: new SoilService(repositories.soil),
    cropKnowledge: new CropKnowledgeService(repositories.cropKnowledge),
    farmEnvironmentalContext,
    cropIntelligence: new CropIntelligenceService(repositories.crop),
    cropRotation: new CropRotationService(repositories.rotation),
    evapotranspiration: new EvapotranspirationService(evapotranspirationRepo),
    vegetation: new VegetationService(vegetationRepo),
    aiAssistant: new AiAssistantService({
      repos: {
        weatherRepository: repositories.weather,
        soilRepository: repositories.soil,
        cropKnowledgeRepository: repositories.cropKnowledge,
        cropRepository: repositories.crop,
        rotationRepository: repositories.rotation,
        evapotranspirationRepository: evapotranspirationRepo,
        vegetationRepository: vegetationRepo,
        farmEnvironmentalContextService: farmEnvironmentalContext,
      },
    }),
  };
}
