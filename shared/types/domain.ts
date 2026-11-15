import type {
  EnvironmentalDataQualityReport,
  Phase4EnvironmentalAnalytics,
} from './analytics.ts';
import type { BoundingBox, GeoJsonPolygon } from './common.ts';
import type { EcostressResultPayload } from './ecostress.ts';
import type { Phase5FarmIntelligence } from './intelligence.ts';
import type { HlsResultPayload } from './vegetation.ts';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  elevationMeters?: number;
}

export type SpatialProcessingMode = 'auto' | 'centroid' | 'polygon';

export interface SpatialProcessingMetadata {
  requestedMode: SpatialProcessingMode;
  appliedMode: 'centroid' | 'point' | 'polygon';
  hasPolygonGeometry: boolean;
  hasBoundingBox: boolean;
  vertexCount?: number;
  note: string;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export type NasaDatasetId = 'POWER' | 'SMAP' | 'MODIS' | 'GPM' | 'LANDSAT';

export interface LocationResolveRequest {
  query?: string;
  coordinates?: GeoCoordinates;
}

export interface LocationCandidate {
  displayName: string;
  coordinates: GeoCoordinates;
  countryCode?: string;
  regionName?: string;
  type?: string;
  boundingBox?: [number, number, number, number];
}

export interface LocationContext {
  coordinates: GeoCoordinates;
  regionName?: string;
  countryCode?: string;
  agroEcologicalZone?: string;
  timezone?: string;
  source: string;
  candidates?: LocationCandidate[];
}

export interface RegionSummary {
  id: string;
  name: string;
  countryCode: string;
  agroEcologicalZone: string;
}

export interface FarmBoundary {
  id: string;
  name: string;
  vertices: GeoCoordinates[];
  centroid: GeoCoordinates;
  areaSqMeters: number;
  areaHectares: number;
  areaAcres: number;
  perimeterMeters: number;
  updatedAt: string;
}

export interface FarmGeometryGeoJson {
  type: 'Feature';
  properties: {
    id: string;
    name: string;
    areaHectares: number;
    areaAcres: number;
  };
  geometry: {
    type: 'Polygon';
    coordinates: [Array<[number, number]>];
  };
}

export interface WeatherTelemetryRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange?: DateRange;
  datasets?: NasaDatasetId[];
  includeGpmImerg?: boolean;
}

export interface DailyWeatherObservation {
  date: string;
  temperatureMeanC: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationMmDay: number | null;
  cumulativePrecipitationMm: number;
  solarRadiationMjM2Day: number | null;
  relativeHumidityPercent: number | null;
  windSpeedMs: number | null;
}

export interface MonthlyWeatherSummary {
  month: string;
  observationDays: number;
  temperatureMeanC: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  totalPrecipitationMm: number;
  meanSolarRadiationMjM2Day: number | null;
  meanRelativeHumidityPercent: number | null;
  meanWindSpeedMs: number | null;
}

export interface TemperatureTrendAnalysis {
  slopeCPerDay: number | null;
  totalChangeC: number | null;
  direction: 'warming' | 'cooling' | 'stable' | 'insufficient_data';
  firstHalfMeanC: number | null;
  secondHalfMeanC: number | null;
  sampleCount: number;
}

export interface GpmImergRainfallObservation {
  status: 'available' | 'unavailable';
  provider: string;
  product: string;
  precipitationRateMmHr: number | null;
  units: 'mm/hr';
  observationTimestamp: string | null;
  message?: string;
}

export interface WeatherSourceAttribution {
  id: string;
  name: string;
  attribution: string;
  url: string;
  cached: boolean;
  retrievedAt: string;
}

export interface WeatherUnitsMetadata {
  temperature: '°C';
  precipitation: 'mm/day';
  cumulativePrecipitation: 'mm';
  solarRadiation: 'MJ/m²/day';
  relativeHumidity: '%';
  windSpeed: 'm/s';
  gpmRate: 'mm/hr';
}

export interface WeatherTelemetrySnapshot {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  dateRange: DateRange;
  dataClassification: 'observed_historical';
  forecastDisclaimer: string;
  units: WeatherUnitsMetadata;
  summary: {
    totalDays: number;
    availableDays: number;
    missingDays: number;
    meanTempC: number | null;
    maxTempC: number | null;
    minTempC: number | null;
    totalPrecipitationMm: number;
    meanSolarRadiationMjM2Day: number | null;
    meanRelativeHumidityPercent: number | null;
    meanWindSpeedMs: number | null;
  };
  temperatureTrend: TemperatureTrendAnalysis;
  dailySeries: DailyWeatherObservation[];
  monthlySummaries: MonthlyWeatherSummary[];
  gpmImerg: GpmImergRainfallObservation | null;
  sourceAttributions: WeatherSourceAttribution[];
  sources: NasaDatasetId[];
  retrievedAt: string;
}

