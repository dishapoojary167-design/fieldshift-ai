import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BoundingBox,
  CropEnvironmentalInputs,
  CropRotationPlanRequest,
  CropRotationPlanResult,
  DateRange,
  GeoCoordinates,
  GeoJsonPolygon,
  RegionalRotationRule,
  RotationCompareRequest,
  RotationGenerateRequest,
  RotationPlannerResult,
  RotationPreferences,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
  SpatialProcessingMode,
} from '../../../shared/index.ts';
import {
  evaluateRotationStrategies,
  generateRotationStrategies as buildStrategySet,
} from '../../engines/CropRotationEngine.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';
import type {
  ICropKnowledgeRepository,
  IRotationRepository,
  ISoilRepository,
  IWeatherRepository,
} from '../interfaces/index.ts';

export interface CropRotationRepositoryOptions {
  cropKnowledgeRepository: ICropKnowledgeRepository;
  weatherRepository: IWeatherRepository;
  soilRepository: ISoilRepository;
  rulesDirectory?: string;
}

function loadRegionalRules(rulesDirectory: string): RegionalRotationRule[] {
  try {
    const files = readdirSync(rulesDirectory).filter((f) => f.endsWith('.json'));
    const allRules: RegionalRotationRule[] = [];
    for (const file of files) {
      const raw = readFileSync(join(rulesDirectory, file), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        allRules.push(...(parsed as RegionalRotationRule[]));
      }
    }
    return allRules;
  } catch {
    return [];
  }
}

function resolvePreferences(
  prefs: RotationPreferences | undefined,
  inputs: CropEnvironmentalInputs | undefined,
): RotationPreferences {
  const farmingSystem = prefs?.farmingSystem ?? inputs?.farmingSystem;
  let irrigationAvailable = prefs?.irrigationAvailable ?? inputs?.irrigationAvailable;
  if (irrigationAvailable === undefined && farmingSystem) {
    irrigationAvailable = farmingSystem !== 'rainfed';
  }

  return {
    farmingSystem:
      farmingSystem ??
      (irrigationAvailable === true
        ? 'irrigated'
        : irrigationAvailable === false
          ? 'rainfed'
          : undefined),
    irrigationAvailable,
    waterConservationPriority: prefs?.waterConservationPriority ?? 'moderate',
    soilImprovementPriority: prefs?.soilImprovementPriority ?? 'moderate',
    diversificationPreference: prefs?.diversificationPreference ?? 'moderate',
    startingSeason: prefs?.startingSeason ?? inputs?.targetSeason ?? 'Kharif',
    seasonsCount: Math.max(3, Math.min(8, prefs?.seasonsCount ?? 4)),
  };
}

export class CropRotationRepository implements IRotationRepository {
  private readonly cropKnowledgeRepository: ICropKnowledgeRepository;
  private readonly weatherRepository: IWeatherRepository;
  private readonly soilRepository: ISoilRepository;
  private readonly regionalRules: RegionalRotationRule[];

  constructor(options: CropRotationRepositoryOptions) {
    this.cropKnowledgeRepository = options.cropKnowledgeRepository;
    this.weatherRepository = options.weatherRepository;
    this.soilRepository = options.soilRepository;
    const dir = options.rulesDirectory ?? join(process.cwd(), 'data', 'rotation-rules');
    this.regionalRules = loadRegionalRules(dir);
  }

