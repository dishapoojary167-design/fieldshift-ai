import type { BoundingBox, GeoJsonPolygon } from './common.ts';
import type {
  DateRange,
  GeoCoordinates,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
  SpatialProcessingMode,
} from './domain.ts';
import type { EcostressProductId, EcostressResultPayload } from './ecostress.ts';
import type { HlsProductId, HlsResultPayload } from './vegetation.ts';

// ============================================================================
// PHASE 4A — ENVIRONMENTAL DATA QUALITY & VALIDATION
// ============================================================================

export type QualityGrade = 'good' | 'fair' | 'degraded' | 'poor' | 'unavailable';

export interface ObservationValidationIssue {
  mission: 'ecostress' | 'hls';
  productId: string;
  observationTimestamp: string;
  severity: 'error' | 'warning' | 'info';
  code:
    | 'INVALID_TIMESTAMP'
    | 'FUTURE_TIMESTAMP'
    | 'RETRIEVAL_BEFORE_ACQUISITION'
    | 'STALE_OBSERVATION'
    | 'CLOUD_MASKED'
    | 'SHADOW_MASKED'
    | 'WATER_MASKED'
    | 'MISSING_CLOUD_MASK_FLAG'
    | 'FILL_VALUE_REJECTED'
    | 'OUT_OF_PHYSICAL_BOUNDS'
    | 'GENUINE_ZERO_PRESERVED'
    | 'ZERO_COVERAGE'
    | 'LOW_COVERAGE'
    | 'MODERATE_COVERAGE'
    | 'INVALID_PIXEL_COUNT_RATIO'
    | 'RESOLUTION_MISMATCH'
    | 'UNKNOWN_PRODUCT_METADATA'
    | 'MISSING_ATTRIBUTION';
  metric?: 'etDailyWm2' | 'esiRatio' | 'ndvi' | 'ndwi' | 'coveragePercent' | 'timestamp';
  message: string;
}

export interface SceneQualityAudit {
  mission: 'ecostress' | 'hls';
  productId: string;
  observationTimestamp: string;
  retrievalTimestamp: string;
  usableForEt: boolean;
  usableForEsi: boolean;
  usableForNdvi: boolean;
  usableForNdwi: boolean;
  hasValidTimestamp: boolean;
  hasValidSpatialMetadata: boolean;
  isStale: boolean;
  ageDays: number | null;
  coveragePercent: number | null;
  validPixelCount: number | null;
  intersectingPixelCount: number | null;
  cloudMaskFlag: 0 | 1 | null;
  shadowMaskFlag: 0 | 1 | null;
  waterMaskFlag: 0 | 1 | null;
  qualityStatus: string;
  genuineZeroMetrics: Array<'etDailyWm2' | 'esiRatio' | 'ndvi' | 'ndwi'>;
  issues: ObservationValidationIssue[];
}

export interface LatestValidatedMetricSnapshot {
  metric: 'etDailyWm2' | 'esiRatio' | 'ndvi' | 'ndwi';
  value: number | null;
  unit: string;
  productId: string | null;
  observationTimestamp: string | null;
  retrievalTimestamp: string | null;
  coveragePercent: number | null;
  validPixelCount: number | null;
  cloudMaskFlag: 0 | 1 | null;
  shadowMaskFlag: 0 | 1 | null;
  waterMaskFlag: 0 | 1 | null;
  isStale: boolean;
  ageDays: number | null;
  spatialResolutionMeters: number | null;
}

export interface MissionDataQualityReport {
  mission: 'ecostress' | 'hls';
  available: boolean;
  grade: QualityGrade;
  score0To100: number;
  totalScenes: number;
  usableScenesCount: number;
  cloudMaskedCount: number;
  shadowMaskedCount: number;
  waterMaskedCount: number;
  staleScenesCount: number;
  invalidScenesCount: number;
  lowCoverageScenesCount: number;
  meanCoveragePercent: number | null;
  expectedResolutionMeters: 70 | 30;
  resolutionVerified: boolean;
  productMetadataVerified: boolean;
  attributionPreserved: boolean;
  sourceName: string | null;
  daac: string | null;
  productVersions: string[];
  issues: ObservationValidationIssue[];
  scenes: SceneQualityAudit[];
}

