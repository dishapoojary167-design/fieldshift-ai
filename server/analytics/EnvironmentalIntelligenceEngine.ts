import type {
  EcostressResultPayload,
  EnvironmentalAssessmentEvidence,
  EnvironmentalConfidenceAssessment,
  EnvironmentalConfidenceLevel,
  EnvironmentalDataQualityReport,
  EnvironmentalStressReport,
  EvidenceStrengthLevel,
  HlsResultPayload,
  MonitoringThresholdsConfig,
  MultiTemporalAnalysisReport,
  Phase4EnvironmentalAnalytics,
} from '../../shared/index.ts';
import {
  EnvironmentalAlertMonitor,
  PHASE4_ANALYTICS_ENGINE_VERSION,
} from './EnvironmentalAlertMonitor.ts';
import {
  EnvironmentalDataQualityValidator,
  type DataQualityValidationOptions,
} from './EnvironmentalDataQualityValidator.ts';
import {
  DEFAULT_MONITORING_THRESHOLDS,
  EnvironmentalStressDetector,
} from './EnvironmentalStressDetector.ts';
import {
  MultiTemporalAnalyzer,
  type MultiTemporalAnalyzerOptions,
} from './MultiTemporalAnalyzer.ts';

export interface EnvironmentalIntelligenceOptions {
  thresholds?: Partial<MonitoringThresholdsConfig>;
  referenceNowMs?: number;
}

export class EnvironmentalIntelligenceEngine {
  private readonly validator: EnvironmentalDataQualityValidator;
  private readonly temporalAnalyzer: MultiTemporalAnalyzer;
  private readonly stressDetector: EnvironmentalStressDetector;
  private readonly alertMonitor: EnvironmentalAlertMonitor;
  private readonly thresholds: MonitoringThresholdsConfig;

  constructor(options?: EnvironmentalIntelligenceOptions) {
    this.thresholds = {
      ...DEFAULT_MONITORING_THRESHOLDS,
      ...(options?.thresholds ?? {}),
    };
    const validatorOpts: DataQualityValidationOptions = {
      staleDaysThreshold: this.thresholds.staleDaysThreshold,
      minCoveragePercentThreshold: this.thresholds.minCoveragePercent,
      referenceNowMs: options?.referenceNowMs,
    };
    const temporalOpts: MultiTemporalAnalyzerOptions = {
      minimumTrendObservations: this.thresholds.minimumTrendObservations,
      minimumTrendSpanDays: this.thresholds.minimumTrendSpanDays,
      referenceNowMs: options?.referenceNowMs,
    };
    this.validator = new EnvironmentalDataQualityValidator(validatorOpts);
    this.temporalAnalyzer = new MultiTemporalAnalyzer(temporalOpts);
    this.stressDetector = new EnvironmentalStressDetector(this.thresholds);
    this.alertMonitor = new EnvironmentalAlertMonitor(this.thresholds);
  }