export interface ClimateTrendsQuery {
  latitude: number;
  longitude: number;
  years?: number;
}

export interface ClimateTrendSummary {
  location: GeoCoordinates;
  baselineYears: number;
  dataClassification: 'observed_historical';
  forecastDisclaimer: string;
  temperatureAnomalyC: number | null;
  annualMeanTempC: number | null;
  annualPrecipitationMm: number | null;
  precipitationAnomalyPercent: number | null;
  heatStressDaysTrend: string;
  yearlySummaries: Array<{
    year: number;
    meanTempC: number | null;
    totalPrecipitationMm: number | null;
  }>;
  sources: NasaDatasetId[];
  sourceAttributions: WeatherSourceAttribution[];
}

export type SoilDepthInterval = '0-5' | '5-15' | '15-30' | '30-60';

export type SoilDataClassification =
  | 'measured_lab'
  | 'modelled_estimate'
  | 'satellite_derived';

export interface SoilMeasurementStats {
  mean: number | null;
  q05: number | null;
  q95: number | null;
  uncertainty: number | null;
  unit: string;
}

export interface SoilDepthLayer {
  depthIntervalCm: SoilDepthInterval;
  topDepthCm: number;
  bottomDepthCm: number;
  ph: SoilMeasurementStats;
  organicCarbonGKg: SoilMeasurementStats;
  nitrogenGKg: SoilMeasurementStats;
  sandPercent: SoilMeasurementStats;
  siltPercent: SoilMeasurementStats;
  clayPercent: SoilMeasurementStats;
  bulkDensityKgDm3: SoilMeasurementStats;
  cecCmolKg: SoilMeasurementStats;
  textureClass: string | null;
}

export interface SoilBoundaryContext {
  id: string;
  name: string;
  areaHectares: number;
  centroid: GeoCoordinates;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
}

export interface SoilSourceAttribution {
  id: string;
  name: string;
  attribution: string;
  url: string;
  cached: boolean;
  retrievedAt: string;
}

export interface SoilProfileRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  depthCm?: SoilDepthInterval;
}

export interface SoilProfile {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  selectedDepthCm: SoilDepthInterval;
  dataClassification: 'modelled_estimate';
  status: 'available' | 'partial' | 'unavailable';
  providerUsed: 'soilgrids-rest-v2' | 'soilgrids-wcs-fallback' | 'none';
  fallbackUsed: boolean;
  fallbackReason?: string;
  depthLayers: SoilDepthLayer[];
  surfaceSummary: {
    depthIntervalCm: SoilDepthInterval;
    textureClass: string | null;
    ph: SoilMeasurementStats;
    organicCarbonGKg: SoilMeasurementStats;
    nitrogenGKg: SoilMeasurementStats;
    sandPercent: SoilMeasurementStats;
    siltPercent: SoilMeasurementStats;
    clayPercent: SoilMeasurementStats;
    bulkDensityKgDm3: SoilMeasurementStats;
    cecCmolKg: SoilMeasurementStats;
    waterRetentionSummary: string | null;
  };
  uncertaintyMethodology: string;
  wmsReferenceLayer: {
    serviceUrl: string;
    layerName: string;
    attribution: string;
  };
  sourceAttribution: SoilSourceAttribution;
  caveats: string[];
  retrievedAt: string;
}

export interface SoilMoistureRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange?: DateRange;
}

export interface SmapDailyMoisturePoint {
  date: string;
  surfaceMoistureM3M3: number | null;
  surfaceMoistureRangeM3M3: [number, number] | null;
  rootZoneMoistureM3M3: number | null;
  rootZoneMoistureRangeM3M3: [number, number] | null;
}

export interface SoilMoistureSnapshot {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  dataClassification: 'satellite_derived';
  status: 'available' | 'partial' | 'unavailable';
  product: string;
  units: 'm³/m³';
  observationDate: string | null;
  surfaceMoistureM3M3: number | null;
  rootZoneMoistureM3M3: number | null;
  surfaceMoistureBinM3M3: [number, number] | null;
  rootZoneMoistureBinM3M3: [number, number] | null;
  moistureSeries: SmapDailyMoisturePoint[];
  retrievalConfidenceNote: string;
  sourceAttribution: SoilSourceAttribution;
  message?: string;
  retrievedAt: string;
}

