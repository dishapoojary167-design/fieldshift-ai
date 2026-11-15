import type {
  EcostressResultPayload,
  FarmIntelligenceRequest,
  FarmObservedConditionsSnapshot,
  FarmPostureStatus,
  FarmSpatialScaleSummary,
  GeoCoordinates,
  HlsResultPayload,
  MonitoringThresholdsConfig,
  Phase4EnvironmentalAnalytics,
  Phase5FarmIntelligence,
  SoilBoundaryContext,
} from '../../shared/index.ts';
import { runPhase4EnvironmentalAnalytics } from '../analytics/index.ts';
import { ActionRecommendationEngine } from './ActionRecommendationEngine.ts';
import { PredictiveInsightsEngine } from './PredictiveInsightsEngine.ts';

export const PHASE5_INTELLIGENCE_ENGINE_VERSION = '5.0.0-farm-intelligence';

export interface EvaluateFarmIntelligenceParams {
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  ecostressPayload?: EcostressResultPayload | null;
  hlsPayload?: HlsResultPayload | null;
  weatherTelemetry?: FarmIntelligenceRequest['weatherTelemetry'];
  soilProfile?: FarmIntelligenceRequest['soilProfile'];
  soilMoisture?: FarmIntelligenceRequest['soilMoisture'];
  labSoilTest?: FarmIntelligenceRequest['labSoilTest'];
  precomputedPhase4?: Phase4EnvironmentalAnalytics | null;
  thresholds?: Partial<MonitoringThresholdsConfig>;
  referenceNowMs?: number;
}

export class FarmLevelIntelligenceService {
  private readonly predictiveEngine = new PredictiveInsightsEngine();
  private readonly actionEngine = new ActionRecommendationEngine();

  private buildSpatialSummary(
    location: GeoCoordinates,
    boundaryContext?: SoilBoundaryContext,
    ecostressPayload?: EcostressResultPayload | null,
    hlsPayload?: HlsResultPayload | null,
  ): FarmSpatialScaleSummary {
    const parcelLabel = boundaryContext
      ? `${boundaryContext.name} (${boundaryContext.areaHectares.toFixed(2)} ha polygon)`
      : `Coordinate (${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°)`;

    const extractionMode =
      boundaryContext ||
      ecostressPayload?.taskType === 'area' ||
      hlsPayload?.taskType === 'area'
        ? 'polygon_raster_stats'
        : 'point_sample';

    return {
      parcelLabel,
      areaHectares: boundaryContext?.areaHectares ?? null,
      targetCoordinates: location,
      extractionMode,
      ecostressResolution: ecostressPayload?.spatialResolution?.label ?? null,
      hlsResolution: hlsPayload?.spatialResolution?.label ?? null,
      smapScaleNote:
        'NASA SMAP L4 represents a ~9 km regional root-zone moisture grid, coarser than 30 m/70 m parcel imagery.',
      powerWeatherScaleNote:
        'NASA POWER provides ~50 km agroclimatology grid cells; field microclimate and localized rainfall can vary.',
    };
  }

  private buildObservedConditions(
    params: EvaluateFarmIntelligenceParams,
    analytics: Phase4EnvironmentalAnalytics,
  ): FarmObservedConditionsSnapshot {
    const { latestValidMetrics } = analytics.qualityReport;
    const weather = params.weatherTelemetry ?? null;
    const soilMoisture = params.soilMoisture ?? null;
    const soilProfile = params.soilProfile ?? null;
    const lab = params.labSoilTest ?? null;

    const labPh = lab?.ph ?? null;
    const sgPh = soilProfile?.surfaceSummary?.ph?.mean ?? null;
    const soilPhMean = labPh !== null ? labPh : sgPh;
    const soilPhSource: FarmObservedConditionsSnapshot['soilPhSource'] =
      labPh !== null
        ? 'measured_lab'
        : sgPh !== null
          ? 'modelled_soilgrids'
          : 'unavailable';

    return {
      weatherMeanTempC: weather?.summary?.meanTempC ?? null,
      weatherTotalPrecipitationMm: weather?.summary?.totalPrecipitationMm ?? null,
      weatherDateRangeLabel: weather?.dateRange
        ? `${weather.dateRange.startDate} to ${weather.dateRange.endDate}`
        : null,
      smapSurfaceMoistureM3M3: soilMoisture?.surfaceMoistureM3M3 ?? null,
      smapRootZoneMoistureM3M3: soilMoisture?.rootZoneMoistureM3M3 ?? null,
      smapObservationDate: soilMoisture?.observationDate ?? null,
      soilPhMean,
      soilPhSource,
      soilTextureClass: lab?.textureClass ?? soilProfile?.surfaceSummary?.textureClass ?? null,
      latestEtWm2: latestValidMetrics.etDailyWm2.value,
      latestEtDate: latestValidMetrics.etDailyWm2.observationTimestamp,
      latestEsiRatio: latestValidMetrics.esiRatio.value,
      latestEsiDate: latestValidMetrics.esiRatio.observationTimestamp,
      latestNdvi: latestValidMetrics.ndvi.value,
      latestNdviDate: latestValidMetrics.ndvi.observationTimestamp,
      latestNdwi: latestValidMetrics.ndwi.value,
      latestNdwiDate: latestValidMetrics.ndwi.observationTimestamp,
    };
  }

