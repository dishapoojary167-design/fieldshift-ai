import type {
  LatestValidatedMetricSnapshot,
  Phase4EnvironmentalAnalytics,
  PredictiveHorizonPoint,
  PredictiveInsightsReport,
  PredictiveMetricId,
  PredictiveMetricInsight,
  TemporalMetricSeriesSummary,
} from '../../shared/index.ts';

export const PREDICTIVE_ENGINE_VERSION = '5.0.0-trend-projection';

const METRIC_BOUNDS: Record<PredictiveMetricId, { min: number; max: number; decimals: number; defaultSigma: number }> = {
  ndvi: { min: -1, max: 1, decimals: 3, defaultSigma: 0.045 },
  ndwi: { min: -1, max: 1, decimals: 3, defaultSigma: 0.045 },
  esiRatio: { min: 0, max: 1, decimals: 3, defaultSigma: 0.06 },
  etDailyWm2: { min: 0, max: 1500, decimals: 1, defaultSigma: 28 },
};

const GLOBAL_PREDICTION_DISCLAIMER =
  'Phase 5B Trend Projections extrapolate recent clear-sky satellite slopes over 7–14 days with uncertainty bands. They are NOT numerical weather forecasts, seasonal climate predictions, biological growth simulations, or crop yield guarantees.';