export interface LabSoilTestResult {
  id: string;
  parcelKey: string;
  dataClassification: 'measured_lab';
  sampleDate: string;
  labName: string;
  sampleDepthCm: SoilDepthInterval;
  ph: number | null;
  organicCarbonGKg: number | null;
  organicMatterPercent: number | null;
  totalNitrogenGKg: number | null;
  availableNitrogenMgKg: number | null;
  phosphorusMgKg: number | null;
  potassiumMgKg: number | null;
  cecCmolKg: number | null;
  bulkDensityKgDm3: number | null;
  sandPercent: number | null;
  siltPercent: number | null;
  clayPercent: number | null;
  textureClass: string | null;
  notes: string;
  updatedAt: string;
}

export type SuitabilityFactorId =
  | 'temperature'
  | 'rainfall'
  | 'soilMoisture'
  | 'soilPh'
  | 'soilTexture'
  | 'organicCarbon'
  | 'waterRequirement'
  | 'growingSeason';

export type SuitabilityScoringWeights = Record<SuitabilityFactorId, number>;

export type FactorDataSourceType =
  | 'observed_historical'
  | 'modelled_estimate'
  | 'satellite_derived'
  | 'measured_lab'
  | 'user_input'
  | 'unavailable';

export type PreferencePriority = 'low' | 'moderate' | 'high';
export type FarmingSystemMode = 'rainfed' | 'irrigated' | 'supplemental';

export interface CropRecommendationPreferences {
  growingSeason?: CropGrowingSeason;
  farmingSystem?: FarmingSystemMode;
  irrigationAvailable?: boolean;
  currentCrop?: string;
  waterConservationPriority?: PreferencePriority;
  soilImprovementPriority?: PreferencePriority;
  diversificationPreference?: PreferencePriority;
}

export interface PillarFactorWeights {
  waterAvailability: number;
  temperature: number;
  soilPh: number;
  soilHealth: number;
  seasonalCompatibility: number;
}

export interface CropEnvironmentalInputs {
  targetSeason?: CropGrowingSeason;
  agroClimaticZoneId?: string;
  state?: string;
  irrigationAvailable?: boolean;
  farmingSystem?: FarmingSystemMode;
  temperatureMeanC?: number | null;
  temperatureMaxC?: number | null;
  temperatureMinC?: number | null;
  seasonalRainfallMm?: number | null;
  observedRainfallMm?: number | null;
  observationDays?: number | null;
  annualRainfallMm?: number | null;
  gpmPrecipitationRateMmHr?: number | null;
  relativeHumidityPercent?: number | null;
  solarRadiationMjM2Day?: number | null;
  windSpeedMs?: number | null;
  soilMoistureM3M3?: number | null;
  soilMoistureSurfaceM3M3?: number | null;
  soilMoistureRootZoneM3M3?: number | null;
  soilPh?: number | null;
  soilPhSource?: FactorDataSourceType;
  soilTexture?: string | null;
  soilTextureSource?: FactorDataSourceType;
  organicCarbonGKg?: number | null;
  organicCarbonSource?: FactorDataSourceType;
  etDailyWm2?: number | null;
  esiRatio?: number | null;
  ndvi?: number | null;
  ndwi?: number | null;
}

export interface FarmEnvironmentalObservationRecord<T = unknown> {
  parameterId: string;
  parameterName: string;
  value: T | null;
  unit: string;
  sourceProvider:
    | 'NASA POWER'
    | 'NASA GPM IMERG'
    | 'NASA SMAP'
    | 'NASA ECOSTRESS'
    | 'NASA Landsat/HLS'
    | 'ISRIC SoilGrids'
    | 'Laboratory Soil Test'
    | 'User Input';
  datasetId: string;
  datasetVersion: string;
  spatialResolution: {
    value?: number;
    unit?: string;
    label: string;
  };
  isRepresentative: boolean;
  representativenessNote: string;
  observationPeriod?: string;
  observationTimestamp?: string;
  retrievalTimestamp: string;
  quality: {
    status: 'nominal' | 'estimated' | 'interpolated' | 'missing' | 'invalid';
    qualityFlag?: number | string | null;
    missingValueIndicator?: number;
    notes?: string;
  };
  staleness: {
    isStale: boolean;
    ageDays?: number;
    note?: string;
  };
}

