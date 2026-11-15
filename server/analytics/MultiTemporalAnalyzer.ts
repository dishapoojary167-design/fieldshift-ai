import type {
  EcostressEvapotranspirationObservation,
  EnvironmentalDataQualityReport,
  HlsSurfaceReflectanceObservation,
  MultiTemporalAnalysisReport,
  SamplingGapInterval,
  TemporalMetricSeriesSummary,
  TemporalObservedPoint,
  TemporalStepChange,
  TemporalTrendDirection,
} from '../../shared/index.ts';

export interface MultiTemporalAnalyzerOptions {
  minimumTrendObservations?: number;
  minimumTrendSpanDays?: number;
  expectedMaxGapDaysHls?: number;
  expectedMaxGapDaysEcostress?: number;
  referenceNowMs?: number;
}

export const DEFAULT_MIN_TREND_OBSERVATIONS = 3;
export const DEFAULT_MIN_TREND_SPAN_DAYS = 7;

function computeLinearSlopePerDay(points: Array<{ timestampMs: number; value: number }>): number | null {
  if (points.length < 2) return null;
  const originMs = points[0]!.timestampMs;
  const xs = points.map((p) => (p.timestampMs - originMs) / 86_400_000);
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    num += dx * (ys[i]! - meanY);
    den += dx * dx;
  }
  if (den <= 1e-9) return null;
  return num / den;
}

function computeStdDev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function classifyTrendDirection(
  metric: 'ndvi' | 'ndwi' | 'etDailyWm2' | 'esiRatio',
  slopePerDay: number | null,
  netChange: number | null,
): TemporalTrendDirection {
  if (slopePerDay === null || netChange === null) return 'insufficient_data';
  const deadband =
    metric === 'etDailyWm2'
      ? 1.2 // W/m² per week
      : 0.015; // index ratio per week
  const slopePerWeek = slopePerDay * 7;
  if (slopePerWeek > deadband && netChange > deadband * 0.5) return 'increasing';
  if (slopePerWeek < -deadband && netChange < -deadband * 0.5) return 'decreasing';
  return 'stable';
}

export class MultiTemporalAnalyzer {
  private readonly minTrendObs: number;
  private readonly minTrendSpanDays: number;
  private readonly expectedMaxGapDaysHls: number;
  private readonly expectedMaxGapDaysEcostress: number;

  constructor(options?: MultiTemporalAnalyzerOptions) {
    this.minTrendObs = options?.minimumTrendObservations ?? DEFAULT_MIN_TREND_OBSERVATIONS;
    this.minTrendSpanDays = options?.minimumTrendSpanDays ?? DEFAULT_MIN_TREND_SPAN_DAYS;
    this.expectedMaxGapDaysHls = options?.expectedMaxGapDaysHls ?? 14;
    this.expectedMaxGapDaysEcostress = options?.expectedMaxGapDaysEcostress ?? 10;
  }

