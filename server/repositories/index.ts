import { CompositeSoilGridsProvider } from '../providers/CompositeSoilGridsProvider.ts';
import { EcostressAppEearsProvider } from '../providers/ecostress/index.ts';
import { LandsatHlsAppEearsProvider } from '../providers/hls/index.ts';
import { GpmImergArcGisProvider } from '../providers/GpmImergArcGisProvider.ts';
import { NasaSmapMoistureProvider } from '../providers/NasaSmapMoistureProvider.ts';
import { CropIntelligenceRepository } from './implementations/CropIntelligenceRepository.ts';
import { CropRotationRepository } from './implementations/CropRotationRepository.ts';
import { EcostressEvapotranspirationRepository } from './implementations/EcostressEvapotranspirationRepository.ts';
import { HlsVegetationRepository } from './implementations/HlsVegetationRepository.ts';
import { JsonCropKnowledgeRepository } from './implementations/JsonCropKnowledgeRepository.ts';
import { NasaWeatherRepository } from './implementations/NasaWeatherRepository.ts';
import { NominatimLocationRepository } from './implementations/NominatimLocationRepository.ts';
import { SoilRepository } from './implementations/SoilRepository.ts';
import type {
  ICropKnowledgeRepository,
  ICropRepository,
  IEvapotranspirationRepository,
  ILocationRepository,
  IRotationRepository,
  ISoilRepository,
  IVegetationRepository,
  IWeatherRepository,
} from './interfaces/index.ts';

export * from './interfaces/index.ts';

export interface RepositoryContainer {
  location: ILocationRepository;
  weather: IWeatherRepository;
  soil: ISoilRepository;
  cropKnowledge: ICropKnowledgeRepository;
  crop: ICropRepository;
  rotation: IRotationRepository;
  evapotranspiration?: IEvapotranspirationRepository;
  vegetation?: IVegetationRepository;
}

export function createRepositoryContainer(): RepositoryContainer {
  const gpmProvider = new GpmImergArcGisProvider();
  const soilGridsProvider = new CompositeSoilGridsProvider();
  const soilMoistureProvider = new NasaSmapMoistureProvider();
  const ecostressProvider = new EcostressAppEearsProvider();
  const hlsProvider = new LandsatHlsAppEearsProvider();

  const weatherRepository = new NasaWeatherRepository({ gpmProvider });
  const soilRepository = new SoilRepository({ soilGridsProvider, soilMoistureProvider });
  const cropKnowledgeRepository = new JsonCropKnowledgeRepository();
  const evapotranspirationRepository = new EcostressEvapotranspirationRepository({
    provider: ecostressProvider,
  });
  const vegetationRepository = new HlsVegetationRepository({
    provider: hlsProvider,
  });

  return {
    location: new NominatimLocationRepository(),
    weather: weatherRepository,
    soil: soilRepository,
    cropKnowledge: cropKnowledgeRepository,
    crop: new CropIntelligenceRepository({
      cropKnowledgeRepository,
      weatherRepository,
      soilRepository,
      evapotranspirationRepository,
      vegetationRepository,
    }),
    rotation: new CropRotationRepository({
      cropKnowledgeRepository,
      weatherRepository,
      soilRepository,
    }),
    evapotranspiration: evapotranspirationRepository,
    vegetation: vegetationRepository,
  };
}