export interface FarmEnvironmentalDataSourceSummary {
  id: string;
  name: string;
  dataset: string;
  spatialResolution: string;
  role: string;
  isFresh: boolean;
  cached?: boolean;
  limitations: string;
  observationDate?: string;
  productIdentifier?: string;
  coveragePercent?: number | null;
  validPixelCount?: number | null;
}

export interface FarmEnvironmentalContext {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  dateRange: DateRange;
  retrievedAt: string;
  growingPeriodContext?: {
    targetSeason?: CropGrowingSeason;
    dateRange: DateRange;
    classification: 'observed_historical';
    note: string;
  };
  features: CropEnvironmentalInputs;
  observations: FarmEnvironmentalObservationRecord[];
  missingParameters: string[];
  staleParameters: string[];
  invalidParameters?: string[];
  validationSummary?: {
    validCount: number;
    missingCount: number;
    staleCount: number;
    invalidCount: number;
    representativeCount: number;
  };
  coarseResolutionCaveats: string[];
  providerWarnings?: string[];
  gpmImergObservation?: GpmImergRainfallObservation | null;
  ecostressPayload?: EcostressResultPayload | null;
  hlsPayload?: HlsResultPayload | null;
  qualityAssessment?: EnvironmentalDataQualityReport | null;
  environmentalAnalytics?: Phase4EnvironmentalAnalytics | null;
  dataSources: FarmEnvironmentalDataSourceSummary[];
}

export interface CropIntelligenceRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  inputs?: CropEnvironmentalInputs;
  labSoilTest?: LabSoilTestResult | null;
  preferences?: CropRecommendationPreferences;
  autoFetchMissingFarmData?: boolean;
  weights?: Partial<SuitabilityScoringWeights>;
  pillarWeights?: Partial<PillarFactorWeights>;
  strictRegionFilter?: boolean;
  dateRange?: DateRange;
  currentCrop?: string;
  farmSizeHectares?: number;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
}

export interface CropFactorScore {
  factorId: SuitabilityFactorId;
  label: string;
  status: 'evaluated' | 'missing';
  score: number | null;
  weight: number;
  effectiveWeight: number;
  weightedContribution: number | null;
  observedValue: string;
  observedNumeric?: number | null;
  unit?: string;
  cropSuitabilityRange: string;
  dataSource: FactorDataSourceType;
  explanation: string;
}

export interface SupportingEnvironmentalObservation {
  parameter: string;
  label: string;
  observedValue: string;
  unit?: string;
  status: 'available' | 'missing';
  dataSource: FactorDataSourceType;
  sourceLabel: string;
  spatialResolution?: string;
  observationPeriod?: string;
  observationTimestamp?: string;
  datasetId?: string;
  isRepresentative?: boolean;
  representativenessNote?: string;
  stalenessNote?: string;
  influenceOnRecommendation?: 'positive' | 'limiting' | 'neutral' | 'missing';
}

export interface SoilCompatibilityDetail {
  summary: string;
  phFit: string;
  textureFit: string;
  soilHealthNote: string;
  drainageNote: string;
}

export interface SeasonalSuitabilityDetail {
  targetSeason: CropGrowingSeason | null;
  matchesTargetSeason: boolean;
  documentedSeasons: CropGrowingSeason[];
  sowingWindow: string | null;
  durationDaysRange: [number, number] | null;
  summary: string;
}

export interface WaterRequirementDetail {
  category: WaterRequirementCategory;
  seasonalMinMm: number | null;
  seasonalMaxMm: number | null;
  rainfedViability: 'high' | 'moderate' | 'low' | 'unknown';
  droughtTolerance: string;
  waterloggingSensitivity: string;
  conservationFitNote: string;
}

export interface DataConfidenceDetail {
  score: number;
  level: 'high' | 'moderate' | 'low';
  completenessPercent: number;
  missingDataPenaltyPoints: number;
  note: string;
}

export interface PreferenceAdjustmentNote {
  factor: string;
  delta: number;
  reason: string;
}

export type HardConstraintCode =
  | 'INCOMPATIBLE_SEASON'
  | 'UNSUPPORTED_REGION'
  | 'EXTREME_TEMPERATURE'
  | 'EXTREME_SOIL_PH'
  | 'SEVERE_WATER_DEFICIT';

export interface HardConstraintViolation {
  code: HardConstraintCode;
  factorId: SuitabilityFactorId | 'region';
  message: string;
}

export type SuitabilityCategoryLabel =
  | 'Highly Suitable'
  | 'Moderately Suitable'
  | 'Marginally Suitable'
  | 'Unsuitable'
  | 'Insufficient Data';