function addDaysIsoDate(isoTimestamp: string, daysToAdd: number): string {
  const baseMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(baseMs)) {
    const fallback = new Date(Date.now() + daysToAdd * 86_400_000);
    return fallback.toISOString().slice(0, 10);
  }
  return new Date(baseMs + daysToAdd * 86_400_000).toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeResidualStdDev(series: TemporalMetricSeriesSummary, slopePerDay: number): number | null {
  const pts = series.observedValues;
  if (pts.length < 3) return null;
  const parsed = pts
    .map((p) => ({ tMs: Date.parse(p.observationTimestamp), y: p.value }))
    .filter((p) => Number.isFinite(p.tMs));
  if (parsed.length < 3) return null;
  const originMs = parsed[0]!.tMs;
  const xs = parsed.map((p) => (p.tMs - originMs) / 86_400_000);
  const ys = parsed.map((p) => p.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const intercept = meanY - slopePerDay * meanX;
  const sqResiduals = xs.map((x, idx) => (ys[idx]! - (intercept + slopePerDay * x)) ** 2);
  const dof = Math.max(1, xs.length - 2);
  return Math.sqrt(sqResiduals.reduce((a, b) => a + b, 0) / dof);
}

export class PredictiveInsightsEngine {
  private buildMetricProjection(
    metric: PredictiveMetricId,
    series: TemporalMetricSeriesSummary,
    latestSnap: LatestValidatedMetricSnapshot,
    overallConfidence: Phase4EnvironmentalAnalytics['confidenceAssessment']['confidenceLevel'],
  ): PredictiveMetricInsight {
    const bounds = METRIC_BOUNDS[metric];
    const stats = series.calculatedStatistics;
    const latestValue = latestSnap.value ?? stats.latestValue;
    const latestDate =
      latestSnap.observationTimestamp?.slice(0, 10) ??
      series.observedValues.at(-1)?.date ??
      null;

    // Minimum-history & freshness gating
    if (
      !stats.trendEligible ||
      stats.slopePerDay === null ||
      latestValue === null ||
      !latestDate
    ) {
      return {
        metric,
        label: series.label,
        unit: series.unit,
        claimType: 'trend_projection',
        projectionEligible: false,
        ineligibilityReason:
          stats.trendIneligibilityReason ??
          `Insufficient validated multi-temporal scenes (${series.validObservationCount} available; minimum ${series.minRequiredForTrend} scenes spanning ≥ 7 days required).`,
        basisObservationCount: series.validObservationCount,
        basisSpanDays: series.timeSpanDays,
        latestObservedDate: latestDate,
        latestObservedValue: latestValue,
        slopePerDay: null,
        slopePerWeek: null,
        trendDirection: stats.trendDirection,
        confidenceLevel: 'insufficient',
        projections: [],
        interpretation:
          'Short-term trend projection withheld because historical clear-sky observations do not meet minimum temporal requirements.',
        uncertaintyNotice:
          'No trajectory projected; collect additional clear-sky overpasses over at least 7 days before extrapolating trends.',
        scientificDisclaimer: GLOBAL_PREDICTION_DISCLAIMER,
      };
    }

    if (latestSnap.isStale) {
      return {
        metric,
        label: series.label,
        unit: series.unit,
        claimType: 'trend_projection',
        projectionEligible: false,
        ineligibilityReason: `Latest clear-sky observation (${latestDate}) is older than the freshness threshold (${latestSnap.ageDays ?? '>45'} days old); stale trends cannot safely project forward.`,
        basisObservationCount: series.validObservationCount,
        basisSpanDays: series.timeSpanDays,
        latestObservedDate: latestDate,
        latestObservedValue: latestValue,
        slopePerDay: stats.slopePerDay,
        slopePerWeek: stats.slopePerWeek,
        trendDirection: stats.trendDirection,
        confidenceLevel: 'insufficient',
        projections: [],
        interpretation:
          'Historical trend was detected, but latest acquisition is stale so short-term forward projection is suppressed.',
        uncertaintyNotice:
          'Retrieve a fresher acquisition window to evaluate current trajectory.',
        scientificDisclaimer: GLOBAL_PREDICTION_DISCLAIMER,
      };
    }

    if (overallConfidence === 'insufficient') {
      return {
        metric,
        label: series.label,
        unit: series.unit,
        claimType: 'trend_projection',
        projectionEligible: false,
        ineligibilityReason: 'Overall Phase 4 data confidence is insufficient for projection.',
        basisObservationCount: series.validObservationCount,
        basisSpanDays: series.timeSpanDays,
        latestObservedDate: latestDate,
        latestObservedValue: latestValue,
        slopePerDay: stats.slopePerDay,
        slopePerWeek: stats.slopePerWeek,
        trendDirection: stats.trendDirection,
        confidenceLevel: 'insufficient',
        projections: [],
        interpretation: 'Projection suppressed due to insufficient underlying data confidence.',
        uncertaintyNotice: 'Resolve spatial coverage or masking limitations first.',
        scientificDisclaimer: GLOBAL_PREDICTION_DISCLAIMER,
      };
    }

    const residualStd = computeResidualStdDev(series, stats.slopePerDay) ?? bounds.defaultSigma;
    const baseSigma = Math.max(bounds.defaultSigma * 0.65, residualStd);
    const gapPenalty = series.hasIrregularSamplingGaps ? 1.35 : 1.0;

    // Dampen slope lightly beyond 7 days (conservative trend extrapolation)
    const horizons: Array<7 | 14> = [7, 14];
    const projections: PredictiveHorizonPoint[] = horizons.map((h) => {
      const effectiveDays = h === 7 ? 7 : 12.5;
      const rawProjected = latestValue + stats.slopePerDay! * effectiveDays;
      const projectedValue = Number(clamp(rawProjected, bounds.min, bounds.max).toFixed(bounds.decimals));
      const halfWidthRaw = baseSigma * Math.sqrt(h / 7) * 1.45 * gapPenalty;
      const lowerBound = Number(clamp(projectedValue - halfWidthRaw, bounds.min, bounds.max).toFixed(bounds.decimals));
      const upperBound = Number(clamp(projectedValue + halfWidthRaw, bounds.min, bounds.max).toFixed(bounds.decimals));
      return {
        horizonDays: h,
        targetDate: addDaysIsoDate(latestDate, h),
        projectedValue,
        lowerBound,
        upperBound,
        uncertaintyHalfWidth: Number(halfWidthRaw.toFixed(bounds.decimals)),
      };
    });

    const confLevel: 'moderate' | 'low' =
      overallConfidence === 'high' && !series.hasIrregularSamplingGaps && series.validObservationCount >= 4
        ? 'moderate'
        : 'low';

    const p14 = projections[1]!;
    const directionSummary =
      stats.trendDirection === 'decreasing'
        ? `Recent ${series.label} slope (${stats.slopePerWeek?.toFixed(bounds.decimals)} ${series.unit}/wk) projects a continued downward trajectory toward ~${p14.projectedValue} (band ${p14.lowerBound}–${p14.upperBound}) by ${p14.targetDate} if current trajectory persists.`
        : stats.trendDirection === 'increasing'
          ? `Recent ${series.label} slope (+${stats.slopePerWeek?.toFixed(bounds.decimals)} ${series.unit}/wk) projects upward movement toward ~${p14.projectedValue} (band ${p14.lowerBound}–${p14.upperBound}) by ${p14.targetDate} if current trajectory persists.`
          : `Recent ${series.label} values remain relatively steady near ${latestValue.toFixed(bounds.decimals)} (${p14.lowerBound}–${p14.upperBound} range over 14 days).`;

    return {
      metric,
      label: series.label,
      unit: series.unit,
      claimType: 'trend_projection',
      projectionEligible: true,
      ineligibilityReason: null,
      basisObservationCount: series.validObservationCount,
      basisSpanDays: series.timeSpanDays,
      latestObservedDate: latestDate,
      latestObservedValue: latestValue,
      slopePerDay: stats.slopePerDay,
      slopePerWeek: stats.slopePerWeek,
      trendDirection: stats.trendDirection,
      confidenceLevel: confLevel,
      projections,
      interpretation: directionSummary,
      uncertaintyNotice: series.hasIrregularSamplingGaps
        ? 'Irregular sampling gaps (>14d) widen the 7–14 day uncertainty interval; actual field conditions will shift with rainfall, irrigation, or harvest.'
        : 'Uncertainty interval reflects historical scene variance and horizon growth; sudden rain, heatwaves, or field operations will alter the curve.',
      scientificDisclaimer: GLOBAL_PREDICTION_DISCLAIMER,
    };
  }

  public generate(
    analytics: Phase4EnvironmentalAnalytics,
    referenceNowMs?: number,
  ): PredictiveInsightsReport {
    const nowIso = new Date(referenceNowMs ?? Date.now()).toISOString();
    const { qualityReport, temporalAnalysis, confidenceAssessment } = analytics;

    const ndvi = this.buildMetricProjection(
      'ndvi',
      temporalAnalysis.series.ndvi,
      qualityReport.latestValidMetrics.ndvi,
      confidenceAssessment.confidenceLevel,
    );
    const ndwi = this.buildMetricProjection(
      'ndwi',
      temporalAnalysis.series.ndwi,
      qualityReport.latestValidMetrics.ndwi,
      confidenceAssessment.confidenceLevel,
    );
    const esiRatio = this.buildMetricProjection(
      'esiRatio',
      temporalAnalysis.series.esiRatio,
      qualityReport.latestValidMetrics.esiRatio,
      confidenceAssessment.confidenceLevel,
    );
    const etDailyWm2 = this.buildMetricProjection(
      'etDailyWm2',
      temporalAnalysis.series.etDailyWm2,
      qualityReport.latestValidMetrics.etDailyWm2,
      confidenceAssessment.confidenceLevel,
    );

    const allInsights = [ndvi, ndwi, esiRatio, etDailyWm2];
    const eligibleCount = allInsights.filter((i) => i.projectionEligible).length;

    const overallOutlookNote =
      eligibleCount === 0
        ? 'No satellite metrics currently satisfy the minimum history (≥3 valid scenes across ≥7 days) and freshness requirements for trend-based projection.'
        : `Generated short-term (7–14 day) trend projections for ${eligibleCount}/4 satellite metrics based strictly on validated historical regression slopes.`;

    return {
      generatedAt: nowIso,
      engineVersion: PREDICTIVE_ENGINE_VERSION,
      minimumRequiredObservations: temporalAnalysis.minimumTrendObservations,
      minimumRequiredSpanDays: temporalAnalysis.minimumTrendSpanDays,
      eligibleMetricsCount: eligibleCount,
      insights: {
        ndvi,
        ndwi,
        esiRatio,
        etDailyWm2,
      },
      overallOutlookNote,
      globalPredictionDisclaimer: GLOBAL_PREDICTION_DISCLAIMER,
    };
  }
}
