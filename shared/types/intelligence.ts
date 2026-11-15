import type {
  EnvironmentalConfidenceAssessment,
  EnvironmentalMonitoringReport,
  MultiTemporalAnalysisReport,
  Phase4EnvironmentalAnalytics,
} from './analytics.ts';
import type { BoundingBox, GeoJsonPolygon } from './common.ts';
import type {
  DateRange,
  GeoCoordinates,
  LabSoilTestResult,
  SoilBoundaryContext,
  SoilMoistureSnapshot,
  SoilProfile,
  SpatialProcessingMetadata,
  SpatialProcessingMode,
  WeatherTelemetrySnapshot,
} from './domain.ts';
import type { EcostressResultPayload } from './ecostress.ts';
import type { HlsResultPayload } from './vegetation.ts';

// ============================================================================
// PHASE 5B — PREDICTIVE INSIGHTS ENGINE (TREND-BASED PROJECTION ONLY)
// ============================================================================

export type PredictiveMetricId = 'ndvi' | 'ndwi' | 'esiRatio' | 'etDailyWm2';

export interface PredictiveHorizonPoint {
  horizonDays: 7 | 14;
  targetDate: string;
  projectedValue: number;
  lowerBound: number;
  upperBound: number;
  uncertaintyHalfWidth: number;
}

export interface PredictiveMetricInsight {
  metric: PredictiveMetricId;
  label: string;
  unit: string;
  claimType: 'trend_projection';
  projectionEligible: boolean;
  ineligibilityReason: string | null;
  basisObservationCount: number;
  basisSpanDays: number | null;
  latestObservedDate: string | null;
  latestObservedValue: number | null;
  slopePerDay: number | null;
  slopePerWeek: number | null;
  trendDirection: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  confidenceLevel: 'moderate' | 'low' | 'insufficient';
  projections: PredictiveHorizonPoint[];
  interpretation: string;
  uncertaintyNotice: string;
  scientificDisclaimer: string;
}

export interface PredictiveInsightsReport {
  generatedAt: string;
  engineVersion: string;
  minimumRequiredObservations: number;
  minimumRequiredSpanDays: number;
  eligibleMetricsCount: number;
  insights: {
    ndvi: PredictiveMetricInsight;
    ndwi: PredictiveMetricInsight;
    esiRatio: PredictiveMetricInsight;
    etDailyWm2: PredictiveMetricInsight;
  };
  overallOutlookNote: string;
  globalPredictionDisclaimer: string;
}

// ============================================================================
// PHASE 5C — ACTIONABLE FARMER RECOMMENDATIONS ENGINE
// ============================================================================

export type ActionRecommendationCategory =
  | 'irrigation_verification'
  | 'field_scouting'
  | 'data_collection'
  | 'crop_management_review'
  | 'monitoring_cadence';

export type ActionRecommendationPriority = 'high' | 'moderate' | 'low';

export interface FarmActionRecommendation {
  id: string;
  category: ActionRecommendationCategory;
  priority: ActionRecommendationPriority;
  claimType: 'actionable_recommendation';
  title: string;
  reason: string;
  evidence: string;
  observationDates: string[];
  sources: string[];
  confidence: 'high' | 'moderate' | 'low';
  limitations: string;
  nextVerificationStep: string;
  prohibitedActionsGuardrail: string;
}

export interface ActionRecommendationsReport {
  generatedAt: string;
  recommendations: FarmActionRecommendation[];
  suppressedGenericOrUnsafeCount: number;
  advisoryScopeNote: string;
}

// ============================================================================
// PHASE 5A — FARM-LEVEL POLYGON-SCOPED UNIFIED INTELLIGENCE
// ============================================================================

export type FarmPostureStatus =
  | 'nominal'
  | 'watch'
  | 'attention_needed'
  | 'insufficient_evidence';

export interface FarmSpatialScaleSummary {
  parcelLabel: string;
  areaHectares: number | null;
  targetCoordinates: GeoCoordinates;
  extractionMode: 'polygon_raster_stats' | 'point_sample';
  ecostressResolution: string | null;
  hlsResolution: string | null;
  smapScaleNote: string | null;
  powerWeatherScaleNote: string | null;
}

export interface FarmObservedConditionsSnapshot {
  weatherMeanTempC: number | null;
  weatherTotalPrecipitationMm: number | null;
  weatherDateRangeLabel: string | null;
  smapSurfaceMoistureM3M3: number | null;
  smapRootZoneMoistureM3M3: number | null;
  smapObservationDate: string | null;
  soilPhMean: number | null;
  soilPhSource: 'measured_lab' | 'modelled_soilgrids' | 'unavailable';
  soilTextureClass: string | null;
  latestEtWm2: number | null;
  latestEtDate: string | null;
  latestEsiRatio: number | null;
  latestEsiDate: string | null;
  latestNdvi: number | null;
  latestNdviDate: string | null;
  latestNdwi: number | null;
  latestNdwiDate: string | null;
}

export interface Phase5FarmIntelligence {
  engineVersion: string;
  generatedAt: string;
  preservesCropAndRotationScores: true;
  postureStatus: FarmPostureStatus;
  postureSummary: string;
  spatialSummary: FarmSpatialScaleSummary;
  observedConditions: FarmObservedConditionsSnapshot;
  confidenceAssessment: EnvironmentalConfidenceAssessment;
  temporalSummary: MultiTemporalAnalysisReport;
  monitoringSummary: EnvironmentalMonitoringReport;
  predictiveInsights: PredictiveInsightsReport;
  actionRecommendations: ActionRecommendationsReport;
  phase4Analytics: Phase4EnvironmentalAnalytics;
  distinctionNotice: {
    observationsLabel: string;
    inferencesLabel: string;
    predictionsLabel: string;
  };
  dataLimitations: string[];
}

export interface FarmIntelligenceRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange?: DateRange;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  weatherTelemetry?: WeatherTelemetrySnapshot | null;
  soilProfile?: SoilProfile | null;
  soilMoisture?: SoilMoistureSnapshot | null;
  labSoilTest?: LabSoilTestResult | null;
  phase4Analytics?: Phase4EnvironmentalAnalytics | null;
  autoFetchCompletedResults?: boolean;
}

export interface FarmIntelligenceResponse {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  intelligence: Phase5FarmIntelligence;
}