  private buildSeriesSummary(params: {
    metric: 'ndvi' | 'ndwi' | 'etDailyWm2' | 'esiRatio';
    label: string;
    unit: string;
    decimals: number;
    comparableProducts: string[];
    excludedProductsOrReasons: string[];
    rawPoints: Array<{
      observationTimestamp: string;
      value: number;
      productId: string;
      coveragePercent: number | null;
      isStale: boolean;
    }>;
    expectedMaxGapDays: number;
  }): TemporalMetricSeriesSummary {
    const sorted = [...params.rawPoints]
      .filter((p) => Number.isFinite(Date.parse(p.observationTimestamp)) && Number.isFinite(p.value))
      .sort((a, b) => Date.parse(a.observationTimestamp) - Date.parse(b.observationTimestamp));

    const observedValues: TemporalObservedPoint[] = sorted.map((p) => ({
      observationTimestamp: p.observationTimestamp,
      date: p.observationTimestamp.slice(0, 10),
      value: Number(p.value.toFixed(params.decimals)),
      productId: p.productId,
      coveragePercent: p.coveragePercent,
      isStale: p.isStale,
    }));

    const uniqueProducts = new Set(observedValues.map((p) => p.productId));
    const mixedSensorsPresent = uniqueProducts.size > 1;

    if (observedValues.length === 0) {
      return {
        metric: params.metric,
        label: params.label,
        unit: params.unit,
        comparableProducts: params.comparableProducts,
        excludedProductsOrReasons: params.excludedProductsOrReasons,
        observedValues: [],
        validObservationCount: 0,
        minRequiredForTrend: this.minTrendObs,
        timeSpanDays: null,
        calculatedStatistics: {
          latestValue: null,
          earliestValue: null,
          netChange: null,
          mean: null,
          min: null,
          max: null,
          stdDev: null,
          slopePerDay: null,
          slopePerWeek: null,
          trendDirection: 'insufficient_data',
          trendEligible: false,
          trendIneligibilityReason: `No valid clear-sky ${params.label} observations are available.`,
        },
        stepChanges: [],
        samplingGaps: [],
        hasIrregularSamplingGaps: false,
        mixedSensorsPresent: false,
        distinctionNotice:
          'Observed satellite points represent measured scene averages; trends and slopes are calculated only when sufficient comparable observations exist.',
      };
    }

    const firstMs = Date.parse(observedValues[0]!.observationTimestamp);
    const lastMs = Date.parse(observedValues[observedValues.length - 1]!.observationTimestamp);
    const timeSpanDays = Math.max(0, Math.round((lastMs - firstMs) / 86_400_000));

    const values = observedValues.map((p) => p.value);
    const meanRaw = values.reduce((a, b) => a + b, 0) / values.length;
    const minRaw = Math.min(...values);
    const maxRaw = Math.max(...values);
    const stdDevRaw = computeStdDev(values, meanRaw);
    const earliestValue = values[0]!;
    const latestValue = values[values.length - 1]!;
    const netChange =
      observedValues.length >= 2
        ? Number((latestValue - earliestValue).toFixed(params.decimals))
        : null;

    const stepChanges: TemporalStepChange[] = [];
    const samplingGaps: SamplingGapInterval[] = [];

    for (let i = 1; i < observedValues.length; i += 1) {
      const prev = observedValues[i - 1]!;
      const curr = observedValues[i]!;
      const prevMs = Date.parse(prev.observationTimestamp);
      const currMs = Date.parse(curr.observationTimestamp);
      const elapsedDays = Math.max(0, Math.round((currMs - prevMs) / 86_400_000));
      const deltaValue = Number((curr.value - prev.value).toFixed(params.decimals));
      const percentChange =
        Math.abs(prev.value) > 1e-6
          ? Number((((curr.value - prev.value) / Math.abs(prev.value)) * 100).toFixed(1))
          : null;
      const ratePerDay = elapsedDays > 0 ? Number((deltaValue / elapsedDays).toFixed(4)) : null;

      stepChanges.push({
        fromDate: prev.date,
        toDate: curr.date,
        fromValue: prev.value,
        toValue: curr.value,
        deltaValue,
        percentChange,
        elapsedDays,
        ratePerDay,
        fromProductId: prev.productId,
        toProductId: curr.productId,
        crossSensorTransition: prev.productId !== curr.productId,
      });

      if (elapsedDays > params.expectedMaxGapDays) {
        samplingGaps.push({
          fromDate: prev.date,
          toDate: curr.date,
          gapDays: elapsedDays,
          exceedsExpectedCadence: true,
          note: `${elapsedDays}-day gap between valid scenes (> expected ~${params.expectedMaxGapDays}-day cadence; likely cloud cover or orbital overpass spacing).`,
        });
      }
    }

    const trendEligible =
      observedValues.length >= this.minTrendObs && timeSpanDays >= this.minTrendSpanDays;

    let slopePerDay: number | null = null;
    let slopePerWeek: number | null = null;
    let trendDirection: TemporalTrendDirection = 'insufficient_data';
    let trendIneligibilityReason: string | null = null;

    if (trendEligible) {
      const rawSlope = computeLinearSlopePerDay(
        observedValues.map((p) => ({
          timestampMs: Date.parse(p.observationTimestamp),
          value: p.value,
        })),
      );
      if (rawSlope !== null) {
        slopePerDay = Number(rawSlope.toFixed(5));
        slopePerWeek = Number((rawSlope * 7).toFixed(4));
        trendDirection = classifyTrendDirection(params.metric, rawSlope, netChange);
      } else {
        trendIneligibilityReason =
          'Observations share identical timestamps; temporal progression cannot be calculated.';
      }
    } else if (observedValues.length < this.minTrendObs) {
      trendIneligibilityReason = `Only ${observedValues.length} valid observation(s) available; at least ${this.minTrendObs} comparable scenes are required before calculating a trend.`;
    } else {
      trendIneligibilityReason = `Observation span is ${timeSpanDays} days; at least ${this.minTrendSpanDays} days between earliest and latest scenes are required for trend direction.`;
    }

    return {
      metric: params.metric,
      label: params.label,
      unit: params.unit,
      comparableProducts: Array.from(uniqueProducts).length > 0
        ? Array.from(uniqueProducts)
        : params.comparableProducts,
      excludedProductsOrReasons: params.excludedProductsOrReasons,
      observedValues,
      validObservationCount: observedValues.length,
      minRequiredForTrend: this.minTrendObs,
      timeSpanDays,
      calculatedStatistics: {
        latestValue,
        earliestValue,
        netChange,
        mean: Number(meanRaw.toFixed(params.decimals)),
        min: Number(minRaw.toFixed(params.decimals)),
        max: Number(maxRaw.toFixed(params.decimals)),
        stdDev: stdDevRaw !== null ? Number(stdDevRaw.toFixed(params.decimals)) : null,
        slopePerDay,
        slopePerWeek,
        trendDirection,
        trendEligible,
        trendIneligibilityReason,
      },
      stepChanges,
      samplingGaps,
      hasIrregularSamplingGaps: samplingGaps.length > 0,
      mixedSensorsPresent,
      distinctionNotice:
        'Observed values are direct clear-sky scene measurements; calculated statistics (net change, step deltas, and regression slopes) summarize historical series and do NOT constitute weather or yield forecasts.',
    };
  }

