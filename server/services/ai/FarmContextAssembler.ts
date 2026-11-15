import type {
  AiAssistantRequest,
  AiEnvironmentalConflict,
  AiFarmContextPayload,
  AiSourceCitation,
  ClimateTrendSummary,
  CropEnvironmentalInputs,
  CropIntelligenceResult,
  CropKnowledgeProfile,
  EcostressResultPayload,
  FarmEnvironmentalContext,
  GeoCoordinates,
  HlsResultPayload,
  LabSoilTestResult,
  Phase4EnvironmentalAnalytics,
  Phase5FarmIntelligence,
  RotationPlannerResult,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import type {
  ICropKnowledgeRepository,
  ICropRepository,
  IEvapotranspirationRepository,
  IRotationRepository,
  ISoilRepository,
  IVegetationRepository,
  IWeatherRepository,
} from '../../repositories/interfaces/index.ts';
import { runPhase4EnvironmentalAnalytics } from '../../analytics/index.ts';
import { runPhase5FarmIntelligence } from '../../intelligence/index.ts';
import type { IFarmEnvironmentalContextService } from '../interfaces/IFarmEnvironmentalContextService.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';

export interface AssembledFarmContext {
  location: GeoCoordinates | null;
  locationLabel: string;
  weatherTelemetry: WeatherTelemetrySnapshot | null;
  climateTrends: ClimateTrendSummary | null;
  soilProfile: SoilProfile | null;
  soilMoisture: SoilMoistureSnapshot | null;
  labSoilTest: LabSoilTestResult | null;
  cropRecommendations: CropIntelligenceResult | null;
  rotationPlan: RotationPlannerResult | null;
  ecostressPayload: EcostressResultPayload | null;
  hlsPayload: HlsResultPayload | null;
  environmentalContext: FarmEnvironmentalContext | null;
  catalogCrops: CropKnowledgeProfile[];
  mentionedSupportedCrops: CropKnowledgeProfile[];
  unsupportedCropsMentioned: string[];
  measurementsUsed: string[];
  estimatesUsed: string[];
  missingDataIdentified: string[];
  dataConflicts: AiEnvironmentalConflict[];
  sourceCitations: AiSourceCitation[];
  groundedContextSummary: {
    locationLabel: string;
    hasWeather: boolean;
    hasRainfallGpm: boolean;
    hasSoilMoistureSmap: boolean;
    hasSoilProfile: boolean;
    hasLabSoilTest: boolean;
    hasCropRecommendations: boolean;
    hasRotationPlan: boolean;
    hasEcostress: boolean;
    hasHls: boolean;
    hasPhase4Analytics?: boolean;
    hasPhase5Intelligence?: boolean;
    catalogCropsCount: number;
  };
  promptContextText: string;
}

export interface FarmContextRepositories {
  weatherRepository: IWeatherRepository;
  soilRepository: ISoilRepository;
  cropKnowledgeRepository: ICropKnowledgeRepository;
  cropRepository: ICropRepository;
  rotationRepository: IRotationRepository;
  evapotranspirationRepository?: IEvapotranspirationRepository;
  vegetationRepository?: IVegetationRepository;
  farmEnvironmentalContextService?: IFarmEnvironmentalContextService;
}

const KNOWN_EXTERNAL_CROPS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(cotton|kapas|कपास)\b/i, label: 'Cotton' },
  { pattern: /\b(sugarcane|ganna|गन्ना)\b/i, label: 'Sugarcane' },
  { pattern: /\b(banana|kela|केला)\b/i, label: 'Banana' },
  { pattern: /\b(mango|aam|आम)\b/i, label: 'Mango' },
  { pattern: /\b(coffee|कॉफी)\b/i, label: 'Coffee' },
  { pattern: /\b(tea|chai|चाय)\b/i, label: 'Tea' },
  { pattern: /\b(tomato|tamatar|टमाटर)\b/i, label: 'Tomato' },
  { pattern: /\b(potato|aloo|आलू)\b/i, label: 'Potato' },
  { pattern: /\b(onion|pyaz|प्याज)\b/i, label: 'Onion' },
  { pattern: /\b(apple|seb|सेब)\b/i, label: 'Apple' },
  { pattern: /\b(quinoa|किन्वा)\b/i, label: 'Quinoa' },
  { pattern: /\b(avocado|एवोकाडो)\b/i, label: 'Avocado' },
  { pattern: /\b(dragon\s*fruit|ड्रैगन\s*फ्रूट)\b/i, label: 'Dragon Fruit' },
  { pattern: /\b(barley|jau|जौ)\b/i, label: 'Barley' },
  { pattern: /\b(turmeric|haldi|हल्दी)\b/i, label: 'Turmeric' },
];

function buildEnvironmentalInputsFromContext(
  farmCtx: AiFarmContextPayload | undefined,
  weather: WeatherTelemetrySnapshot | null,
  trends: ClimateTrendSummary | null,
  soil: SoilProfile | null,
  moisture: SoilMoistureSnapshot | null,
): CropEnvironmentalInputs {
  const inputs: CropEnvironmentalInputs = {};

  if (farmCtx?.agroClimaticZoneId) inputs.agroClimaticZoneId = farmCtx.agroClimaticZoneId;
  if (farmCtx?.state) inputs.state = farmCtx.state;
  if (farmCtx?.growingSeason) inputs.targetSeason = farmCtx.growingSeason;
  if (farmCtx?.farmingSystem) {
    inputs.farmingSystem = farmCtx.farmingSystem;
    inputs.irrigationAvailable = farmCtx.farmingSystem !== 'rainfed';
  } else if (farmCtx?.irrigationAvailable !== undefined) {
    inputs.irrigationAvailable = farmCtx.irrigationAvailable;
  }

  if (weather) {
    if (weather.summary.meanTempC !== null) inputs.temperatureMeanC = weather.summary.meanTempC;
    if (weather.summary.maxTempC !== null) inputs.temperatureMaxC = weather.summary.maxTempC;
    if (weather.summary.minTempC !== null) inputs.temperatureMinC = weather.summary.minTempC;
    if (weather.summary.availableDays > 0) {
      inputs.observedRainfallMm = weather.summary.totalPrecipitationMm;
      inputs.observationDays = weather.summary.availableDays;
    }
    if (
      weather.gpmImerg?.status === 'available' &&
      weather.gpmImerg.precipitationRateMmHr !== null
    ) {
      inputs.gpmPrecipitationRateMmHr = weather.gpmImerg.precipitationRateMmHr;
    }
  }

  if (trends?.annualPrecipitationMm !== null && trends?.annualPrecipitationMm !== undefined) {
    inputs.annualRainfallMm = trends.annualPrecipitationMm;
  }

  const lab = farmCtx?.labSoilTest ?? null;
  if (lab?.ph !== null && lab?.ph !== undefined) {
    inputs.soilPh = lab.ph;
    inputs.soilPhSource = 'measured_lab';
  } else if (soil?.surfaceSummary?.ph?.mean !== null && soil?.surfaceSummary?.ph?.mean !== undefined) {
    inputs.soilPh = soil.surfaceSummary.ph.mean;
    inputs.soilPhSource = 'modelled_estimate';
  }

  if (lab?.textureClass) {
    inputs.soilTexture = lab.textureClass;
    inputs.soilTextureSource = 'measured_lab';
  } else if (soil?.surfaceSummary?.textureClass) {
    inputs.soilTexture = soil.surfaceSummary.textureClass;
    inputs.soilTextureSource = 'modelled_estimate';
  }

  if (lab?.organicCarbonGKg !== null && lab?.organicCarbonGKg !== undefined) {
    inputs.organicCarbonGKg = lab.organicCarbonGKg;
    inputs.organicCarbonSource = 'measured_lab';
  } else if (
    soil?.surfaceSummary?.organicCarbonGKg?.mean !== null &&
    soil?.surfaceSummary?.organicCarbonGKg?.mean !== undefined
  ) {
    inputs.organicCarbonGKg = soil.surfaceSummary.organicCarbonGKg.mean;
    inputs.organicCarbonSource = 'modelled_estimate';
  }

  if (moisture?.rootZoneMoistureM3M3 !== null && moisture?.rootZoneMoistureM3M3 !== undefined) {
    inputs.soilMoistureM3M3 = moisture.rootZoneMoistureM3M3;
  }
  if (moisture?.surfaceMoistureM3M3 !== null && moisture?.surfaceMoistureM3M3 !== undefined) {
    inputs.soilMoistureSurfaceM3M3 = moisture.surfaceMoistureM3M3;
  }

  return inputs;
}

