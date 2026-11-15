import type {
  EnvironmentalDataQualityReport,
  EnvironmentalStressIndicator,
  EnvironmentalStressReport,
  MonitoringThresholdsConfig,
  MultiTemporalAnalysisReport,
  StressSignalStatus,
} from '../../shared/index.ts';

export const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholdsConfig = {
  staleDaysThreshold: 45,
  minCoveragePercent: 50,
  minimumTrendObservations: 3,
  minimumTrendSpanDays: 7,
  lowNdviThreshold: 0.25,
  ndviDropDeltaThreshold: -0.12,
  lowNdwiThreshold: -0.1,
  ndwiDropDeltaThreshold: -0.1,
  esiStressThreshold: 0.4,
  esiModerateThreshold: 0.65,
  etSharpDropPercent: -30,
  crossMissionGapDaysThreshold: 7,
};

function mergeThresholds(
  overrides?: Partial<MonitoringThresholdsConfig>,
): MonitoringThresholdsConfig {
  return {
    ...DEFAULT_MONITORING_THRESHOLDS,
    ...(overrides ?? {}),
  };
}

function summarizeOverallStatus(indicators: EnvironmentalStressIndicator[]): StressSignalStatus {
  if (indicators.some((i) => i.status === 'observed_concern')) return 'observed_concern';
  if (indicators.some((i) => i.status === 'possible_stress')) return 'possible_stress';
  if (indicators.every((i) => i.status === 'inconclusive')) return 'inconclusive';
  return 'nominal';
}

export class EnvironmentalStressDetector {
  private readonly thresholds: MonitoringThresholdsConfig;

  constructor(thresholds?: Partial<MonitoringThresholdsConfig>) {
    this.thresholds = mergeThresholds(thresholds);
  }