  private assessConfidence(
    qualityReport: EnvironmentalDataQualityReport,
    temporalAnalysis: MultiTemporalAnalysisReport,
    stressReport: EnvironmentalStressReport,
  ): EnvironmentalConfidenceAssessment {
    const degradationReasons: string[] = [];
    const uncertaintyExplanations: string[] = [];

    const hasEco = qualityReport.ecostress.available && qualityReport.ecostress.usableScenesCount > 0;
    const hasHls = qualityReport.hls.available && qualityReport.hls.usableScenesCount > 0;

    if (!hasEco && !hasHls) {
      return {
        confidenceLevel: 'insufficient',
        evidenceStrength: 'insufficient',
        confidenceScore0To100: 0,
        degradationReasons: [
          'Neither NASA ECOSTRESS nor Landsat/HLS has valid clear-sky unmasked scenes.',
        ],
        uncertaintyExplanations: [
          'All thermal and optical environmental stress indicators are inconclusive until valid unmasked satellite observations are retrieved.',
        ],
        spatialCoverageFactor: 'No usable satellite pixel coverage over farm boundary.',
        temporalCompletenessFactor: '0 valid scenes.',
        freshnessFactor: 'No valid acquisition timestamps.',
      };
    }

    let score = 0;

    // 1. Mission availability & usable count (up to 35 pts)
    if (hasEco) score += 17;
    else {
      degradationReasons.push('NASA ECOSTRESS thermal ET/ESI observations are unavailable or fully masked.');
      uncertaintyExplanations.push('Thermal evaporative stress cannot be verified without ECOSTRESS 70 m scenes.');
    }
    if (hasHls) score += 18;
    else {
      degradationReasons.push('NASA Landsat/HLS optical reflectance (NDVI/NDWI) observations are unavailable or masked.');
      uncertaintyExplanations.push('Canopy greenness and surface water index cannot be verified without clear-sky HLS 30 m scenes.');
    }

    // 2. Quality & Spatial Coverage (up to 30 pts)
    const ecoCov = qualityReport.ecostress.meanCoveragePercent;
    const hlsCov = qualityReport.hls.meanCoveragePercent;
    const covVals = [ecoCov, hlsCov].filter((v): v is number => v !== null);
    const avgCov = covVals.length > 0 ? covVals.reduce((a, b) => a + b, 0) / covVals.length : 70;
    score += Math.round((Math.min(100, avgCov) / 100) * 30);

    if (avgCov < this.thresholds.minCoveragePercent) {
      degradationReasons.push(
        `Mean parcel valid pixel coverage is ${avgCov.toFixed(1)}% (< ${this.thresholds.minCoveragePercent}% minimum threshold).`,
      );
      uncertaintyExplanations.push(
        'Low valid spatial coverage means parcel averages represent only a partial fraction of the field boundary.',
      );
    }

    const totalScenes = qualityReport.ecostress.totalScenes + qualityReport.hls.totalScenes;
    const maskedScenes =
      qualityReport.ecostress.cloudMaskedCount +
      qualityReport.ecostress.waterMaskedCount +
      qualityReport.hls.cloudMaskedCount +
      qualityReport.hls.shadowMaskedCount +
      qualityReport.hls.waterMaskedCount;
    if (totalScenes > 0 && maskedScenes / totalScenes >= 0.5) {
      score -= 8;
      degradationReasons.push(
        `${maskedScenes} of ${totalScenes} retrieved scenes were rejected due to cloud, shadow, or water masks.`,
      );
    }

    // 3. Temporal completeness & trend eligibility (up to 20 pts)
    const seriesList = Object.values(temporalAnalysis.series);
    const maxObsCount = Math.max(...seriesList.map((s) => s.validObservationCount));
    const trendEligibleCount = seriesList.filter((s) => s.calculatedStatistics.trendEligible).length;
    if (trendEligibleCount >= 2) {
      score += 20;
    } else if (trendEligibleCount === 1 || maxObsCount >= 2) {
      score += 12;
      degradationReasons.push('Limited multi-temporal history across one or more satellite metrics.');
    } else {
      score += 4;
      degradationReasons.push(
        `Fewer than ${temporalAnalysis.minimumTrendObservations} valid scenes per metric; trend directions cannot be established.`,
      );
      uncertaintyExplanations.push(
        'Single-date observations cannot distinguish ongoing crop decline from transient overpass conditions.',
      );
    }

    if (seriesList.some((s) => s.hasIrregularSamplingGaps)) {
      score -= 5;
      degradationReasons.push('Irregular multi-day revisit gaps (> 10–14 days) between clear-sky scenes.');
    }

    // 4. Freshness & cross-mission date alignment (up to 15 pts)
    const latestFlags = [
      qualityReport.latestValidMetrics.etDailyWm2.isStale,
      qualityReport.latestValidMetrics.esiRatio.isStale,
      qualityReport.latestValidMetrics.ndvi.isStale,
      qualityReport.latestValidMetrics.ndwi.isStale,
    ];
    const anyLatestStale = latestFlags.some(Boolean);
    if (!anyLatestStale) {
      score += 15;
    } else {
      score += 3;
      degradationReasons.push(
        `One or more latest valid acquisitions exceed the ${qualityReport.staleDaysThreshold}-day freshness threshold.`,
      );
      uncertaintyExplanations.push(
        'Stale satellite imagery may not reflect current field crop growth stage or recent irrigation/rainfall.',
      );
    }

    const gapDays = temporalAnalysis.crossMissionAlignment.acquisitionGapDays;
    if (gapDays !== null && gapDays > this.thresholds.crossMissionGapDaysThreshold) {
      score -= 6;
      uncertaintyExplanations.push(
        `ECOSTRESS thermal and HLS optical dates differ by ${gapDays} days; thermal stress and canopy greenness reflect different days.`,
      );
    }

    const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
    let confidenceLevel: EnvironmentalConfidenceLevel;
    let evidenceStrength: EvidenceStrengthLevel;

    if (clampedScore >= 75 && hasEco && hasHls && !anyLatestStale && avgCov >= this.thresholds.minCoveragePercent) {
      confidenceLevel = 'high';
      evidenceStrength = 'strong';
    } else if (clampedScore >= 48) {
      confidenceLevel = 'moderate';
      evidenceStrength = 'moderate';
    } else if (clampedScore > 0) {
      confidenceLevel = 'low';
      evidenceStrength = 'limited';
    } else {
      confidenceLevel = 'insufficient';
      evidenceStrength = 'insufficient';
    }

    if (stressReport.inconclusiveCount > 0 && uncertaintyExplanations.length === 0) {
      uncertaintyExplanations.push(
        `${stressReport.inconclusiveCount} environmental stress dimension(s) marked inconclusive due to missing or low-coverage telemetry.`,
      );
    }

    return {
      confidenceLevel,
      evidenceStrength,
      confidenceScore0To100: clampedScore,
      degradationReasons,
      uncertaintyExplanations,
      spatialCoverageFactor:
        covVals.length > 0
          ? `Mean valid parcel coverage ${avgCov.toFixed(1)}% (ECOSTRESS ${ecoCov !== null ? `${ecoCov.toFixed(1)}%` : 'N/A'}, HLS ${hlsCov !== null ? `${hlsCov.toFixed(1)}%` : 'N/A'}).`
          : 'Pixel coverage metadata not supplied (point sample or unavailable).',
      temporalCompletenessFactor: `${qualityReport.ecostress.usableScenesCount} usable ECOSTRESS & ${qualityReport.hls.usableScenesCount} usable HLS scenes (${trendEligibleCount}/4 metrics trend-eligible).`,
      freshnessFactor: anyLatestStale
        ? 'Contains stale latest observation(s) (> freshness threshold).'
        : 'Latest usable acquisitions within active freshness window.',
    };
  }