  private determinePosture(analytics: Phase4EnvironmentalAnalytics): {
    status: FarmPostureStatus;
    summary: string;
  } {
    const { confidenceAssessment, stressReport, qualityReport } = analytics;
    if (
      confidenceAssessment.confidenceLevel === 'insufficient' ||
      (qualityReport.ecostress.usableScenesCount === 0 && qualityReport.hls.usableScenesCount === 0)
    ) {
      return {
        status: 'insufficient_evidence',
        summary:
          'Insufficient validated clear-sky satellite evidence across the parcel to determine current thermal or canopy stress posture.',
      };
    }

    if (stressReport.overallStatus === 'observed_concern') {
      return {
        status: 'attention_needed',
        summary: `Active environmental concern detected across ${stressReport.activeConcernCount} indicator dimension(s) with ${confidenceAssessment.confidenceLevel} confidence; field verification advised.`,
      };
    }

    if (
      stressReport.overallStatus === 'possible_stress' ||
      confidenceAssessment.confidenceLevel === 'low'
    ) {
      return {
        status: 'watch',
        summary:
          'Moderate stress signals or partial satellite coverage/freshness limitations detected; monitor closely and verify on the ground.',
      };
    }

    return {
      status: 'nominal',
      summary:
        'Validated satellite observations indicate nominal canopy greenness and evaporative balance within current freshness and coverage limits.',
    };
  }

  public evaluate(params: EvaluateFarmIntelligenceParams): Phase5FarmIntelligence {
    const nowMs = params.referenceNowMs ?? Date.now();
    const phase4Analytics =
      params.precomputedPhase4 ??
      runPhase4EnvironmentalAnalytics({
        ecostressPayload: params.ecostressPayload ?? null,
        hlsPayload: params.hlsPayload ?? null,
        thresholds: params.thresholds,
        referenceNowMs: nowMs,
      });

    const spatialSummary = this.buildSpatialSummary(
      params.location,
      params.boundaryContext,
      params.ecostressPayload,
      params.hlsPayload,
    );

    const observedConditions = this.buildObservedConditions(params, phase4Analytics);
    const predictiveInsights = this.predictiveEngine.generate(phase4Analytics, nowMs);
    const actionRecommendations = this.actionEngine.generate({
      analytics: phase4Analytics,
      predictions: predictiveInsights,
      observedConditions,
      referenceNowMs: nowMs,
    });

    const posture = this.determinePosture(phase4Analytics);

    const limitations = Array.from(
      new Set([
        ...phase4Analytics.qualityReport.caveats,
        ...phase4Analytics.temporalAnalysis.limitations,
        ...phase4Analytics.confidenceAssessment.uncertaintyExplanations,
      ]),
    );

    return {
      engineVersion: PHASE5_INTELLIGENCE_ENGINE_VERSION,
      generatedAt: new Date(nowMs).toISOString(),
      preservesCropAndRotationScores: true,
      postureStatus: posture.status,
      postureSummary: posture.summary,
      spatialSummary,
      observedConditions,
      confidenceAssessment: phase4Analytics.confidenceAssessment,
      temporalSummary: phase4Analytics.temporalAnalysis,
      monitoringSummary: phase4Analytics.monitoringReport,
      predictiveInsights,
      actionRecommendations,
      phase4Analytics,
      distinctionNotice: {
        observationsLabel:
          'Direct satellite & station measurements (ECOSTRESS 70 m ET/ESI, Landsat/HLS 30 m NDVI/NDWI, NASA POWER, SMAP, Lab soil tests) reported strictly on their acquisition dates.',
        inferencesLabel:
          'Agronomic screening inferences & action recommendations derived deterministically from validated rules and ISRIC SoilGrids estimates; verify in-field.',
        predictionsLabel:
          'Trend projections (7–14 day window) mathematically extrapolate validated historical slopes with uncertainty bounds; NOT weather forecasts or crop yield guarantees.',
      },
      dataLimitations: limitations,
    };
  }
}
