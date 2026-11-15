import type {
  CropEnvironmentalInputs,
  CropIntelligenceRequest,
  CropIntelligenceResult,
  CropRecommendationPreferences,
} from '../../../shared/index.ts';
import { evaluateCropSuitability } from '../../engines/CropSuitabilityEngine.ts';
import { FarmEnvironmentalContextService } from '../../services/implementations/FarmEnvironmentalContextService.ts';
import type { IFarmEnvironmentalContextService } from '../../services/interfaces/IFarmEnvironmentalContextService.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';
import type {
  ICropKnowledgeRepository,
  ICropRepository,
  IEvapotranspirationRepository,
  ISoilRepository,
  IVegetationRepository,
  IWeatherRepository,
} from '../interfaces/index.ts';

export interface CropIntelligenceRepositoryOptions {
  cropKnowledgeRepository: ICropKnowledgeRepository;
  weatherRepository: IWeatherRepository;
  soilRepository: ISoilRepository;
  evapotranspirationRepository?: IEvapotranspirationRepository;
  vegetationRepository?: IVegetationRepository;
  farmEnvironmentalContextService?: IFarmEnvironmentalContextService;
}

function resolvePreferences(request: CropIntelligenceRequest): CropRecommendationPreferences {
  const prefs = request.preferences ?? {};
  const inputs = request.inputs ?? {};
  const farmingSystem = prefs.farmingSystem ?? inputs.farmingSystem;

  let irrigationAvailable = prefs.irrigationAvailable ?? inputs.irrigationAvailable;
  if (irrigationAvailable === undefined && farmingSystem) {
    irrigationAvailable = farmingSystem !== 'rainfed';
  }

  return {
    growingSeason: prefs.growingSeason ?? inputs.targetSeason,
    farmingSystem:
      farmingSystem ??
      (irrigationAvailable === true
        ? 'irrigated'
        : irrigationAvailable === false
          ? 'rainfed'
          : undefined),
    irrigationAvailable,
    currentCrop: prefs.currentCrop ?? request.currentCrop,
    waterConservationPriority: prefs.waterConservationPriority ?? 'moderate',
    soilImprovementPriority: prefs.soilImprovementPriority ?? 'moderate',
    diversificationPreference: prefs.diversificationPreference ?? 'moderate',
  };
}

export class CropIntelligenceRepository implements ICropRepository {
  private readonly cropKnowledgeRepository: ICropKnowledgeRepository;
  private readonly farmEnvironmentalContextService: IFarmEnvironmentalContextService;

  constructor(options: CropIntelligenceRepositoryOptions) {
    this.cropKnowledgeRepository = options.cropKnowledgeRepository;
    this.farmEnvironmentalContextService =
      options.farmEnvironmentalContextService ??
      new FarmEnvironmentalContextService({
        weatherRepository: options.weatherRepository,
        soilRepository: options.soilRepository,
        evapotranspirationRepository: options.evapotranspirationRepository,
        vegetationRepository: options.vegetationRepository,
      });
  }

  async evaluateSuitability(request: CropIntelligenceRequest): Promise<CropIntelligenceResult> {
    const spatial = resolveSpatialRequestContext(
      request,
      'Crop suitability evaluation',
    );
    const targetLocation = spatial.targetLocation;
    const preferences = resolvePreferences(request);
    const seedInputs: CropEnvironmentalInputs = {
      ...(request.inputs ?? {}),
      ...(preferences.growingSeason ? { targetSeason: preferences.growingSeason } : {}),
      ...(preferences.irrigationAvailable !== undefined
        ? { irrigationAvailable: preferences.irrigationAvailable }
        : {}),
      ...(preferences.farmingSystem ? { farmingSystem: preferences.farmingSystem } : {}),
    };

    const environmentalContext = await this.farmEnvironmentalContextService.assembleContext({
      location: targetLocation,
      boundary: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
      dateRange: request.dateRange,
      targetSeason: preferences.growingSeason,
      labSoilTest: request.labSoilTest ?? null,
      existingInputs: seedInputs,
      autoFetchMissingFarmData: request.autoFetchMissingFarmData !== false,
      ecostressResult: request.ecostressResult,
      hlsResult: request.hlsResult,
    });

    const catalog = await this.cropKnowledgeRepository.searchCrops({});

    return evaluateCropSuitability({
      location: targetLocation,
      boundary: spatial.boundaryContext,
      spatialProcessing: environmentalContext.spatialProcessing ?? spatial.spatialProcessing,
      inputs: environmentalContext.features,
      preferences,
      weights: request.weights,
      pillarWeights: request.pillarWeights,
      strictRegionFilter: request.strictRegionFilter,
      crops: catalog.crops,
      gpmImergObservation: environmentalContext.gpmImergObservation ?? null,
      environmentalContext,
      extraCaveats: [
        ...(environmentalContext.providerWarnings ?? []),
        ...environmentalContext.coarseResolutionCaveats,
      ],
    });
  }
}