  private buildEvidenceSummary(
    ecostressPayload: EcostressResultPayload | null | undefined,
    hlsPayload: HlsResultPayload | null | undefined,
    qualityReport: EnvironmentalDataQualityReport,
  ): EnvironmentalAssessmentEvidence[] {
    const evidence: EnvironmentalAssessmentEvidence[] = [];

    if (ecostressPayload) {
      const etSnap = qualityReport.latestValidMetrics.etDailyWm2;
      const esiSnap = qualityReport.latestValidMetrics.esiRatio;
      const dates = Array.from(
        new Set(
          [etSnap.observationTimestamp?.slice(0, 10), esiSnap.observationTimestamp?.slice(0, 10)].filter(
            (d): d is string => Boolean(d),
          ),
        ),
      ).sort();
      evidence.push({
        source: `${ecostressPayload.sourceAttribution?.providerName ?? 'NASA ECOSTRESS'} (${ecostressPayload.sourceAttribution?.daac ?? 'LP DAAC'})`,
        productIds: ecostressPayload.products ?? [],
        observationDates: dates,
        spatialResolution: ecostressPayload.spatialResolution?.label ?? '70 m thermal grid',
        summary: `Usable scenes: ${qualityReport.ecostress.usableScenesCount}/${qualityReport.ecostress.totalScenes} · Latest ET: ${etSnap.value !== null ? `${etSnap.value.toFixed(1)} W/m²` : 'Unavailable'} · Latest ESI: ${esiSnap.value !== null ? esiSnap.value.toFixed(3) : 'Unavailable'}`,
      });
    }

    if (hlsPayload) {
      const ndviSnap = qualityReport.latestValidMetrics.ndvi;
      const ndwiSnap = qualityReport.latestValidMetrics.ndwi;
      const dates = Array.from(
        new Set(
          [ndviSnap.observationTimestamp?.slice(0, 10), ndwiSnap.observationTimestamp?.slice(0, 10)].filter(
            (d): d is string => Boolean(d),
          ),
        ),
      ).sort();
      evidence.push({
        source: `${hlsPayload.sourceAttribution?.providerName ?? 'NASA Landsat/HLS'} (${hlsPayload.sourceAttribution?.daac ?? 'LP DAAC'})`,
        productIds: hlsPayload.products ?? [],
        observationDates: dates,
        spatialResolution: hlsPayload.spatialResolution?.label ?? '30 m surface reflectance grid',
        summary: `Usable scenes: ${qualityReport.hls.usableScenesCount}/${qualityReport.hls.totalScenes} · Latest NDVI: ${ndviSnap.value !== null ? ndviSnap.value.toFixed(3) : 'Unavailable'} · Latest NDWI: ${ndwiSnap.value !== null ? ndwiSnap.value.toFixed(3) : 'Unavailable'}`,
      });
    }

    return evidence;
  }