export interface CropSuitabilityOption {
  rank: number | null;
  cropId: string;
  cropName: string;
  scientificName: string;
  cropGroup: 'Cereal' | 'Millet' | 'Pulse' | 'Oilseed';
  eligibilityStatus: 'recommended' | 'conditional' | 'provisional_uncertain' | 'excluded';
  suitabilityScore: number;
  suitabilityBand: 'high' | 'moderate' | 'marginal' | 'unsuitable' | 'insufficient_data';
  suitabilityCategory: SuitabilityCategoryLabel;
  dataCompletenessPercent: number;
  uncertaintyLevel: 'low' | 'moderate' | 'high';
  dataConfidence: DataConfidenceDetail;
  waterRequirement: WaterRequirementCategory;
  waterRequirementDetail: WaterRequirementDetail;
  growingSeasons: CropGrowingSeason[];
  seasonalSuitability: SeasonalSuitabilityDetail;
  soilCompatibility: SoilCompatibilityDetail;
  factorScores: CropFactorScore[];
  supportingObservations: SupportingEnvironmentalObservation[];
  dataSourcesUsed?: FarmEnvironmentalDataSourceSummary[];
  preferenceAdjustments: PreferenceAdjustmentNote[];
  hardConstraintsFailed: HardConstraintViolation[];
  rejectionReasons: string[];
  advantages: string[];
  disadvantages: string[];
  limitingFactors: string[];
  limitations: string[];
  missingDataWarnings: string[];
  missingOrUncertainInputs?: string[];
  climateFitSummary: string;
  explanation: string;
}

export interface CropIntelligenceResult {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  generatedAt: string;
  engineVersion: string;
  deterministicNoAiNotice: string;
  suitabilityVsYieldDisclaimer: string;
  evaluationStatus: 'completed' | 'completed_with_uncertainty' | 'insufficient_essential_data';
  evaluatedInputs: CropEnvironmentalInputs;
  preferencesApplied: CropRecommendationPreferences;
  appliedWeights: SuitabilityScoringWeights;
  dataCompletenessPercent: number;
  uncertaintyLevel: 'low' | 'moderate' | 'high';
  gpmImergObservation?: GpmImergRainfallObservation | null;
  environmentalContext?: FarmEnvironmentalContext;
  missingDataWarnings: string[];
  recommendations: CropSuitabilityOption[];
  excludedCrops: CropSuitabilityOption[];
  caveats: string[];
}

export type CropParameterValidationStatus =
  | 'icar_kvk_verified'
  | 'provisional_regional'
  | 'unavailable';

export interface AgronomicSourceReference {
  institute: string;
  title: string;
  year: number | null;
  url?: string;
}

export interface ValidatedCropParameter<T> {
  value: T | null;
  unit?: string;
  validationStatus: CropParameterValidationStatus;
  validationNote: string;
  sources: AgronomicSourceReference[];
}

export type CropGrowingSeason = 'Kharif' | 'Rabi' | 'Zaid' | 'Summer';
export type WaterRequirementCategory = 'low' | 'moderate' | 'high';

export interface IndianAgroClimaticZone {
  id: string;
  zoneNumber: number;
  name: string;
  shortName: string;
  statesAndUts: string[];
  typicalSoilOrders: string[];
  annualRainfallMmRange: [number, number] | null;
  climateSummary: string;
  majorCrops: string[];
  source: AgronomicSourceReference;
}

export interface RegionalSuitabilityEntry {
  agroClimaticZoneId: string;
  agroClimaticZoneName: string;
  states: string[];
  primarySeason: CropGrowingSeason;
  typicalSowingWindow: string;
  regionalNotes: string;
}

export interface CropTemperatureRequirementsValue {
  germinationMinC: number | null;
  optimalMinC: number;
  optimalMaxC: number;
  heatStressThresholdC: number | null;
  frostSensitivity: string;
}

export interface CropWaterRequirementsValue {
  category: WaterRequirementCategory;
  seasonalMinMm: number;
  seasonalMaxMm: number;
  droughtTolerance: string;
  waterloggingSensitivity: string;
}

export interface CropSoilPreferencesValue {
  preferredTextures: string[];
  indianSoilTypes: string[];
  phMin: number;
  phMax: number;
  drainageRequirement: string;
  salinityToleranceNote: string;
  salinityThresholdEcDsM: number | null;
}

export interface CropGrowingDurationValue {
  minDays: number;
  maxDays: number;
  maturityNote: string;
}