export interface EnvironmentalDataQualityReport {
  evaluatedAt: string;
  staleDaysThreshold: number;
  minCoveragePercentThreshold: number;
  overallGrade: QualityGrade;
  overallScore0To100: number;
  ecostress: MissionDataQualityReport;
  hls: MissionDataQualityReport;
  latestValidMetrics: {
    etDailyWm2: LatestValidatedMetricSnapshot;
    esiRatio: LatestValidatedMetricSnapshot;
    ndvi: LatestValidatedMetricSnapshot;
    ndwi: LatestValidatedMetricSnapshot;
  };
  genuineZeroObservationsCount: number;
  totalIssuesCount: number;
  criticalIssues: string[];
  caveats: string[];
}

// ============================================================================
// PHASE 4B — MULTI-TEMPORAL ENVIRONMENTAL ANALYSIS
// ============================================================================

export type TemporalTrendDirection =
  | 'increasing'
  | 'decreasing'
  | 'stable'
  | 'insufficient_data';

export interface TemporalObservedPoint {
  observationTimestamp: string;
  date: string;
  value: number;
  productId: string;
  coveragePercent: number | null;
  isStale: boolean;
}

export interface TemporalStepChange {
  fromDate: string;
  toDate: string;
  fromValue: number;
  toValue: number;
  deltaValue: number;
  percentChange: number | null;
  elapsedDays: number;
  ratePerDay: number | null;
  fromProductId: string;
  toProductId: string;
  crossSensorTransition: boolean;
}

export interface SamplingGapInterval {
  fromDate: string;
  toDate: string;
  gapDays: number;
  exceedsExpectedCadence: boolean;
  note: string;
}

export interface TemporalMetricSeriesSummary {
  metric: 'ndvi' | 'ndwi' | 'etDailyWm2' | 'esiRatio';
  label: string;
  unit: string;
  comparableProducts: string[];
  excludedProductsOrReasons: string[];
  observedValues: TemporalObservedPoint[];
  validObservationCount: number;
  minRequiredForTrend: number;
  timeSpanDays: number | null;
  calculatedStatistics: {
    latestValue: number | null;
    earliestValue: number | null;
    netChange: number | null;
    mean: number | null;
    min: number | null;
    max: number | null;
    stdDev: number | null;
    slopePerDay: number | null;
    slopePerWeek: number | null;
    trendDirection: TemporalTrendDirection;
    trendEligible: boolean;
    trendIneligibilityReason: string | null;
  };
  stepChanges: TemporalStepChange[];
  samplingGaps: SamplingGapInterval[];
  hasIrregularSamplingGaps: boolean;
  mixedSensorsPresent: boolean;
  distinctionNotice: string;
}

export interface MultiTemporalAnalysisReport {
  evaluatedAt: string;
  minimumTrendObservations: number;
  minimumTrendSpanDays: number;
  series: {
    ndvi: TemporalMetricSeriesSummary;
    ndwi: TemporalMetricSeriesSummary;
    etDailyWm2: TemporalMetricSeriesSummary;
    esiRatio: TemporalMetricSeriesSummary;
  };
  crossMissionAlignment: {
    latestEcostressDate: string | null;
    latestHlsDate: string | null;
    acquisitionGapDays: number | null;
    treatedAsSimultaneous: false;
    note: string;
  };
  limitations: string[];
}

// ============================================================================
// PHASE 4C — ENVIRONMENTAL STRESS DETECTION
// ============================================================================

export type StressSignalStatus =
  | 'observed_concern'
  | 'possible_stress'
  | 'nominal'
  | 'inconclusive';

export type StressIndicatorCategory =
  | 'vegetation_condition'
  | 'water_related_spectral'
  | 'evaporative_stress'
  | 'unusual_environmental_change';

export interface EnvironmentalStressIndicator {
  id: StressIndicatorCategory;
  title: string;
  status: StressSignalStatus;
  severity: 'high' | 'moderate' | 'low' | 'unknown';
  directObservations: string[];
  derivedIndicators: string[];
  agronomicInterpretation: string;
  prohibitedInferenceGuardrail: string;
  observationDates: string[];
  supportingRuleIds: string[];
}