  public evaluate(params: {
    ecostressPayload?: EcostressResultPayload | null;
    hlsPayload?: HlsResultPayload | null;
    referenceNowMs?: number;
  }): Phase4EnvironmentalAnalytics {
    const nowMs = params.referenceNowMs ?? Date.now();
    const validation = this.validator.validateAll(
      params.ecostressPayload ?? null,
      params.hlsPayload ?? null,
      nowMs,
    );

    const temporalAnalysis = this.temporalAnalyzer.analyze({
      usableEtScenes: validation.usableEtScenes,
      usableEsiScenes: validation.usableEsiScenes,
      usableNdviScenes: validation.usableNdviScenes,
      usableNdwiScenes: validation.usableNdwiScenes,
      qualityReport: validation.qualityReport,
      referenceNowMs: nowMs,
    });

    const stressReport = this.stressDetector.detect({
      qualityReport: validation.qualityReport,
      temporalAnalysis,
      referenceNowMs: nowMs,
    });

    const confidenceAssessment = this.assessConfidence(
      validation.qualityReport,
      temporalAnalysis,
      stressReport,
    );

    const evidenceSummary = this.buildEvidenceSummary(
      params.ecostressPayload,
      params.hlsPayload,
      validation.qualityReport,
    );

    const monitoringReport = this.alertMonitor.evaluate({
      qualityReport: validation.qualityReport,
      temporalAnalysis,
      stressReport,
      confidenceAssessment,
      referenceNowMs: nowMs,
    });

    return {
      engineVersion: PHASE4_ANALYTICS_ENGINE_VERSION,
      generatedAt: new Date(nowMs).toISOString(),
      preservesCropAndRotationScores: true,
      qualityReport: validation.qualityReport,
      temporalAnalysis,
      stressReport,
      confidenceAssessment,
      evidenceSummary,
      monitoringReport,
    };
  }
}