export interface CropNutrientRequirementsValue {
  nitrogenKgHa: [number, number] | null;
  phosphorusP2O5KgHa: [number, number] | null;
  potassiumK2OKgHa: [number, number] | null;
  secondaryAndMicronutrients: string;
  soilTestCalibrationNote: string;
}

export interface CropIrrigationNeedsValue {
  rainfedViability: 'high' | 'moderate' | 'low';
  recommendedIrrigationsRange: [number, number] | null;
  criticalGrowthStages: string[];
  managementNote: string;
}

export interface CropNitrogenFixationValue {
  fixesAtmosphericNitrogen: boolean;
  symbiontSpecies: string | null;
  estimatedFixationKgNHa: [number, number] | null;
  residualNitrogenCreditKgNHa: [number, number] | null;
  nodulationAndInoculationNote: string;
}

export interface CropRotationCompatibilityValue {
  beneficialPrecedingCrops: string[];
  beneficialSucceedingCrops: string[];
  incompatibleOrCautionSequences: string[];
  agronomicRationale: string;
}

export interface CropKnowledgeProfile {
  id: string;
  cropName: string;
  localNames: string[];
  scientificName: string;
  cropFamily: string;
  cropGroup: 'Cereal' | 'Millet' | 'Pulse' | 'Oilseed';
  growingSeasons: ValidatedCropParameter<CropGrowingSeason[]>;
  regionalSuitability: ValidatedCropParameter<RegionalSuitabilityEntry[]>;
  temperatureRequirements: ValidatedCropParameter<CropTemperatureRequirementsValue>;
  waterRequirements: ValidatedCropParameter<CropWaterRequirementsValue>;
  soilPreferences: ValidatedCropParameter<CropSoilPreferencesValue>;
  growingDuration: ValidatedCropParameter<CropGrowingDurationValue>;
  nutrientRequirements: ValidatedCropParameter<CropNutrientRequirementsValue>;
  irrigationNeeds: ValidatedCropParameter<CropIrrigationNeedsValue>;
  nitrogenFixationCharacteristics: ValidatedCropParameter<CropNitrogenFixationValue>;
  cropRotationCompatibility: ValidatedCropParameter<CropRotationCompatibilityValue>;
  unavailableParametersNote: string;
  lastReviewedDate: string;
}

export interface CropCatalogFilter {
  search?: string;
  season?: CropGrowingSeason;
  agroClimaticZone?: string;
  state?: string;
  cropFamily?: string;
  waterRequirement?: WaterRequirementCategory;
  nitrogenFixingOnly?: boolean;
  soilTexture?: string;
  phTarget?: number;
  climateZone?: string;
}

export interface CropKnowledgeCatalogResult {
  totalCount: number;
  filteredCount: number;
  appliedFilter: CropCatalogFilter;
  crops: CropKnowledgeProfile[];
  knowledgeSeparationNotice: string;
  dataAttribution: string;
}

export interface AgroClimaticRegionsResult {
  zones: IndianAgroClimaticZone[];
  states: Array<{
    state: string;
    agroClimaticZoneIds: string[];
    cropCount: number;
  }>;
  sourceAttribution: string;
}


export interface CropRotationPlanRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  currentCrop: string;
  rotationYears: number;
  soilTextureClass?: string;
  goals?: string[];
}

export interface CropRotationCycleStep {
  year: number;
  season: string;
  cropName: string;
  rationale: string;
  soilBenefit: string;
}

export interface CropRotationPlanResult {
  location: GeoCoordinates;
  currentCrop: string;
  rotationYears: number;
  cycles: CropRotationCycleStep[];
  generatedAt: string;
}

export interface RegionalRotationRule {
  id: string;
  countryCode: string;
  regionCode: string;
  title: string;
  ruleType: 'nitrogen_replenishment' | 'pest_disease_break' | 'moisture_conservation' | string;
  precedingCategories: string[];
  recommendedFollowingCategories: string[];
  excludedImmediateRepeats?: string[];
  rationale: string;
  soilHealthImpact: string;
}

export type RotationStrategyId = 'existing' | 'alternative_a' | 'alternative_b' | 'user_defined';

export interface RotationSeasonSlotInput {
  slotIndex?: number;
  year: number;
  season: CropGrowingSeason;
  cropId?: string;
  cropName?: string;
}

export interface RotationComparisonWeights {
  diversity: number;
  waterEfficiency: number;
  nitrogenAndNutrientBalance: number;
  soilHealth: number;
  seasonalAndRegionalFit: number;
  pestBreakAndRisk: number;
}