export interface EnvironmentalStressReport {
  evaluatedAt: string;
  overallStatus: StressSignalStatus;
  indicators: EnvironmentalStressIndicator[];
  activeConcernCount: number;
  possibleStressCount: number;
  inconclusiveCount: number;
  diagnosticDisclaimer: string;
}

// ============================================================================
// PHASE 4D — ENVIRONMENTAL INTELLIGENCE & CONFIDENCE ENGINE
// ============================================================================

export type EnvironmentalConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient';
export type EvidenceStrengthLevel = 'strong' | 'moderate' | 'limited' | 'insufficient';

export interface EnvironmentalAssessmentEvidence {
  source: string;
  productIds: string[];
  observationDates: string[];
  spatialResolution: string;
  summary: string;
}

export interface EnvironmentalConfidenceAssessment {
  confidenceLevel: EnvironmentalConfidenceLevel;
  evidenceStrength: EvidenceStrengthLevel;
  confidenceScore0To100: number;
  degradationReasons: string[];
  uncertaintyExplanations: string[];
  spatialCoverageFactor: string;
  temporalCompletenessFactor: string;
  freshnessFactor: string;
}

// ============================================================================
// PHASE 4E — ENVIRONMENTAL ALERTS & MONITORING
// ============================================================================

export type AlertSeverity = 'critical' | 'warning' | 'advisory' | 'info';

export type EnvironmentalAlertCategory =
  | 'vegetation_decline'
  | 'water_spectral_stress'
  | 'evaporative_stress'
  | 'abrupt_change'
  | 'data_quality_limitation';

export interface MonitoringThresholdsConfig {
  staleDaysThreshold: number;
  minCoveragePercent: number;
  minimumTrendObservations: number;
  minimumTrendSpanDays: number;
  lowNdviThreshold: number;
  ndviDropDeltaThreshold: number;
  lowNdwiThreshold: number;
  ndwiDropDeltaThreshold: number;
  esiStressThreshold: number;
  esiModerateThreshold: number;
  etSharpDropPercent: number;
  crossMissionGapDaysThreshold: number;
}

export interface MonitoringAlert {
  id: string;
  dedupeKey: string;
  category: EnvironmentalAlertCategory;
  severity: AlertSeverity;
  claimType: 'confirmed_observation' | 'possible_risk' | 'data_quality_notice';
  title: string;
  farmerExplanation: string;
  metricEvidence: string;
  observationDates: string[];
  sources: string[];
  recommendedVerification: string;
}

export interface EnvironmentalMonitoringReport {
  evaluatedAt: string;
  appliedThresholds: MonitoringThresholdsConfig;
  alerts: MonitoringAlert[];
  suppressedInvalidOrInsufficientCount: number;
  deduplicatedCount: number;
  summaryNote: string;
}

// ============================================================================
// COMBINED PHASE 4 RESPONSE & REQUEST CONTRACTS
// ============================================================================

export interface Phase4EnvironmentalAnalytics {
  engineVersion: string;
  generatedAt: string;
  preservesCropAndRotationScores: true;
  qualityReport: EnvironmentalDataQualityReport;
  temporalAnalysis: MultiTemporalAnalysisReport;
  stressReport: EnvironmentalStressReport;
  confidenceAssessment: EnvironmentalConfidenceAssessment;
  evidenceSummary: EnvironmentalAssessmentEvidence[];
  monitoringReport: EnvironmentalMonitoringReport;
}

export interface EnvironmentalAnalyticsRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange?: DateRange;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  thresholds?: Partial<MonitoringThresholdsConfig>;
  autoFetchCompletedResults?: boolean;
}

export interface EnvironmentalAnalyticsResponse {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  hasEcostressData: boolean;
  hasHlsData: boolean;
  ecostressProducts: EcostressProductId[];
  hlsProducts: HlsProductId[];
  analytics: Phase4EnvironmentalAnalytics;
}