  private async resolveEnvironmentalInputs(params: {
    location?: GeoCoordinates;
    boundary?: SoilBoundaryContext;
    geometry?: GeoJsonPolygon;
    bbox?: BoundingBox;
    spatialProcessingMode?: SpatialProcessingMode;
    inputs?: CropEnvironmentalInputs;
    preferences: RotationPreferences;
    autoFetchMissingFarmData?: boolean;
    dateRange?: DateRange;
  }): Promise<{
    targetLocation: GeoCoordinates;
    boundaryContext?: SoilBoundaryContext;
    spatialProcessing: SpatialProcessingMetadata;
    inputs: CropEnvironmentalInputs;
    extraCaveats: string[];
  }> {
    const spatial = resolveSpatialRequestContext(
      params,
      'Crop rotation planning',
    );
    const targetLocation = spatial.targetLocation;
    const mergedInputs: CropEnvironmentalInputs = {
      ...(params.inputs ?? {}),
      ...(params.preferences.irrigationAvailable !== undefined
        ? { irrigationAvailable: params.preferences.irrigationAvailable }
        : {}),
      ...(params.preferences.farmingSystem
        ? { farmingSystem: params.preferences.farmingSystem }
        : {}),
    };
    const extraCaveats: string[] = [];

    if (params.autoFetchMissingFarmData === false) {
      return {
        targetLocation,
        boundaryContext: spatial.boundaryContext,
        spatialProcessing: spatial.spatialProcessing,
        inputs: mergedInputs,
        extraCaveats,
      };
    }

    const needsWeather =
      mergedInputs.temperatureMeanC === undefined ||
      (mergedInputs.seasonalRainfallMm === undefined &&
        mergedInputs.observedRainfallMm === undefined);
    const needsTrends =
      mergedInputs.seasonalRainfallMm === undefined && mergedInputs.annualRainfallMm === undefined;
    const needsSoil =
      mergedInputs.soilPh === undefined ||
      mergedInputs.soilTexture === undefined ||
      mergedInputs.organicCarbonGKg === undefined;
    const needsMoisture =
      mergedInputs.soilMoistureM3M3 === undefined &&
      mergedInputs.soilMoistureSurfaceM3M3 === undefined;

    const [weatherRes, trendsRes, soilRes, moistureRes] = await Promise.allSettled([
      needsWeather
        ? this.weatherRepository.fetchWeatherTelemetry({
            location: targetLocation,
            boundary: spatial.boundaryContext,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: params.spatialProcessingMode,
            dateRange: params.dateRange,
          })
        : Promise.resolve(null),
      needsTrends
        ? this.weatherRepository.fetchClimateTrends({
            latitude: targetLocation.latitude,
            longitude: targetLocation.longitude,
            years: 5,
          })
        : Promise.resolve(null),
      needsSoil
        ? this.soilRepository.fetchSoilProfile({
            location: targetLocation,
            boundary: spatial.boundaryContext,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: params.spatialProcessingMode,
            depthCm: '0-5',
          })
        : Promise.resolve(null),
      needsMoisture
        ? this.soilRepository.fetchSoilMoisture({
            location: targetLocation,
            boundary: spatial.boundaryContext,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: params.spatialProcessingMode,
            dateRange: params.dateRange,
          })
        : Promise.resolve(null),
    ]);

    if (weatherRes.status === 'fulfilled' && weatherRes.value) {
      const w = weatherRes.value;
      if (mergedInputs.temperatureMeanC === undefined && w.summary.meanTempC !== null) {
        mergedInputs.temperatureMeanC = w.summary.meanTempC;
      }
      if (mergedInputs.temperatureMaxC === undefined && w.summary.maxTempC !== null) {
        mergedInputs.temperatureMaxC = w.summary.maxTempC;
      }
      if (mergedInputs.temperatureMinC === undefined && w.summary.minTempC !== null) {
        mergedInputs.temperatureMinC = w.summary.minTempC;
      }
      if (mergedInputs.observedRainfallMm === undefined && w.summary.availableDays > 0) {
        mergedInputs.observedRainfallMm = w.summary.totalPrecipitationMm;
        mergedInputs.observationDays = w.summary.availableDays;
      }
    } else if (weatherRes.status === 'rejected') {
      extraCaveats.push(
        'NASA POWER weather observations could not be auto-fetched; temperature or rainfall inputs remain incomplete.',
      );
    }

    if (trendsRes.status === 'fulfilled' && trendsRes.value) {
      if (
        mergedInputs.annualRainfallMm === undefined &&
        trendsRes.value.annualPrecipitationMm !== null
      ) {
        mergedInputs.annualRainfallMm = trendsRes.value.annualPrecipitationMm;
      }
    } else if (trendsRes.status === 'rejected') {
      extraCaveats.push('NASA POWER multi-year climate baseline unavailable.');
    }

    if (soilRes.status === 'fulfilled' && soilRes.value) {
      const s = soilRes.value;
      if (mergedInputs.soilPh === undefined && s.surfaceSummary.ph.mean !== null) {
        mergedInputs.soilPh = s.surfaceSummary.ph.mean;
        mergedInputs.soilPhSource = 'modelled_estimate';
      }
      if (mergedInputs.soilTexture === undefined && s.surfaceSummary.textureClass !== null) {
        mergedInputs.soilTexture = s.surfaceSummary.textureClass;
        mergedInputs.soilTextureSource = 'modelled_estimate';
      }
      if (
        mergedInputs.organicCarbonGKg === undefined &&
        s.surfaceSummary.organicCarbonGKg.mean !== null
      ) {
        mergedInputs.organicCarbonGKg = s.surfaceSummary.organicCarbonGKg.mean;
        mergedInputs.organicCarbonSource = 'modelled_estimate';
      }
    } else if (soilRes.status === 'rejected') {
      extraCaveats.push('ISRIC SoilGrids profile could not be auto-fetched.');
    }

    if (moistureRes.status === 'fulfilled' && moistureRes.value) {
      const m = moistureRes.value;
      if (mergedInputs.soilMoistureM3M3 === undefined && m.rootZoneMoistureM3M3 !== null) {
        mergedInputs.soilMoistureM3M3 = m.rootZoneMoistureM3M3;
      }
      if (
        mergedInputs.soilMoistureSurfaceM3M3 === undefined &&
        m.surfaceMoistureM3M3 !== null
      ) {
        mergedInputs.soilMoistureSurfaceM3M3 = m.surfaceMoistureM3M3;
      }
    } else if (moistureRes.status === 'rejected') {
      extraCaveats.push('NASA SMAP soil moisture unavailable.');
    }

    return {
      targetLocation,
      boundaryContext: spatial.boundaryContext,
      spatialProcessing: spatial.spatialProcessing,
      inputs: mergedInputs,
      extraCaveats,
    };
  }