  public analyze(params: {
    usableEtScenes: EcostressEvapotranspirationObservation[];
    usableEsiScenes: EcostressEvapotranspirationObservation[];
    usableNdviScenes: HlsSurfaceReflectanceObservation[];
    usableNdwiScenes: HlsSurfaceReflectanceObservation[];
    qualityReport: EnvironmentalDataQualityReport;
    referenceNowMs?: number;
  }): MultiTemporalAnalysisReport {
    const nowMs = params.referenceNowMs ?? Date.now();
    const {
      usableEtScenes,
      usableEsiScenes,
      usableNdviScenes,
      usableNdwiScenes,
      qualityReport,
    } = params;

    const comparableEtScenes = usableEtScenes.filter(
      (s) => !s.productId || s.productId === 'ECO_L3T_JET.002',
    );
    const nonComparableEtCount = usableEtScenes.length - comparableEtScenes.length;

    const hasExplicitEsiProduct = usableEsiScenes.some((s) => s.productId === 'ECO_L4T_ESI.002');
    const comparableEsiScenes = hasExplicitEsiProduct
      ? usableEsiScenes.filter((s) => s.productId === 'ECO_L4T_ESI.002')
      : usableEsiScenes;
    const nonComparableEsiCount = usableEsiScenes.length - comparableEsiScenes.length;

    const ndviExcludedReasons: string[] = [];
    if (qualityReport.hls.cloudMaskedCount > 0 || qualityReport.hls.shadowMaskedCount > 0) {
      ndviExcludedReasons.push(
        `Excluded ${qualityReport.hls.cloudMaskedCount} cloud-masked and ${qualityReport.hls.shadowMaskedCount} shadow-masked HLS scenes.`,
      );
    }

    const etExcludedReasons: string[] = [];
    if (nonComparableEtCount > 0) {
      etExcludedReasons.push(
        `Excluded ${nonComparableEtCount} scene(s) not belonging to comparable ECO_L3T_JET.002 daily ET product.`,
      );
    }
    if (qualityReport.ecostress.cloudMaskedCount > 0 || qualityReport.ecostress.waterMaskedCount > 0) {
      etExcludedReasons.push(
        `Excluded ${qualityReport.ecostress.cloudMaskedCount} cloud-masked and ${qualityReport.ecostress.waterMaskedCount} water-masked ECOSTRESS scenes.`,
      );
    }

    const esiExcludedReasons: string[] = [];
    if (nonComparableEsiCount > 0) {
      esiExcludedReasons.push(
        `Excluded ${nonComparableEsiCount} scene(s) not belonging to comparable ECO_L4T_ESI.002 product.`,
      );
    }

    const ndviSeries = this.buildSeriesSummary({
      metric: 'ndvi',
      label: 'Landsat/HLS NDVI',
      unit: 'Ratio (-1 to 1)',
      decimals: 3,
      comparableProducts: ['HLSL30.002', 'HLSS30.002'],
      excludedProductsOrReasons: ndviExcludedReasons,
      rawPoints: usableNdviScenes.map((s) => ({
        observationTimestamp: s.observationTimestamp,
        value: s.ndvi as number,
        productId: s.productId,
        coveragePercent: s.coveragePercent,
        isStale: s.isStale,
      })),
      expectedMaxGapDays: this.expectedMaxGapDaysHls,
    });

    const ndwiSeries = this.buildSeriesSummary({
      metric: 'ndwi',
      label: 'Landsat/HLS NDWI',
      unit: 'Ratio (-1 to 1)',
      decimals: 3,
      comparableProducts: ['HLSL30.002', 'HLSS30.002'],
      excludedProductsOrReasons: ndviExcludedReasons,
      rawPoints: usableNdwiScenes.map((s) => ({
        observationTimestamp: s.observationTimestamp,
        value: s.ndwi as number,
        productId: s.productId,
        coveragePercent: s.coveragePercent,
        isStale: s.isStale,
      })),
      expectedMaxGapDays: this.expectedMaxGapDaysHls,
    });

    const etSeries = this.buildSeriesSummary({
      metric: 'etDailyWm2',
      label: 'ECOSTRESS Daily ET',
      unit: 'W/m²',
      decimals: 1,
      comparableProducts: ['ECO_L3T_JET.002'],
      excludedProductsOrReasons: etExcludedReasons,
      rawPoints: comparableEtScenes.map((s) => ({
        observationTimestamp: s.observationTimestamp,
        value: s.etDailyWm2 as number,
        productId: s.productId,
        coveragePercent: s.coveragePercent,
        isStale: s.isStale,
      })),
      expectedMaxGapDays: this.expectedMaxGapDaysEcostress,
    });

    const esiSeries = this.buildSeriesSummary({
      metric: 'esiRatio',
      label: 'ECOSTRESS Evaporative Stress Index (ESI)',
      unit: 'Ratio (0–1)',
      decimals: 3,
      comparableProducts: ['ECO_L4T_ESI.002'],
      excludedProductsOrReasons: esiExcludedReasons,
      rawPoints: comparableEsiScenes.map((s) => ({
        observationTimestamp: s.observationTimestamp,
        value: s.esiRatio as number,
        productId: s.productId,
        coveragePercent: s.coveragePercent,
        isStale: s.isStale,
      })),
      expectedMaxGapDays: this.expectedMaxGapDaysEcostress,
    });

    const latestEcoDate =
      qualityReport.latestValidMetrics.etDailyWm2.observationTimestamp?.slice(0, 10) ??
      qualityReport.latestValidMetrics.esiRatio.observationTimestamp?.slice(0, 10) ??
      null;
    const latestHlsDate =
      qualityReport.latestValidMetrics.ndvi.observationTimestamp?.slice(0, 10) ??
      qualityReport.latestValidMetrics.ndwi.observationTimestamp?.slice(0, 10) ??
      null;

    let acquisitionGapDays: number | null = null;
    if (latestEcoDate && latestHlsDate) {
      const eMs = Date.parse(`${latestEcoDate}T00:00:00Z`);
      const hMs = Date.parse(`${latestHlsDate}T00:00:00Z`);
      if (Number.isFinite(eMs) && Number.isFinite(hMs)) {
        acquisitionGapDays = Math.round(Math.abs(eMs - hMs) / 86_400_000);
      }
    }

    const crossNote =
      acquisitionGapDays === null
        ? 'Only one mission has valid acquisitions; ECOSTRESS and HLS timestamps remain tracked independently.'
        : acquisitionGapDays === 0
          ? `Latest ECOSTRESS (${latestEcoDate}) and HLS (${latestHlsDate}) acquisitions occurred on the same calendar date.`
          : `Latest ECOSTRESS (${latestEcoDate}) and HLS (${latestHlsDate}) acquisitions are ${acquisitionGapDays} day(s) apart and must never be interpreted as simultaneous observations.`;

    const limitations: string[] = [
      `Trends are computed only when at least ${this.minTrendObs} valid clear-sky scenes span at least ${this.minTrendSpanDays} days.`,
      'ECOSTRESS thermal products (70 m, variable overpass time-of-day) and HLS optical indices (30 m) are never combined into single cross-mission averages.',
    ];
    if (ndviSeries.hasIrregularSamplingGaps || etSeries.hasIrregularSamplingGaps) {
      limitations.push(
        'Irregular multi-day gaps exist between clear-sky scenes due to cloud cover or revisit geometry; linear slopes average over missing intervals.',
      );
    }

    return {
      evaluatedAt: new Date(nowMs).toISOString(),
      minimumTrendObservations: this.minTrendObs,
      minimumTrendSpanDays: this.minTrendSpanDays,
      series: {
        ndvi: ndviSeries,
        ndwi: ndwiSeries,
        etDailyWm2: etSeries,
        esiRatio: esiSeries,
      },
      crossMissionAlignment: {
        latestEcostressDate: latestEcoDate,
        latestHlsDate,
        acquisitionGapDays,
        treatedAsSimultaneous: false,
        note: crossNote,
      },
      limitations,
    };
  }
}