export async function assembleGroundedFarmContext(
  request: AiAssistantRequest,
  repos: FarmContextRepositories,
): Promise<AssembledFarmContext> {
  const farmCtx = request.farmContext;
  const requestedMode = farmCtx?.spatialProcessingMode ?? request.spatialProcessingMode;
  const mergedBoundary = farmCtx?.boundary ?? request.boundary;
  const mergedGeometry = farmCtx?.geometry ?? request.geometry;
  const mergedBbox = farmCtx?.bbox ?? request.bbox;
  const hasSpatialInput = Boolean(
    mergedBoundary || mergedGeometry || mergedBbox || request.location || requestedMode === 'polygon',
  );

  const spatial = hasSpatialInput
    ? resolveSpatialRequestContext(
        {
          location: request.location,
          boundary: mergedBoundary,
          geometry: mergedGeometry,
          bbox: mergedBbox,
          spatialProcessingMode: requestedMode,
        },
        'AI assistant grounded farm context',
      )
    : null;

  const location = spatial?.targetLocation ?? null;
  const resolvedBoundary = spatial?.boundaryContext;
  const locationLabel = resolvedBoundary
    ? `${resolvedBoundary.name} (${resolvedBoundary.areaHectares.toFixed(2)} ha, ${resolvedBoundary.centroid.latitude.toFixed(4)}°, ${resolvedBoundary.centroid.longitude.toFixed(4)}°)`
    : farmCtx?.farmName && location
      ? `${farmCtx.farmName} (${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°)`
      : location
        ? `${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°`
        : 'No farm parcel or coordinates selected';

  let weatherTelemetry = farmCtx?.weatherTelemetry ?? null;
  let climateTrends = farmCtx?.climateTrends ?? null;
  let soilProfile = farmCtx?.soilProfile ?? null;
  let soilMoisture = farmCtx?.soilMoisture ?? null;
  const labSoilTest = farmCtx?.labSoilTest ?? null;
  let cropRecommendations = farmCtx?.cropRecommendations ?? null;
  let rotationPlan = farmCtx?.rotationPlan ?? null;
  let ecostressPayload =
    farmCtx?.ecostressPayload ?? farmCtx?.environmentalContext?.ecostressPayload ?? null;
  let hlsPayload = farmCtx?.hlsPayload ?? farmCtx?.environmentalContext?.hlsPayload ?? null;
  let environmentalContext = farmCtx?.environmentalContext ?? null;

  const catalogResult = await repos.cropKnowledgeRepository.searchCrops({});
  const catalogCrops = catalogResult.crops;

  const shouldAutoFetch = request.autoFetchContext !== false && location !== null;

  if (shouldAutoFetch && location) {
    if (repos.farmEnvironmentalContextService && (!environmentalContext || !ecostressPayload || !hlsPayload)) {
      try {
        environmentalContext = await repos.farmEnvironmentalContextService.assembleContext({
          location,
          boundary: resolvedBoundary,
          geometry: spatial?.geometry,
          bbox: spatial?.bbox,
          spatialProcessingMode: requestedMode,
        });
        if (!weatherTelemetry && environmentalContext.features) {
          // EnvironmentalContextService provides features & payloads
        }
        if (!ecostressPayload) ecostressPayload = environmentalContext.ecostressPayload ?? null;
        if (!hlsPayload) hlsPayload = environmentalContext.hlsPayload ?? null;
      } catch {
        // Fallback gracefully
      }
    }

    const [weatherRes, trendsRes, soilRes, moistureRes] = await Promise.allSettled([
      weatherTelemetry
        ? Promise.resolve(weatherTelemetry)
        : repos.weatherRepository.fetchWeatherTelemetry({
            location,
            boundary: resolvedBoundary,
            geometry: spatial?.geometry,
            bbox: spatial?.bbox,
            spatialProcessingMode: requestedMode,
            includeGpmImerg: true,
          }),
      climateTrends
        ? Promise.resolve(climateTrends)
        : repos.weatherRepository.fetchClimateTrends({
            latitude: location.latitude,
            longitude: location.longitude,
            years: 5,
          }),
      soilProfile
        ? Promise.resolve(soilProfile)
        : repos.soilRepository.fetchSoilProfile({
            location,
            boundary: resolvedBoundary,
            geometry: spatial?.geometry,
            bbox: spatial?.bbox,
            spatialProcessingMode: requestedMode,
            depthCm: '0-5',
          }),
      soilMoisture
        ? Promise.resolve(soilMoisture)
        : repos.soilRepository.fetchSoilMoisture({
            location,
            boundary: resolvedBoundary,
            geometry: spatial?.geometry,
            bbox: spatial?.bbox,
            spatialProcessingMode: requestedMode,
          }),
    ]);

    if (!weatherTelemetry && weatherRes.status === 'fulfilled') weatherTelemetry = weatherRes.value;
    if (!climateTrends && trendsRes.status === 'fulfilled') climateTrends = trendsRes.value;
    if (!soilProfile && soilRes.status === 'fulfilled') soilProfile = soilRes.value;
    if (!soilMoisture && moistureRes.status === 'fulfilled') soilMoisture = moistureRes.value;

    const assembledInputs = buildEnvironmentalInputsFromContext(
      farmCtx,
      weatherTelemetry,
      climateTrends,
      soilProfile,
      soilMoisture,
    );

    const currentCrop = request.currentCrop ?? farmCtx?.currentCrop;

    const [recRes, rotRes] = await Promise.allSettled([
      cropRecommendations
        ? Promise.resolve(cropRecommendations)
        : repos.cropRepository.evaluateSuitability({
            location,
            boundary: resolvedBoundary,
            geometry: spatial?.geometry,
            bbox: spatial?.bbox,
            spatialProcessingMode: requestedMode,
            autoFetchMissingFarmData: false,
            strictRegionFilter: Boolean(farmCtx?.agroClimaticZoneId || farmCtx?.state),
            inputs: assembledInputs,
            preferences: {
              growingSeason: farmCtx?.growingSeason,
              farmingSystem: farmCtx?.farmingSystem,
              irrigationAvailable: farmCtx?.irrigationAvailable,
              currentCrop,
            },
          }),
      rotationPlan
        ? Promise.resolve(rotationPlan)
        : repos.rotationRepository.generateRotationStrategies({
            location,
            boundary: resolvedBoundary,
            geometry: spatial?.geometry,
            bbox: spatial?.bbox,
            spatialProcessingMode: requestedMode,
            autoFetchMissingFarmData: false,
            strictRegionFilter: Boolean(farmCtx?.agroClimaticZoneId || farmCtx?.state),
            currentCrop,
            inputs: assembledInputs,
            preferences: {
              startingSeason: farmCtx?.growingSeason ?? 'Kharif',
              farmingSystem: farmCtx?.farmingSystem,
              irrigationAvailable: farmCtx?.irrigationAvailable,
              seasonsCount: 4,
            },
          }),
    ]);

    if (!cropRecommendations && recRes.status === 'fulfilled') cropRecommendations = recRes.value;
    if (!rotationPlan && rotRes.status === 'fulfilled') rotationPlan = rotRes.value;
  }

  // Identify crops mentioned in prompt / currentCrop
  const combinedQuery = `${request.prompt} ${request.currentCrop ?? ''} ${farmCtx?.currentCrop ?? ''}`.toLowerCase();
  const mentionedSupportedCrops = catalogCrops.filter((crop) => {
    if (combinedQuery.includes(crop.cropName.toLowerCase()) || combinedQuery.includes(crop.id.toLowerCase())) {
      return true;
    }
    return crop.localNames.some((ln) => combinedQuery.includes(ln.toLowerCase()));
  });

  const unsupportedCropsMentioned = KNOWN_EXTERNAL_CROPS.filter(
    ({ pattern, label }) =>
      pattern.test(combinedQuery) &&
      !mentionedSupportedCrops.some((c) => c.cropName.toLowerCase() === label.toLowerCase()),
  ).map((item) => item.label);

  // Validated Phase 4 Environmental Analytics (ECOSTRESS & HLS Quality, Trends, Stress, Confidence, Alerts)
  const phase4Analytics: Phase4EnvironmentalAnalytics | null =
    farmCtx?.environmentalAnalytics ??
    farmCtx?.farmIntelligence?.phase4Analytics ??
    environmentalContext?.environmentalAnalytics ??
    (ecostressPayload || hlsPayload
      ? runPhase4EnvironmentalAnalytics({ ecostressPayload, hlsPayload })
      : null);

  // Validated Phase 5 Farm-Level Predictive & Actionable Intelligence
  const phase5Intelligence: Phase5FarmIntelligence | null =
    farmCtx?.farmIntelligence ??
    (phase4Analytics && location
      ? runPhase5FarmIntelligence({
          location,
          boundaryContext: farmCtx?.boundary,
          ecostressPayload,
          hlsPayload,
          weatherTelemetry,
          soilProfile,
          soilMoisture,
          labSoilTest,
          precomputedPhase4: phase4Analytics,
        })
      : null);

  const etSnap = phase4Analytics?.qualityReport.latestValidMetrics.etDailyWm2;
  const esiSnap = phase4Analytics?.qualityReport.latestValidMetrics.esiRatio;
  const ndviSnap = phase4Analytics?.qualityReport.latestValidMetrics.ndvi;
  const ndwiSnap = phase4Analytics?.qualityReport.latestValidMetrics.ndwi;

  const etDailyWm2 = etSnap?.value ?? environmentalContext?.features?.etDailyWm2 ?? null;
  const esiRatio = esiSnap?.value ?? environmentalContext?.features?.esiRatio ?? null;
  const ecoDate = etSnap?.observationTimestamp ?? esiSnap?.observationTimestamp ?? null;

  const ndvi = ndviSnap?.value ?? environmentalContext?.features?.ndvi ?? null;
  const ndwi = ndwiSnap?.value ?? environmentalContext?.features?.ndwi ?? null;
  const hlsDate = ndviSnap?.observationTimestamp ?? ndwiSnap?.observationTimestamp ?? null;


  // Separate Measurements vs Estimates vs Missing Data
  const measurementsUsed: string[] = [];
  const estimatesUsed: string[] = [];
  const missingDataIdentified: string[] = [];

  if (!location) {
    missingDataIdentified.push(
      'Farm parcel coordinates or boundary not selected; location-specific NASA weather and SoilGrids queries could not run.',
    );
  }

  if (weatherTelemetry && weatherTelemetry.summary.availableDays > 0) {
    measurementsUsed.push(
      `NASA POWER Observed Weather (${weatherTelemetry.dateRange.startDate} to ${weatherTelemetry.dateRange.endDate}, ${weatherTelemetry.summary.availableDays}d): Mean Temp ${weatherTelemetry.summary.meanTempC !== null ? `${weatherTelemetry.summary.meanTempC.toFixed(1)} °C` : 'N/A'}, Cumulative Rainfall ${weatherTelemetry.summary.totalPrecipitationMm.toFixed(1)} mm.`,
    );
  } else {
    missingDataIdentified.push('NASA POWER recent weather observations (temperature, rainfall, solar radiation) are unavailable.');
  }

  if (
    weatherTelemetry?.gpmImerg?.status === 'available' &&
    weatherTelemetry.gpmImerg.precipitationRateMmHr !== null
  ) {
    measurementsUsed.push(
      `NASA GPM IMERG Satellite Rainfall Rate: ${weatherTelemetry.gpmImerg.precipitationRateMmHr.toFixed(2)} mm/hr (${weatherTelemetry.gpmImerg.observationTimestamp ?? 'latest retrieval'}).`,
    );
  } else {
    missingDataIdentified.push('NASA GPM IMERG near-real-time satellite precipitation rate is unavailable or NoData.');
  }

  if (
    soilMoisture?.status === 'available' &&
    (soilMoisture.rootZoneMoistureM3M3 != null || soilMoisture.surfaceMoistureM3M3 != null)
  ) {
    const rootStr = soilMoisture.rootZoneMoistureM3M3 != null ? `${soilMoisture.rootZoneMoistureM3M3.toFixed(3)} m³/m³` : 'N/A';
    const surfStr = soilMoisture.surfaceMoistureM3M3 != null ? `${soilMoisture.surfaceMoistureM3M3.toFixed(3)} m³/m³` : 'N/A';
    measurementsUsed.push(
      `NASA SMAP L4 Satellite Soil Moisture (${soilMoisture.observationDate}): Root-zone ${rootStr}, Surface ${surfStr}.`,
    );
  } else {
    missingDataIdentified.push('NASA SMAP L4 satellite soil moisture reading is unavailable.');
  }

  // ECOSTRESS measurements
  if (etDailyWm2 !== null && etDailyWm2 !== undefined) {
    measurementsUsed.push(
      `NASA ECOSTRESS Daily Evapotranspiration (ECO_L3T_JET.002, 70m thermal grid): ET = ${etDailyWm2.toFixed(1)} W/m² (observation date: ${etSnap?.observationTimestamp ?? ecoDate ?? 'unknown'}, coverage: ${etSnap?.coveragePercent ?? 'N/A'}%). NOTE: Expressed in W/m² thermal energy flux, NOT mm/day water depth; do not infer irrigation requirements directly from ET.`,
    );
  } else {
    missingDataIdentified.push('NASA ECOSTRESS daily evapotranspiration (ET, ECO_L3T_JET) observation is unavailable.');
  }

  if (esiRatio !== null && esiRatio !== undefined) {
    measurementsUsed.push(
      `NASA ECOSTRESS Evaporative Stress Index (ECO_L4T_ESI.002, 70m thermal grid): ESI = ${esiRatio.toFixed(3)} ratio (observation date: ${esiSnap?.observationTimestamp ?? ecoDate ?? 'unknown'}).`,
    );
  } else {
    missingDataIdentified.push('NASA ECOSTRESS Evaporative Stress Index (ESI, ECO_L4T_ESI) observation is unavailable.');
  }

  // Landsat/HLS measurements
  if (ndvi !== null && ndvi !== undefined) {
    measurementsUsed.push(
      `NASA Landsat/HLS NDVI Vegetation Index (HLSL30/S30 v002, 30m reflectance grid): NDVI = ${ndvi.toFixed(3)} (acquisition date: ${ndviSnap?.observationTimestamp ?? hlsDate ?? 'unknown'}, coverage: ${ndviSnap?.coveragePercent ?? 'N/A'}%).`,
    );
  } else {
    missingDataIdentified.push('NASA Landsat/HLS NDVI vegetation greenness observation is unavailable.');
  }

  if (ndwi !== null && ndwi !== undefined) {
    measurementsUsed.push(
      `NASA Landsat/HLS NDWI Water Index (HLSL30/S30 v002, 30m reflectance grid): NDWI = ${ndwi.toFixed(3)} (acquisition date: ${ndwiSnap?.observationTimestamp ?? hlsDate ?? 'unknown'}). NOTE: NDWI indicates vegetation canopy water content / surface wetness, NOT direct soil moisture.`,
    );
  } else {
    missingDataIdentified.push('NASA Landsat/HLS NDWI water index observation is unavailable.');
  }

  if (labSoilTest) {
    const parts: string[] = [];
    if (labSoilTest.ph !== null && labSoilTest.ph !== undefined) parts.push(`pH ${labSoilTest.ph.toFixed(1)}`);
    if (labSoilTest.textureClass) parts.push(`Texture ${labSoilTest.textureClass}`);
    if (labSoilTest.organicCarbonGKg !== null && labSoilTest.organicCarbonGKg !== undefined) {
      parts.push(`OC ${labSoilTest.organicCarbonGKg.toFixed(1)} g/kg`);
    }
    if (
      labSoilTest.availableNitrogenMgKg !== null &&
      labSoilTest.availableNitrogenMgKg !== undefined
    ) {
      parts.push(`Avail N ${labSoilTest.availableNitrogenMgKg} mg/kg`);
    } else if (labSoilTest.totalNitrogenGKg !== null && labSoilTest.totalNitrogenGKg !== undefined) {
      parts.push(`Total N ${labSoilTest.totalNitrogenGKg} g/kg`);
    }
    if (parts.length > 0) {
      measurementsUsed.push(`Measured Farm Lab Soil Test (${labSoilTest.sampleDate || 'user-entered'}): ${parts.join(', ')}.`);
    }
  } else {
    missingDataIdentified.push('Parcel-level laboratory soil test (measured pH, NPK, EC) is not calibrated; relying on modelled soil estimates if available.');
  }

  if (climateTrends?.annualPrecipitationMm !== null && climateTrends?.annualPrecipitationMm !== undefined) {
    measurementsUsed.push(
      `NASA POWER ${climateTrends.baselineYears}-Year Climate Baseline: Annual mean ${climateTrends.annualMeanTempC?.toFixed(1) ?? 'N/A'} °C, annual rainfall ${climateTrends.annualPrecipitationMm.toFixed(0)} mm/yr (precip anomaly ${climateTrends.precipitationAnomalyPercent ?? 'N/A'}%).`,
    );
  }

  if (soilProfile?.status === 'available') {
    const ph = soilProfile.surfaceSummary.ph;
    const oc = soilProfile.surfaceSummary.organicCarbonGKg;
    estimatesUsed.push(
      `ISRIC SoilGrids v2.0 Modelled Estimate (${soilProfile.selectedDepthCm} cm): Texture ${soilProfile.surfaceSummary.textureClass ?? 'Unavailable'}, pH ${ph.mean !== null ? `${ph.mean.toFixed(1)} (Q05–Q95: ${ph.q05 ?? '?'}–${ph.q95 ?? '?'})` : 'Unavailable'}, OC ${oc.mean !== null ? `${oc.mean.toFixed(1)} g/kg` : 'Unavailable'}.`,
    );
  } else {
    missingDataIdentified.push('ISRIC SoilGrids modelled soil profile (pH, clay/sand/silt texture, organic carbon) is unavailable.');
  }

  if (cropRecommendations && cropRecommendations.recommendations.length > 0) {
    const topNames = cropRecommendations.recommendations
      .slice(0, 3)
      .map((r) => `${r.cropName} (${r.suitabilityScore}/100, ${r.suitabilityCategory})`)
      .join('; ');
    estimatesUsed.push(
      `Deterministic Crop Suitability Index (0–100, NOT yield): Top ranked — ${topNames}.`,
    );
  } else if (cropRecommendations?.evaluationStatus === 'insufficient_essential_data') {
    missingDataIdentified.push('Crop suitability ranking blocked due to insufficient essential weather/soil inputs.');
  }

  if (rotationPlan && rotationPlan.strategies.length > 0) {
    estimatesUsed.push(
      `Deterministic Crop Rotation Planner (${rotationPlan.engineVersion}): Preferred "${rotationPlan.recommendation.preferredStrategyLabel}" (${rotationPlan.strategies.find((s) => s.strategyId === rotationPlan.recommendation.preferredStrategyId)?.overallScore ?? 'N/A'}/100; qualitative indicators & ICAR reference ranges only, NOT SOC% or yield predictions).`,
    );
  }

  if (farmCtx?.farmingSystem === undefined && farmCtx?.irrigationAvailable === undefined) {
    missingDataIdentified.push('Farm irrigation access (rainfed vs. supplemental vs. irrigated) was not specified.');
  }

  if (unsupportedCropsMentioned.length > 0) {
    missingDataIdentified.push(
      `Requested crop(s) [${unsupportedCropsMentioned.join(', ')}] are NOT present in FieldShift AI's validated ICAR crop knowledge base (${catalogCrops.length} catalogued Indian field crops). No suitability score or ICAR parameter profile exists for them here.`,
    );
  }

  // Detect Conflicting Environmental Information
  const dataConflicts: AiEnvironmentalConflict[] = [];

  // Conflict 1: Measured Lab Soil Test vs ISRIC SoilGrids Modelled Estimate
  if (labSoilTest && soilProfile?.status === 'available') {
    const sgPh = soilProfile.surfaceSummary.ph.mean;
    if (
      labSoilTest.ph !== null &&
      labSoilTest.ph !== undefined &&
      sgPh !== null &&
      Math.abs(labSoilTest.ph - sgPh) >= 0.7
    ) {
      dataConflicts.push({
        topic: 'Soil pH Discrepancy (Lab Measurement vs. SoilGrids Estimate)',
        observationA: `Measured Lab Soil Test reports pH ${labSoilTest.ph.toFixed(1)}`,
        observationB: `ISRIC SoilGrids 250m modelled estimate reports pH ${sgPh.toFixed(1)}`,
        guidance:
          'Prioritize the parcel-level laboratory soil measurement over coarse 250m satellite-modelled SoilGrids estimates, and verify sampling depth.',
      });
    }
    const sgTex = soilProfile.surfaceSummary.textureClass;
    if (
      labSoilTest.textureClass &&
      sgTex &&
      labSoilTest.textureClass.toLowerCase() !== sgTex.toLowerCase()
    ) {
      dataConflicts.push({
        topic: 'Soil Texture Difference (Lab vs. SoilGrids)',
        observationA: `Measured Lab texture: ${labSoilTest.textureClass}`,
        observationB: `SoilGrids modelled texture: ${sgTex}`,
        guidance:
          'Use the field-measured texture class for drainage and water-retention planning; local topsoil variability often differs from regional 250m grids.',
      });
    }
  }

  // Conflict 2: Observed Rainfall vs NASA SMAP Soil Moisture
  const obsRain = weatherTelemetry?.summary.totalPrecipitationMm ?? null;
  const smapRoot = soilMoisture?.rootZoneMoistureM3M3 ?? null;
  if (obsRain !== null && smapRoot !== null) {
    if (obsRain >= 180 && smapRoot < 0.14) {
      dataConflicts.push({
        topic: 'High Rainfall vs. Low SMAP Root-Zone Moisture',
        observationA: `NASA POWER cumulative rainfall is ${obsRain.toFixed(1)} mm`,
        observationB: `NASA SMAP root-zone moisture is dry (${smapRoot.toFixed(3)} m³/m³)`,
        guidance:
          'May indicate high surface runoff/sandy drainage, timing lag since rain events, or 9 km SMAP pixel averaging; check field infiltration and topsoil moisture manually.',
      });
    } else if (obsRain <= 25 && smapRoot >= 0.38) {
      dataConflicts.push({
        topic: 'Low Rainfall vs. High SMAP Root-Zone Moisture',
        observationA: `NASA POWER recent rainfall is minimal (${obsRain.toFixed(1)} mm)`,
        observationB: `NASA SMAP root-zone moisture is elevated (${smapRoot.toFixed(3)} m³/m³)`,
        guidance:
          'Elevated root-zone moisture despite dry weather suggests active canal/borewell irrigation, heavy clay retention, or regional pixel averaging.',
      });
    }
  }

  // Conflict 3: SMAP Soil Moisture vs ECOSTRESS ESI
  if (smapRoot !== null && esiRatio !== null) {
    if (smapRoot >= 0.35 && esiRatio <= 0.30) {
      dataConflicts.push({
        topic: 'High SMAP Soil Moisture vs. Low ECOSTRESS Evaporative Stress (ESI)',
        observationA: `NASA SMAP root-zone moisture is high (${smapRoot.toFixed(3)} m³/m³)`,
        observationB: `ECOSTRESS ESI is low (${esiRatio.toFixed(3)} ratio)`,
        guidance:
          'High root-zone moisture with low ESI may indicate thermal stress due to high atmospheric vapor pressure deficit (VPD), salinity, or crop rooting restrictions despite available soil water.',
      });
    } else if (smapRoot <= 0.15 && esiRatio >= 0.80) {
      dataConflicts.push({
        topic: 'Low SMAP Soil Moisture vs. High ECOSTRESS Evaporative Stress Index (ESI)',
        observationA: `NASA SMAP root-zone moisture is dry (${smapRoot.toFixed(3)} m³/m³)`,
        observationB: `ECOSTRESS ESI is high (${esiRatio.toFixed(3)} ratio)`,
        guidance:
          'Low microwave soil moisture combined with high ESI suggests active supplemental irrigation or deep-rooted access to moisture not fully resolved by coarse SMAP pixels.',
      });
    }
  }

  // Conflict 4: HLS NDVI vs ECOSTRESS ESI
  if (ndvi !== null && esiRatio !== null) {
    if (ndvi >= 0.70 && esiRatio <= 0.30) {
      dataConflicts.push({
        topic: 'High Canopy Greenness (NDVI) vs. Severe Thermal Stress (ECOSTRESS ESI)',
        observationA: `Landsat/HLS NDVI indicates dense green canopy (${ndvi.toFixed(3)})`,
        observationB: `ECOSTRESS ESI indicates severe evaporative/thermal stress (${esiRatio.toFixed(3)})`,
        guidance:
          'A lush green canopy with low ESI can reflect high transpiration demand and impending water stress before visual wilting occurs; inspect canopy temperature and irrigation scheduling.',
      });
    }
  }

  // Conflict 5: Temporal Acquisition Date Discrepancy
  if (ecoDate && hlsDate && ecoDate !== hlsDate) {
    const ecoTime = Date.parse(ecoDate);
    const hlsTime = Date.parse(hlsDate);
    if (!Number.isNaN(ecoTime) && !Number.isNaN(hlsTime)) {
      const diffDays = Math.abs(ecoTime - hlsTime) / (1000 * 60 * 60 * 24);
      if (diffDays > 7) {
        dataConflicts.push({
          topic: 'Temporal Acquisition Gap Between ECOSTRESS and Landsat/HLS',
          observationA: `ECOSTRESS observation date: ${ecoDate}`,
          observationB: `Landsat/HLS acquisition date: ${hlsDate} (${Math.round(diffDays)} days apart)`,
          guidance:
            'ECOSTRESS thermal observations and HLS optical reflectance have different acquisition timestamps and must not be treated as simultaneous measurements; evaluate weather changes between dates.',
        });
      }
    }
  }

  // Conflict 6: Rainfed farming vs High-water crop mentioned/selected
  const isRainfed = farmCtx?.farmingSystem === 'rainfed' || farmCtx?.irrigationAvailable === false;
  if (isRainfed) {
    for (const crop of mentionedSupportedCrops) {
      if (crop.waterRequirements.value?.category === 'high') {
        dataConflicts.push({
          topic: `Water Demand Conflict for ${crop.cropName}`,
          observationA: 'Farm system is set to rainfed (no irrigation)',
          observationB: `${crop.cropName} has high seasonal water demand (${crop.waterRequirements.value.seasonalMinMm}–${crop.waterRequirements.value.seasonalMaxMm} mm)`,
          guidance:
            'High-water crops carry elevated moisture-stress risk under rainfed conditions unless supplemental irrigation is confirmed.',
        });
      }
    }
  }

  // Conflict 7: User prompt qualitative assertion contradicting observed telemetry
  const promptLower = request.prompt.toLowerCase();
  if (obsRain !== null && smapRoot !== null) {
    if (
      /\b(flood|waterlogged|heavy rain|excess rain)\b/i.test(promptLower) &&
      obsRain < 20 &&
      smapRoot < 0.16
    ) {
      dataConflicts.push({
        topic: 'User-Described Wetness vs. Observed Dry Satellite/Weather Data',
        observationA: 'User prompt references flooding or excess rainfall',
        observationB: `Observed NASA POWER rainfall (${obsRain.toFixed(1)} mm) and SMAP moisture (${smapRoot.toFixed(3)} m³/m³) are low`,
        guidance:
          'Recent localized storm/canal waterlogging may not yet appear in gridded/delayed satellite datasets; inspect parcel drainage directly before sowing.',
      });
    }
    if (
      /\b(drought|bone dry|no rain|zero moisture)\b/i.test(promptLower) &&
      obsRain > 220 &&
      smapRoot > 0.34
    ) {
      dataConflicts.push({
        topic: 'User-Described Drought vs. Observed High Moisture/Rainfall',
        observationA: 'User prompt references drought or dry soil',
        observationB: `NASA POWER (${obsRain.toFixed(1)} mm) and SMAP (${smapRoot.toFixed(3)} m³/m³) indicate substantial moisture`,
        guidance:
          'Coarse satellite grids (~9–50 km) can differ from micro-parcel conditions; confirm field moisture at root depth (15 cm).',
      });
    }
  }

  // Build Source Citations
  const sourceCitations: AiSourceCitation[] = [
    {
      sourceId: 'nasa-power',
      label: 'NASA POWER Agroclimatology',
      category: 'measured',
      status: weatherTelemetry && weatherTelemetry.summary.availableDays > 0 ? 'available' : 'unavailable',
      summary:
        weatherTelemetry && weatherTelemetry.summary.availableDays > 0
          ? `${weatherTelemetry.summary.availableDays}d observed historical weather (${weatherTelemetry.summary.meanTempC?.toFixed(1) ?? 'N/A'} °C mean, ${weatherTelemetry.summary.totalPrecipitationMm.toFixed(1)} mm rain)`
          : 'Not fetched or unavailable for current selection',
    },
    {
      sourceId: 'nasa-gpm-imerg',
      label: 'NASA GPM IMERG Rainfall',
      category: 'satellite_observation',
      status:
        weatherTelemetry?.gpmImerg?.status === 'available' ? 'available' : 'unavailable',
      summary:
        weatherTelemetry?.gpmImerg?.status === 'available' &&
        weatherTelemetry.gpmImerg.precipitationRateMmHr !== null
          ? `Satellite precipitation rate ${weatherTelemetry.gpmImerg.precipitationRateMmHr.toFixed(2)} mm/hr`
          : 'GPM IMERG rate unavailable or NoData',
    },
    {
      sourceId: 'nasa-smap',
      label: 'NASA SMAP L4 Soil Moisture',
      category: 'satellite_observation',
      status: soilMoisture?.status === 'available' ? 'available' : 'unavailable',
      summary:
        soilMoisture?.status === 'available'
          ? `Root-zone ${soilMoisture.rootZoneMoistureM3M3?.toFixed(3) ?? 'N/A'} m³/m³, Surface ${soilMoisture.surfaceMoistureM3M3?.toFixed(3) ?? 'N/A'} m³/m³`
          : 'SMAP L4 moisture unavailable',
    },
    {
      sourceId: 'nasa-ecostress',
      label: 'NASA ECOSTRESS Evapotranspiration & ESI',
      category: 'satellite_observation',
      status: etDailyWm2 !== null || esiRatio !== null ? 'available' : 'unavailable',
      summary:
        etDailyWm2 !== null || esiRatio !== null
          ? `ECOSTRESS 70m thermal: ET ${etDailyWm2 !== null ? `${etDailyWm2.toFixed(1)} W/m²` : 'N/A'}, ESI ${esiRatio !== null ? esiRatio.toFixed(3) : 'N/A'}`
          : 'ECOSTRESS evapotranspiration unavailable',
    },
    {
      sourceId: 'nasa-hls',
      label: 'NASA Landsat/HLS Surface Reflectance (NDVI/NDWI)',
      category: 'satellite_observation',
      status: ndvi !== null || ndwi !== null ? 'available' : 'unavailable',
      summary:
        ndvi !== null || ndwi !== null
          ? `HLS 30m reflectance: NDVI ${ndvi !== null ? ndvi.toFixed(3) : 'N/A'}, NDWI ${ndwi !== null ? ndwi.toFixed(3) : 'N/A'}`
          : 'Landsat/HLS vegetation indices unavailable',
    },
    {
      sourceId: 'isric-soilgrids',
      label: 'ISRIC SoilGrids v2.0',
      category: 'modelled_estimate',
      status: soilProfile?.status === 'available' ? 'available' : 'unavailable',
      summary:
        soilProfile?.status === 'available'
          ? `Modelled 0–5 cm estimate: ${soilProfile.surfaceSummary.textureClass ?? 'N/A'}, pH ${soilProfile.surfaceSummary.ph.mean?.toFixed(1) ?? 'N/A'} (Q05–Q95)`
          : 'SoilGrids modelled profile unavailable',
    },
    {
      sourceId: 'lab-soil-test',
      label: 'Farmer Lab Soil Test',
      category: 'measured',
      status: labSoilTest ? 'available' : 'unavailable',
      summary: labSoilTest
        ? `User-calibrated lab measurement (pH ${labSoilTest.ph ?? 'N/A'}, ${labSoilTest.textureClass ?? 'texture N/A'})`
        : 'No lab soil test calibrated for parcel',
    },
    {
      sourceId: 'icar-knowledge-base',
      label: 'ICAR / KVK Crop Knowledge Base',
      category: 'knowledge_base',
      status: 'available',
      summary: `${catalogCrops.length} validated Indian field crops (water, pH, season, N-fixation, rotation rules)`,
    },
    {
      sourceId: 'fieldshift-engines',
      label: 'FieldShift Suitability & Rotation Engines',
      category: 'deterministic_engine',
      status: cropRecommendations || rotationPlan ? 'available' : 'partial',
      summary: `Deterministic scoring & rotation constraint evaluation (${cropRecommendations?.recommendations.length ?? 0} eligible crops, ${rotationPlan?.strategies.length ?? 0} rotation strategies)`,
    },
  ];

  // Compact grounded context packet for Gemini prompt
  const recSummaryLines = cropRecommendations
    ? [
        `Evaluation Status: ${cropRecommendations.evaluationStatus}`,
        `Top Suitable Crops: ${cropRecommendations.recommendations
          .slice(0, 5)
          .map(
            (r) =>
              `${r.cropName} (score ${r.suitabilityScore}/100, ${r.suitabilityCategory}, confidence ${r.dataConfidence.level} ${r.dataConfidence.score}%, water ${r.waterRequirementDetail.category} ${r.waterRequirementDetail.seasonalMinMm}-${r.waterRequirementDetail.seasonalMaxMm}mm; strengths: ${r.advantages.slice(0, 2).join('; ')}; limits: ${r.limitations.slice(0, 2).join('; ')})`,
          )
          .join(' | ')}`,
        `Excluded/Unsuitable Crops: ${cropRecommendations.excludedCrops
          .slice(0, 5)
          .map((e) => `${e.cropName} (rejected: ${e.rejectionReasons.slice(0, 2).join('; ')})`)
          .join(' | ')}`,
      ]
    : ['No crop suitability evaluation run yet.'];

  const rotSummaryLines =
    rotationPlan && rotationPlan.strategies.length > 0
      ? [
          `Preferred Strategy: ${rotationPlan.recommendation?.preferredStrategyLabel ?? rotationPlan.strategies[0]?.label ?? 'N/A'} — ${rotationPlan.recommendation?.whyPreferred ?? 'Top evaluated strategy'}`,
          `Strategies Compared: ${rotationPlan.strategies
            .map(
              (s) =>
                `${s.label} [score ${s.overallScore}/100, eligible=${s.isEligible}, risk=${s.indicators.agronomicRisk.riskLevel}, diversity=${s.indicators.cropDiversity.diversityRating} (${s.indicators.cropDiversity.uniqueFamiliesCount} families), N=${s.indicators.potentialNitrogenContribution.qualitativeIndicator}, water=${s.indicators.estimatedSeasonalWaterDemand.averageMinMmPerSeason}-${s.indicators.estimatedSeasonalWaterDemand.averageMaxMmPerSeason}mm/season, sequence=${s.slots.map((sl) => `${sl.season}:${sl.cropName}`).join('->')}]`,
            )
            .join(' || ')}`,
        ]
      : ['No crop rotation comparison run yet.'];

  const cropDetailLines = mentionedSupportedCrops.map((c) => {
    const t = c.temperatureRequirements.value;
    const w = c.waterRequirements.value;
    const sp = c.soilPreferences.value;
    const nf = c.nitrogenFixationCharacteristics.value;
    return `${c.cropName} (${c.scientificName}, ${c.cropFamily}, ${c.cropGroup}): seasons=[${(c.growingSeasons.value ?? []).join(',')}], temp=${t ? `${t.optimalMinC}-${t.optimalMaxC}°C` : 'N/A'}, water=${w ? `${w.category} ${w.seasonalMinMm}-${w.seasonalMaxMm}mm` : 'N/A'}, soil=${sp ? `pH ${sp.phMin}-${sp.phMax}, textures [${sp.preferredTextures.join(',')}]` : 'N/A'}, N-fix=${nf?.fixesAtmosphericNitrogen ? `Yes (${nf.residualNitrogenCreditKgNHa?.join('-') ?? 'documented'} kg N/ha credit)` : 'No'}`;
  });

  const promptContextText = [
    `=== SELECTED FARM & PREFERENCES ===`,
    `Location: ${locationLabel}`,
    `State/Zone: ${farmCtx?.state ?? 'Not specified'} / ${farmCtx?.agroClimaticZoneId ?? 'Not specified'}`,
    `Season: ${farmCtx?.growingSeason ?? 'Not specified'} | Farming System: ${farmCtx?.farmingSystem ?? 'Not specified'} | Current Crop: ${request.currentCrop ?? farmCtx?.currentCrop ?? 'Not specified'}`,
    ``,
    `=== MEASUREMENTS & SATELLITE OBSERVATIONS (ACTUAL DATA) ===`,
    ...(measurementsUsed.length > 0 ? measurementsUsed : ['None available.']),
    ``,
    `=== MODELLED ESTIMATES & DETERMINISTIC ENGINE RESULTS (NOT YIELD PREDICTIONS) ===`,
    ...(estimatesUsed.length > 0 ? estimatesUsed : ['None available.']),
    ``,
    `=== MISSING INFORMATION (DO NOT GUESS OR INVENT) ===`,
    ...(missingDataIdentified.length > 0 ? missingDataIdentified : ['No critical gaps detected.']),
    ``,
    `=== DETECTED DATA CONFLICTS ===`,
    ...(dataConflicts.length > 0
      ? dataConflicts.map((c) => `${c.topic}: ${c.observationA} vs ${c.observationB} -> ${c.guidance}`)
      : ['No cross-source conflicts detected.']),
    ``,
    `=== CROP SUITABILITY RECOMMENDATIONS ===`,
    ...recSummaryLines,
    ``,
    `=== CROP ROTATION PLANNER COMPARISON ===`,
    ...rotSummaryLines,
    ``,
    `=== PHASE 4 SATELLITE QUALITY, TEMPORAL TRENDS, STRESS & ALERTS [INFERENCE / SCREENING] ===`,
    ...(phase4Analytics
      ? [
          `Quality Grade: ${phase4Analytics.qualityReport.overallGrade} (${phase4Analytics.qualityReport.overallScore0To100}/100) | Confidence: ${phase4Analytics.confidenceAssessment.confidenceLevel} (${phase4Analytics.confidenceAssessment.evidenceStrength} evidence, ${phase4Analytics.confidenceAssessment.confidenceScore0To100}/100)`,
          `Trends: NDVI=${phase4Analytics.temporalAnalysis.series.ndvi.calculatedStatistics.trendDirection} (${phase4Analytics.temporalAnalysis.series.ndvi.validObservationCount} scenes), NDWI=${phase4Analytics.temporalAnalysis.series.ndwi.calculatedStatistics.trendDirection}, ET=${phase4Analytics.temporalAnalysis.series.etDailyWm2.calculatedStatistics.trendDirection}, ESI=${phase4Analytics.temporalAnalysis.series.esiRatio.calculatedStatistics.trendDirection}`,
          `Stress Overall: ${phase4Analytics.stressReport.overallStatus} (${phase4Analytics.stressReport.indicators.map((i) => `${i.id}=${i.status}`).join(', ')})`,
          `Monitoring Alerts (${phase4Analytics.monitoringReport.alerts.length}): ${phase4Analytics.monitoringReport.alerts.map((a) => `[${a.severity}/${a.claimType}] ${a.title}: ${a.metricEvidence}`).join(' | ') || 'None'}`,
        ]
      : ['Phase 4 satellite validation & multi-temporal analytics not available.']),
    ``,
    `=== PHASE 5 FARM POSTURE, PREDICTIVE TREND OUTLOOK [TREND PROJECTION — NOT A FORECAST] & ACTION PLAN [INFERENCE] ===`,
    ...(phase5Intelligence
      ? [
          `Farm Posture: ${phase5Intelligence.postureStatus} — ${phase5Intelligence.postureSummary}`,
          `Parcel Spatial Scope: ${phase5Intelligence.spatialSummary.parcelLabel} | Mode: ${phase5Intelligence.spatialSummary.extractionMode}`,
          `Predictive Trend Outlook: ${phase5Intelligence.predictiveInsights.overallOutlookNote}`,
          ...[
            phase5Intelligence.predictiveInsights.insights.ndvi,
            phase5Intelligence.predictiveInsights.insights.ndwi,
            phase5Intelligence.predictiveInsights.insights.esiRatio,
            phase5Intelligence.predictiveInsights.insights.etDailyWm2,
          ].map((ins) =>
            ins.projectionEligible
              ? `TREND_PROJECTION ${ins.metric}: latest=${ins.latestObservedValue} (${ins.latestObservedDate}), 7d=${ins.projections[0]?.projectedValue} [${ins.projections[0]?.lowerBound}..${ins.projections[0]?.upperBound}], 14d=${ins.projections[1]?.projectedValue} [${ins.projections[1]?.lowerBound}..${ins.projections[1]?.upperBound}] (slope/wk=${ins.slopePerWeek?.toFixed(3)}) — ${ins.uncertaintyNotice}`
              : `TREND_PROJECTION ${ins.metric}: INELIGIBLE (${ins.ineligibilityReason})`,
          ),
          `Actionable Farmer Verification Steps (${phase5Intelligence.actionRecommendations.recommendations.length}): ${
            phase5Intelligence.actionRecommendations.recommendations
              .map(
                (r) =>
                  `[${r.priority.toUpperCase()} / conf=${r.confidence}] ${r.title}: Reason=${r.reason} | Evidence=${r.evidence} | Verify=${r.nextVerificationStep}`,
              )
              .join(' || ') || 'None'
          }`,
        ]
      : ['Phase 5 predictive trend & actionable recommendation summary not available.']),
    ``,
    `=== VALIDATED CATALOG CROP PROFILES (TOTAL ${catalogCrops.length}: ${catalogCrops.map((c) => c.cropName).join(', ')}) ===`,
    ...(cropDetailLines.length > 0 ? cropDetailLines : ['Refer to recommended/excluded crops above.']),
    ...(unsupportedCropsMentioned.length > 0
      ? [`UNSUPPORTED CROPS IN USER QUERY (NOT IN CATALOG): ${unsupportedCropsMentioned.join(', ')}`]
      : []),
  ].join('\n');

  return {
    location,
    locationLabel,
    weatherTelemetry,
    climateTrends,
    soilProfile,
    soilMoisture,
    labSoilTest,
    cropRecommendations,
    rotationPlan,
    ecostressPayload,
    hlsPayload,
    environmentalContext,
    catalogCrops,
    mentionedSupportedCrops,
    unsupportedCropsMentioned,
    measurementsUsed,
    estimatesUsed,
    missingDataIdentified,
    dataConflicts,
    sourceCitations,
    groundedContextSummary: {
      locationLabel,
      hasWeather: Boolean(weatherTelemetry && weatherTelemetry.summary.availableDays > 0),
      hasRainfallGpm: Boolean(weatherTelemetry?.gpmImerg?.status === 'available'),
      hasSoilMoistureSmap: Boolean(soilMoisture?.status === 'available'),
      hasSoilProfile: Boolean(soilProfile?.status === 'available'),
      hasLabSoilTest: Boolean(labSoilTest),
      hasCropRecommendations: Boolean(
        cropRecommendations && cropRecommendations.recommendations.length > 0,
      ),
      hasRotationPlan: Boolean(rotationPlan && rotationPlan.strategies.length > 0),
      hasEcostress: Boolean(etDailyWm2 !== null || esiRatio !== null),
      hasHls: Boolean(ndvi !== null || ndwi !== null),
      hasPhase4Analytics: Boolean(phase4Analytics),
      hasPhase5Intelligence: Boolean(phase5Intelligence),
      catalogCropsCount: catalogCrops.length,
    },
    promptContextText,
  };
}