  async generateRotationStrategies(
    request: RotationGenerateRequest,
  ): Promise<RotationPlannerResult> {
    const preferences = resolvePreferences(request.preferences, request.inputs);
    const {
      targetLocation,
      boundaryContext,
      spatialProcessing,
      inputs,
      extraCaveats,
    } = await this.resolveEnvironmentalInputs({
      location: request.location,
      boundary: request.boundary,
      geometry: request.geometry,
      bbox: request.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
      inputs: request.inputs,
      preferences,
      autoFetchMissingFarmData: request.autoFetchMissingFarmData,
      dateRange: request.dateRange,
    });

    const catalog = await this.cropKnowledgeRepository.searchCrops({});
    const strictRegionFilter = request.strictRegionFilter ?? true;

    const strategies = buildStrategySet({
      location: targetLocation,
      crops: catalog.crops,
      inputs,
      preferences,
      currentCrop: request.currentCrop,
      existingSequence: request.existingSequence,
      customSequence: request.customSequence,
      strictRegionFilter,
    });

    return evaluateRotationStrategies({
      location: targetLocation,
      boundary: boundaryContext,
      spatialProcessing,
      inputs,
      preferences,
      strategies,
      weights: request.indicatorWeights,
      crops: catalog.crops,
      regionalRules: this.regionalRules,
      strictRegionFilter,
      extraCaveats,
    });
  }

  async compareRotationStrategies(
    request: RotationCompareRequest,
  ): Promise<RotationPlannerResult> {
    const preferences = resolvePreferences(request.preferences, request.inputs);
    const {
      targetLocation,
      boundaryContext,
      spatialProcessing,
      inputs,
      extraCaveats,
    } = await this.resolveEnvironmentalInputs({
      location: request.location,
      boundary: request.boundary,
      geometry: request.geometry,
      bbox: request.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
      inputs: request.inputs,
      preferences,
      autoFetchMissingFarmData: request.autoFetchMissingFarmData,
      dateRange: request.dateRange,
    });

    const catalog = await this.cropKnowledgeRepository.searchCrops({});
    const strictRegionFilter = request.strictRegionFilter ?? true;

    return evaluateRotationStrategies({
      location: targetLocation,
      boundary: boundaryContext,
      spatialProcessing,
      inputs,
      preferences,
      strategies: request.strategies,
      weights: request.indicatorWeights,
      crops: catalog.crops,
      regionalRules: this.regionalRules,
      strictRegionFilter,
      extraCaveats,
    });
  }

  async buildRotationSchedule(request: CropRotationPlanRequest): Promise<CropRotationPlanResult> {
    const seasonsCount = Math.max(3, Math.min(8, request.rotationYears * 2));
    const result = await this.generateRotationStrategies({
      location: request.location,
      boundary: request.boundary,
      geometry: request.geometry,
      bbox: request.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
      currentCrop: request.currentCrop,
      inputs: request.soilTextureClass ? { soilTexture: request.soilTextureClass } : undefined,
      preferences: {
        seasonsCount,
        waterConservationPriority: request.goals?.some((g) =>
          g.toLowerCase().includes('water'),
        )
          ? 'high'
          : 'moderate',
        soilImprovementPriority: request.goals?.some((g) =>
          g.toLowerCase().includes('soil') || g.toLowerCase().includes('nitrogen'),
        )
          ? 'high'
          : 'moderate',
      },
    });

    const preferred =
      result.strategies.find(
        (s) => s.strategyId === result.recommendation.preferredStrategyId,
      ) ?? result.strategies[0];

    return {
      location: result.location,
      currentCrop: request.currentCrop,
      rotationYears: request.rotationYears,
      cycles: preferred.slots.map((slot) => ({
        year: slot.year,
        season: slot.season,
        cropName: slot.cropName,
        rationale:
          slot.transitionFromPrevious?.residueManagementNote ??
          result.recommendation.whyPreferred,
        soilBenefit: slot.soilConstraintNote,
      })),
      generatedAt: result.generatedAt,
    };
  }
}