export interface RotationPreferences {
  farmingSystem?: FarmingSystemMode;
  irrigationAvailable?: boolean;
  waterConservationPriority?: PreferencePriority;
  soilImprovementPriority?: PreferencePriority;
  diversificationPreference?: PreferencePriority;
  startingSeason?: CropGrowingSeason;
  seasonsCount?: number;
}

export interface RotationStrategyInput {
  id: RotationStrategyId;
  label: string;
  description?: string;
  sequence: RotationSeasonSlotInput[];
}

export interface RotationGenerateRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  inputs?: CropEnvironmentalInputs;
  preferences?: RotationPreferences;
  currentCrop?: string;
  existingSequence?: RotationSeasonSlotInput[];
  customSequence?: RotationSeasonSlotInput[];
  indicatorWeights?: Partial<RotationComparisonWeights>;
  autoFetchMissingFarmData?: boolean;
  strictRegionFilter?: boolean;
  dateRange?: DateRange;
}

export interface RotationCompareRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  inputs?: CropEnvironmentalInputs;
  preferences?: RotationPreferences;
  strategies: RotationStrategyInput[];
  indicatorWeights?: Partial<RotationComparisonWeights>;
  autoFetchMissingFarmData?: boolean;
  strictRegionFilter?: boolean;
  dateRange?: DateRange;
}

export interface RotationSlotTransitionEvaluation {
  previousCropName: string;
  previousCropFamily: string | null;
  familyRepeated: boolean;
  cropRepeated: boolean;
  sequenceStatus: 'beneficial' | 'neutral' | 'caution' | 'incompatible';
  durationConflictNote: string | null;
  pestCarryoverNote: string | null;
  residueManagementNote: string;
}

export interface RotationEvaluatedSlot {
  slotIndex: number;
  year: number;
  season: CropGrowingSeason;
  cropId: string;
  cropName: string;
  scientificName: string;
  cropFamily: string;
  cropGroup: 'Cereal' | 'Millet' | 'Pulse' | 'Oilseed' | 'Unknown';
  resolvedInKnowledgeBase: boolean;
  seasonalMatch: boolean;
  regionalMatch: boolean;
  durationDaysRange: [number, number] | null;
  sowingWindow: string | null;
  waterCategory: WaterRequirementCategory | 'unknown';
  estimatedWaterMmRange: [number, number] | null;
  fixesNitrogen: boolean;
  estimatedNitrogenFixationKgHa: [number, number] | null;
  residualNitrogenCreditKgHa: [number, number] | null;
  soilTextureAndDrainageFit: 'good' | 'moderate' | 'caution' | 'unknown';
  soilConstraintNote: string;
  transitionFromPrevious: RotationSlotTransitionEvaluation | null;
  warnings: string[];
}

export interface RotationStrategyIndicators {
  estimatedSeasonalWaterDemand: {
    totalMinMm: number | null;
    totalMaxMm: number | null;
    averageMinMmPerSeason: number | null;
    averageMaxMmPerSeason: number | null;
    demandCategory: WaterRequirementCategory;
    estimationNote: string;
  };
  cropDiversity: {
    uniqueCropsCount: number;
    uniqueFamiliesCount: number;
    totalSlots: number;
    familiesPresent: string[];
    consecutiveFamilyRepeats: number;
    consecutiveCropRepeats: number;
    legumeSlotsCount: number;
    legumeSharePercent: number;
    diversityRating: 'High' | 'Moderate' | 'Low';
    summary: string;
  };
  potentialNitrogenContribution: {
    legumeCount: number;
    totalResidualNCreditRangeKgHa: [number, number] | null;
    qualitativeIndicator:
      | 'High Biological N Contribution'
      | 'Moderate Biological N Contribution'
      | 'Negligible / Extractive';
    note: string;
  };
  nutrientBalance: {
    qualitativeRating:
      | 'Balanced Replenishment'
      | 'Moderately Balanced'
      | 'Extractive Depletion Risk';
    heavyNitrogenFeedersCount: number;
    soilBuildingCropsCount: number;
    summary: string;
  };
  soilHealthConsiderations: {
    qualitativeIndicator:
      | 'Soil-Building & Residue Balanced'
      | 'Neutral / Maintenance'
      | 'Compaction & SOC Depletion Risk';
    residueManagementSummary: string;
    soilTextureAndDrainageSummary: string;
    rootDiversitySummary: string;
    noFabricatedSocNotice: string;
  };
  seasonalSuitability: {
    compatibleSlots: number;
    totalSlots: number;
    regionalCompatibleSlots: number;
    durationConflictCount: number;
    summary: string;
  };
  agronomicRisk: {
    riskLevel: 'low' | 'moderate' | 'high';
    pestAndDiseaseCarryoverCount: number;
    constraintViolations: string[];
    riskNotes: string[];
  };
}