  public detect(params: {
    qualityReport: EnvironmentalDataQualityReport;
    temporalAnalysis: MultiTemporalAnalysisReport;
    referenceNowMs?: number;
  }): EnvironmentalStressReport {
    const nowMs = params.referenceNowMs ?? Date.now();
    const { qualityReport, temporalAnalysis } = params;
    const { latestValidMetrics, hls, ecostress } = qualityReport;
    const { ndvi: ndviSeries, ndwi: ndwiSeries, etDailyWm2: etSeries, esiRatio: esiSeries } =
      temporalAnalysis.series;

    const indicators: EnvironmentalStressIndicator[] = [];

    // 1. Vegetation Condition (HLS NDVI 30 m)
    const latestNdvi = latestValidMetrics.ndvi;
    const hlsCoverageOk =
      latestNdvi.coveragePercent === null ||
      latestNdvi.coveragePercent >= this.thresholds.minCoveragePercent;

    if (latestNdvi.value === null || !hls.available || hls.usableScenesCount === 0) {
      indicators.push({
        id: 'vegetation_condition',
        title: 'Vegetation Canopy Condition (HLS NDVI)',
        status: 'inconclusive',
        severity: 'unknown',
        directObservations: ['No valid clear-sky Landsat/HLS NDVI scenes available.'],
        derivedIndicators: [],
        agronomicInterpretation:
          'Vegetation vigor cannot be evaluated because clear-sky HLS reflectance observations are absent or cloud/shadow masked.',
        prohibitedInferenceGuardrail:
          'Never infer pest, fungal, or nutrient disease causes from missing or masked satellite imagery.',
        observationDates: [],
        supportingRuleIds: ['RULE_VEG_INSUFFICIENT'],
      });
    } else {
      const obsDates = ndviSeries.observedValues.map((p) => p.date);
      const directObs = [
        `Latest clear-sky NDVI (${latestNdvi.productId ?? 'HLS'}): ${latestNdvi.value.toFixed(3)} acquired ${latestNdvi.observationTimestamp?.slice(0, 10) ?? 'unknown'}.`,
      ];
      const derived: string[] = [];
      const rules: string[] = [];

      const latestStep = ndviSeries.stepChanges.at(-1);
      const netChange = ndviSeries.calculatedStatistics.netChange;
      const slopeDir = ndviSeries.calculatedStatistics.trendDirection;

      if (netChange !== null) {
        derived.push(
          `Window net NDVI change: ${netChange >= 0 ? '+' : ''}${netChange.toFixed(3)} across ${ndviSeries.validObservationCount} valid scenes (${ndviSeries.timeSpanDays ?? 0} days).`,
        );
      }
      if (latestStep) {
        derived.push(
          `Latest scene-to-scene delta: ${latestStep.deltaValue >= 0 ? '+' : ''}${latestStep.deltaValue.toFixed(3)} (${latestStep.fromDate} → ${latestStep.toDate}).`,
        );
      }
      if (ndviSeries.calculatedStatistics.trendEligible) {
        derived.push(`Calculated NDVI trend direction: ${slopeDir}.`);
      }

      const sharpDecline =
        (latestStep && latestStep.deltaValue <= this.thresholds.ndviDropDeltaThreshold) ||
        (netChange !== null && netChange <= this.thresholds.ndviDropDeltaThreshold && slopeDir === 'decreasing');
      const veryLowGreenness = latestNdvi.value < this.thresholds.lowNdviThreshold;

      let status: StressSignalStatus = 'nominal';
      let severity: 'high' | 'moderate' | 'low' | 'unknown' = 'low';
      let interpretation =
        'Clear-sky NDVI reflects stable or healthy photosynthetic canopy cover within normal expected progression.';

      if (!hlsCoverageOk || latestNdvi.isStale) {
        status = sharpDecline || veryLowGreenness ? 'possible_stress' : 'inconclusive';
        severity = sharpDecline || veryLowGreenness ? 'moderate' : 'unknown';
        interpretation =
          'Observed NDVI suggests potential canopy thinning or fallow/bare soil, but reduced parcel pixel coverage or observation age limits certainty. Verify stand vigor in-field.';
        rules.push('RULE_VEG_DEGRADED_CONTEXT');
      } else if (sharpDecline) {
        status = 'observed_concern';
        severity = latestStep && latestStep.deltaValue <= -0.2 ? 'high' : 'moderate';
        interpretation =
          'Clear-sky 30 m NDVI declined noticeably over recent valid scenes, which may correspond to canopy stress, harvest/tillage activity, or crop senescence.';
        rules.push('RULE_VEG_SHARP_DECLINE');
      } else if (veryLowGreenness) {
        status = 'possible_stress';
        severity = 'moderate';
        interpretation =
          `Observed NDVI (${latestNdvi.value.toFixed(3)}) is low (< ${this.thresholds.lowNdviThreshold}), consistent with sparse vegetation cover, early emergence, post-harvest fallow, or poor stand establishment.`;
        rules.push('RULE_VEG_LOW_NDVI');
      } else {
        rules.push('RULE_VEG_NOMINAL');
      }

      indicators.push({
        id: 'vegetation_condition',
        title: 'Vegetation Canopy Condition (HLS NDVI)',
        status,
        severity,
        directObservations: directObs,
        derivedIndicators: derived,
        agronomicInterpretation: interpretation,
        prohibitedInferenceGuardrail:
          'NDVI measures red/NIR greenness reflectance only; it CANNOT diagnose crop diseases, pests, soil fertility, or root-zone water status.',
        observationDates: obsDates.length > 0 ? obsDates : latestNdvi.observationTimestamp ? [latestNdvi.observationTimestamp.slice(0, 10)] : [],
        supportingRuleIds: rules,
      });
    }

    // 2. Water-Related Spectral Index (HLS NDWI 30 m)
    const latestNdwi = latestValidMetrics.ndwi;
    const ndwiCoverageOk =
      latestNdwi.coveragePercent === null ||
      latestNdwi.coveragePercent >= this.thresholds.minCoveragePercent;

    if (latestNdwi.value === null || !hls.available || hls.usableScenesCount === 0) {
      indicators.push({
        id: 'water_related_spectral',
        title: 'Canopy & Surface Spectral Wetness (HLS NDWI)',
        status: 'inconclusive',
        severity: 'unknown',
        directObservations: ['No valid clear-sky Landsat/HLS NDWI scenes available.'],
        derivedIndicators: [],
        agronomicInterpretation:
          'Optical canopy water status cannot be assessed without valid clear-sky HLS green/NIR/SWIR reflectance.',
        prohibitedInferenceGuardrail:
          'NDWI is an optical leaf/surface water index and NEVER directly measures subsurface soil moisture or irrigation requirement.',
        observationDates: [],
        supportingRuleIds: ['RULE_NDWI_INSUFFICIENT'],
      });
    } else {
      const obsDates = ndwiSeries.observedValues.map((p) => p.date);
      const directObs = [
        `Latest clear-sky NDWI (${latestNdwi.productId ?? 'HLS'}): ${latestNdwi.value.toFixed(3)} acquired ${latestNdwi.observationTimestamp?.slice(0, 10) ?? 'unknown'}.`,
      ];
      const derived: string[] = [];
      const rules: string[] = [];

      const latestStep = ndwiSeries.stepChanges.at(-1);
      const netChange = ndwiSeries.calculatedStatistics.netChange;
      if (netChange !== null) {
        derived.push(
          `Window net NDWI change: ${netChange >= 0 ? '+' : ''}${netChange.toFixed(3)} across ${ndwiSeries.validObservationCount} valid scenes.`,
        );
      }
      if (latestStep) {
        derived.push(
          `Latest NDWI delta: ${latestStep.deltaValue >= 0 ? '+' : ''}${latestStep.deltaValue.toFixed(3)} (${latestStep.fromDate} → ${latestStep.toDate}).`,
        );
      }

      const ndwiDrop =
        (latestStep && latestStep.deltaValue <= this.thresholds.ndwiDropDeltaThreshold) ||
        (netChange !== null && netChange <= this.thresholds.ndwiDropDeltaThreshold);
      const lowNdwi = latestNdwi.value < this.thresholds.lowNdwiThreshold;

      let status: StressSignalStatus = 'nominal';
      let severity: 'high' | 'moderate' | 'low' | 'unknown' = 'low';
      let interpretation =
        'Optical NDWI does not show pronounced canopy desiccation or surface moisture loss.';

      if (!ndwiCoverageOk || latestNdwi.isStale) {
        status = ndwiDrop || lowNdwi ? 'possible_stress' : 'inconclusive';
        severity = ndwiDrop || lowNdwi ? 'moderate' : 'unknown';
        interpretation =
          'Spectral wetness reading indicates possible canopy/surface dryness, though observation age or partial pixel coverage limits certainty.';
        rules.push('RULE_NDWI_DEGRADED_CONTEXT');
      } else if (ndwiDrop && lowNdwi) {
        status = 'observed_concern';
        severity = 'high';
        interpretation =
          `NDWI declined (${latestStep?.deltaValue.toFixed(3) ?? netChange?.toFixed(3)}) to ${latestNdwi.value.toFixed(3)} (< ${this.thresholds.lowNdwiThreshold}), suggesting reduced canopy water content or drier surface reflectance.`;
        rules.push('RULE_NDWI_DROP_AND_LOW');
      } else if (ndwiDrop || lowNdwi) {
        status = 'possible_stress';
        severity = 'moderate';
        interpretation =
          'NDWI shows a moderate decrease or negative optical moisture ratio; cross-check against field topsoil moisture and NASA SMAP rather than assuming root-zone drought.';
        rules.push('RULE_NDWI_POSSIBLE_DRYING');
      } else {
        rules.push('RULE_NDWI_NOMINAL');
      }

      indicators.push({
        id: 'water_related_spectral',
        title: 'Canopy & Surface Spectral Wetness (HLS NDWI)',
        status,
        severity,
        directObservations: directObs,
        derivedIndicators: derived,
        agronomicInterpretation: interpretation,
        prohibitedInferenceGuardrail:
          'Satellite optical NDWI reflects leaf/surface wetness only; it does NOT directly measure root-zone soil moisture (m³/m³).',
        observationDates: obsDates.length > 0 ? obsDates : latestNdwi.observationTimestamp ? [latestNdwi.observationTimestamp.slice(0, 10)] : [],
        supportingRuleIds: rules,
      });
    }

    // 3. Thermal Evaporative Stress (ECOSTRESS ESI + ET 70 m)
    const latestEsi = latestValidMetrics.esiRatio;
    const latestEt = latestValidMetrics.etDailyWm2;
    const ecoCoverageOk =
      (latestEsi.coveragePercent === null || latestEsi.coveragePercent >= this.thresholds.minCoveragePercent) &&
      (latestEt.coveragePercent === null || latestEt.coveragePercent >= this.thresholds.minCoveragePercent);

    if (
      (latestEsi.value === null && latestEt.value === null) ||
      !ecostress.available ||
      ecostress.usableScenesCount === 0
    ) {
      indicators.push({
        id: 'evaporative_stress',
        title: 'Thermal Evaporative Stress (ECOSTRESS ESI & ET)',
        status: 'inconclusive',
        severity: 'unknown',
        directObservations: ['No valid clear-sky ECOSTRESS ET or ESI observations available.'],
        derivedIndicators: [],
        agronomicInterpretation:
          'Plant evaporative water stress cannot be evaluated without clear-sky 70 m ECOSTRESS thermal observations.',
        prohibitedInferenceGuardrail:
          'ECOSTRESS daily ET is reported in W/m² thermal energy flux; NEVER prescribe irrigation water depth (mm) directly from ET W/m² alone.',
        observationDates: [],
        supportingRuleIds: ['RULE_ECO_INSUFFICIENT'],
      });
    } else {
      const directObs: string[] = [];
      const derived: string[] = [];
      const rules: string[] = [];
      const dateSet = new Set<string>();

      if (latestEsi.value !== null && latestEsi.observationTimestamp) {
        directObs.push(
          `Latest clear-sky ECOSTRESS ESI: ${latestEsi.value.toFixed(3)} (${latestEsi.observationTimestamp.slice(0, 10)}).`,
        );
        dateSet.add(latestEsi.observationTimestamp.slice(0, 10));
      }
      if (latestEt.value !== null && latestEt.observationTimestamp) {
        directObs.push(
          `Latest clear-sky ECOSTRESS Daily ET: ${latestEt.value.toFixed(1)} W/m² (${latestEt.observationTimestamp.slice(0, 10)}).`,
        );
        dateSet.add(latestEt.observationTimestamp.slice(0, 10));
      }

      const esiDelta = esiSeries.stepChanges.at(-1);
      const etDelta = etSeries.stepChanges.at(-1);
      if (esiDelta) {
        derived.push(
          `ESI change (${esiDelta.fromDate} → ${esiDelta.toDate}): ${esiDelta.deltaValue >= 0 ? '+' : ''}${esiDelta.deltaValue.toFixed(3)}.`,
        );
      }
      if (etDelta) {
        derived.push(
          `ET daily flux change (${etDelta.fromDate} → ${etDelta.toDate}): ${etDelta.deltaValue >= 0 ? '+' : ''}${etDelta.deltaValue.toFixed(1)} W/m²${etDelta.percentChange !== null ? ` (${etDelta.percentChange}%)` : ''}.`,
        );
      }

      const lowEsi = latestEsi.value !== null && latestEsi.value < this.thresholds.esiStressThreshold;
      const moderateEsi =
        latestEsi.value !== null &&
        latestEsi.value >= this.thresholds.esiStressThreshold &&
        latestEsi.value < this.thresholds.esiModerateThreshold;
      const sharpEtDrop =
        etDelta?.percentChange !== null &&
        etDelta?.percentChange !== undefined &&
        etDelta.percentChange <= this.thresholds.etSharpDropPercent;

      let status: StressSignalStatus = 'nominal';
      let severity: 'high' | 'moderate' | 'low' | 'unknown' = 'low';
      let interpretation =
        'ECOSTRESS thermal ratio indicates actual evapotranspiration is keeping pace with atmospheric demand.';

      if (!ecoCoverageOk || latestEsi.isStale || latestEt.isStale) {
        status = lowEsi || sharpEtDrop ? 'possible_stress' : 'inconclusive';
        severity = lowEsi || sharpEtDrop ? 'moderate' : 'unknown';
        interpretation =
          'ECOSTRESS indicates potential evaporative restriction, but overpass staleness or partial polygon coverage reduces certainty.';
        rules.push('RULE_ECO_DEGRADED_CONTEXT');
      } else if (lowEsi) {
        status = 'observed_concern';
        severity = 'high';
        interpretation = `ECOSTRESS ESI (${latestEsi.value?.toFixed(3)}) is below the ${this.thresholds.esiStressThreshold.toFixed(2)} stress threshold, signaling actual latent heat flux is substantially below potential demand — consistent with stomatal closure or thermal moisture limitation.`;
        rules.push('RULE_ECO_LOW_ESI');
      } else if (moderateEsi || sharpEtDrop) {
        status = 'possible_stress';
        severity = 'moderate';
        interpretation =
          'Moderate ESI reduction or sharp ET decline observed; verify afternoon canopy temperature, wind/cloud conditions on overpass day, and irrigation timing.';
        rules.push('RULE_ECO_MODERATE_OR_DROP');
      } else {
        rules.push('RULE_ECO_NOMINAL');
      }

      indicators.push({
        id: 'evaporative_stress',
        title: 'Thermal Evaporative Stress (ECOSTRESS ESI & ET)',
        status,
        severity,
        directObservations: directObs,
        derivedIndicators: derived,
        agronomicInterpretation: interpretation,
        prohibitedInferenceGuardrail:
          'ECOSTRESS ET (W/m²) measures radiative/latent heat flux at overpass and is NOT directly convertible to mm/day irrigation dosage without local meteorological calibration.',
        observationDates: Array.from(dateSet).sort(),
        supportingRuleIds: rules,
      });
    }

    // 4. Unusual Environmental Change (Abrupt Valid Step Shifts)
    const abruptEvents: string[] = [];
    const abruptDates = new Set<string>();
    const ndviJump = ndviSeries.stepChanges.find(
      (s) => Math.abs(s.deltaValue) >= 0.2 && s.elapsedDays <= 21,
    );
    const esiJump = esiSeries.stepChanges.find(
      (s) => Math.abs(s.deltaValue) >= 0.25 && s.elapsedDays <= 21,
    );
    if (ndviJump) {
      abruptEvents.push(
        `Abrupt NDVI shift of ${ndviJump.deltaValue >= 0 ? '+' : ''}${ndviJump.deltaValue.toFixed(3)} in ${ndviJump.elapsedDays} days (${ndviJump.fromDate} → ${ndviJump.toDate}).`,
      );
      abruptDates.add(ndviJump.fromDate);
      abruptDates.add(ndviJump.toDate);
    }
    if (esiJump) {
      abruptEvents.push(
        `Abrupt ECOSTRESS ESI shift of ${esiJump.deltaValue >= 0 ? '+' : ''}${esiJump.deltaValue.toFixed(3)} in ${esiJump.elapsedDays} days (${esiJump.fromDate} → ${esiJump.toDate}).`,
      );
      abruptDates.add(esiJump.fromDate);
      abruptDates.add(esiJump.toDate);
    }

    const totalMultiObsSeries = [ndviSeries, ndwiSeries, etSeries, esiSeries].filter(
      (s) => s.validObservationCount >= 2,
    ).length;

    if (totalMultiObsSeries === 0) {
      indicators.push({
        id: 'unusual_environmental_change',
        title: 'Unusual Multi-Temporal Shift Detection',
        status: 'inconclusive',
        severity: 'unknown',
        directObservations: ['Fewer than 2 valid clear-sky scenes available in any metric series.'],
        derivedIndicators: [],
        agronomicInterpretation:
          'Abrupt change detection requires at least two comparable valid scenes separated in time.',
        prohibitedInferenceGuardrail:
          'Single-date observations cannot distinguish sudden change from static baseline cover.',
        observationDates: [],
        supportingRuleIds: ['RULE_CHANGE_INSUFFICIENT'],
      });
    } else if (abruptEvents.length > 0) {
      indicators.push({
        id: 'unusual_environmental_change',
        title: 'Unusual Multi-Temporal Shift Detection',
        status: 'possible_stress',
        severity: 'moderate',
        directObservations: abruptEvents,
        derivedIndicators: [
          'Change exceeds rapid step-shift threshold (|ΔNDVI| ≥ 0.20 or |ΔESI| ≥ 0.25 within ≤ 21 days).',
        ],
        agronomicInterpretation:
          'Rapid transition detected across consecutive valid scenes. Possible causes include harvesting, field preparation, sudden moisture stress, irrigation event, or unflagged haze/sensor transition.',
        prohibitedInferenceGuardrail:
          'Do not equate an abrupt spectral/thermal shift with crop failure or disease without checking field management logs (harvest/tillage/irrigation).',
        observationDates: Array.from(abruptDates).sort(),
        supportingRuleIds: ['RULE_CHANGE_ABRUPT_SHIFT'],
      });
    } else {
      indicators.push({
        id: 'unusual_environmental_change',
        title: 'Unusual Multi-Temporal Shift Detection',
        status: 'nominal',
        severity: 'low',
        directObservations: ['Consecutive valid observations show gradual or stable transitions.'],
        derivedIndicators: [],
        agronomicInterpretation: 'No abrupt anomalies detected between comparable clear-sky acquisitions.',
        prohibitedInferenceGuardrail:
          'Long orbital revisit gaps can hide short-lived weather shocks occurring between clear-sky scenes.',
        observationDates: [],
        supportingRuleIds: ['RULE_CHANGE_NOMINAL'],
      });
    }

    return {
      evaluatedAt: new Date(nowMs).toISOString(),
      overallStatus: summarizeOverallStatus(indicators),
      indicators,
      activeConcernCount: indicators.filter((i) => i.status === 'observed_concern').length,
      possibleStressCount: indicators.filter((i) => i.status === 'possible_stress').length,
      inconclusiveCount: indicators.filter((i) => i.status === 'inconclusive').length,
      diagnosticDisclaimer:
        'Satellite stress indicators highlight optical and thermal signals from NASA HLS (30 m) and ECOSTRESS (70 m). They are screening evidence only — they never diagnose plant pathogens, pests, or nutrient deficiencies, and optical NDWI does not measure root-zone soil moisture.',
    };
  }
}