export interface RotationStrategyEvaluation {
  strategyId: RotationStrategyId;
  label: string;
  description: string;
  overallScore: number;
  isEligible: boolean;
  slots: RotationEvaluatedSlot[];
  indicators: RotationStrategyIndicators;
  subScores: RotationComparisonWeights;
  rulesTriggered: Array<{
    ruleId: string;
    title: string;
    ruleType: string;
    impact: string;
  }>;
}

export interface RotationRecommendationSummary {
  preferredStrategyId: RotationStrategyId;
  preferredStrategyLabel: string;
  whyPreferred: string;
  environmentalAdvantages: string[];
  possibleDisadvantages: string[];
  importantUncertainties: string[];
  informationToImprove: string[];
}

export interface RotationPlannerResult {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  generatedAt: string;
  engineVersion: string;
  deterministicNoAiNotice: string;
  modelScopeDisclaimer: string;
  evaluatedInputs: CropEnvironmentalInputs;
  preferencesApplied: RotationPreferences;
  appliedWeights: RotationComparisonWeights;
  dataCompletenessPercent: number;
  uncertaintyLevel: 'low' | 'moderate' | 'high';
  missingDataWarnings: string[];
  regionalRulesApplied: RegionalRotationRule[];
  strategies: RotationStrategyEvaluation[];
  recommendation: RotationRecommendationSummary;
  caveats: string[];
}

export type AssistantLanguage = 'en' | 'hi';

export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiFarmContextPayload {
  farmName?: string;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  state?: string;
  agroClimaticZoneId?: string;
  growingSeason?: CropGrowingSeason;
  farmingSystem?: FarmingSystemMode;
  irrigationAvailable?: boolean;
  currentCrop?: string;
  labSoilTest?: LabSoilTestResult | null;
  weatherTelemetry?: WeatherTelemetrySnapshot | null;
  climateTrends?: ClimateTrendSummary | null;
  soilProfile?: SoilProfile | null;
  soilMoisture?: SoilMoistureSnapshot | null;
  cropRecommendations?: CropIntelligenceResult | null;
  rotationPlan?: RotationPlannerResult | null;
  ecostressPayload?: EcostressResultPayload | null;
  hlsPayload?: HlsResultPayload | null;
  environmentalContext?: FarmEnvironmentalContext | null;
  environmentalAnalytics?: Phase4EnvironmentalAnalytics | null;
  farmIntelligence?: Phase5FarmIntelligence | null;
}

export interface AiAssistantRequest {
  prompt: string;
  language?: AssistantLanguage;
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  currentCrop?: string;
  contextNotes?: string;
  history?: AiChatTurn[];
  farmContext?: AiFarmContextPayload;
  autoFetchContext?: boolean;
}

export interface AiSourceCitation {
  sourceId: string;
  label: string;
  category:
    | 'measured'
    | 'satellite_observation'
    | 'modelled_estimate'
    | 'knowledge_base'
    | 'deterministic_engine';
  summary: string;
  status: 'available' | 'partial' | 'unavailable';
}

export interface AiEnvironmentalConflict {
  topic: string;
  observationA: string;
  observationB: string;
  guidance: string;
}

export interface AiAssistantResponse {
  answer: string;
  language: AssistantLanguage;
  actionSteps: string[];
  measurementsUsed: string[];
  estimatesUsed: string[];
  missingDataIdentified: string[];
  dataConflicts: AiEnvironmentalConflict[];
  sourceCitations: AiSourceCitation[];
  safetyDisclaimer: string;
  expertConsultationNote: string;
  model: string;
  generatedAt: string;
  groundedContextSummary: {
    locationLabel: string;
    hasWeather: boolean;
    hasRainfallGpm: boolean;
    hasSoilMoistureSmap: boolean;
    hasSoilProfile: boolean;
    hasLabSoilTest: boolean;
    hasCropRecommendations: boolean;
    hasRotationPlan: boolean;
    hasEcostress?: boolean;
    hasHls?: boolean;
    hasPhase4Analytics?: boolean;
    hasPhase5Intelligence?: boolean;
    catalogCropsCount: number;
  };
}
