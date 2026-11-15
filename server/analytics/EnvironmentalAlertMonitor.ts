import type {
  EnvironmentalConfidenceAssessment,
  EnvironmentalDataQualityReport,
  EnvironmentalMonitoringReport,
  EnvironmentalStressReport,
  MonitoringAlert,
  MonitoringThresholdsConfig,
  MultiTemporalAnalysisReport,
} from '../../shared/index.ts';
import { DEFAULT_MONITORING_THRESHOLDS } from './EnvironmentalStressDetector.ts';

export const PHASE4_ANALYTICS_ENGINE_VERSION = '4.0.0-deterministic';

export class EnvironmentalAlertMonitor {
  private readonly thresholds: MonitoringThresholdsConfig;

  constructor(thresholds?: Partial<MonitoringThresholdsConfig>) {
    this.thresholds = {
      ...DEFAULT_MONITORING_THRESHOLDS,
      ...(thresholds ?? {}),
    };
  }

  public evaluate(params: {
    qualityReport: EnvironmentalDataQualityReport;
    temporalAnalysis: MultiTemporalAnalysisReport;
    stressReport: EnvironmentalStressReport;
    confidenceAssessment: EnvironmentalConfidenceAssessment;
    referenceNowMs?: number;
  }): EnvironmentalMonitoringReport {
    const nowMs = params.referenceNowMs ?? Date.now();
    const { qualityReport, temporalAnalysis, stressReport, confidenceAssessment } = params;

    const rawAlerts: MonitoringAlert[] = [];
    let suppressedInvalidOrInsufficientCount = 0;

    // 1. Track masked/invalid scenes strictly as non-stress suppressions
    suppressedInvalidOrInsufficientCount +=
      qualityReport.ecostress.cloudMaskedCount +
      qualityReport.ecostress.waterMaskedCount +
      qualityReport.ecostress.invalidScenesCount +
      qualityReport.hls.cloudMaskedCount +
      qualityReport.hls.shadowMaskedCount +
      qualityReport.hls.waterMaskedCount +
      qualityReport.hls.invalidScenesCount;

    // 2. Convert validated stress indicators into farmer alerts ONLY when valid data supports them
    const ndviSeries = temporalAnalysis.series.ndvi;
    const ndwiSeries = temporalAnalysis.series.ndwi;
    const esiSeries = temporalAnalysis.series.esiRatio;
    const latestNdvi = qualityReport.latestValidMetrics.ndvi;
    const latestNdwi = qualityReport.latestValidMetrics.ndwi;
    const latestEsi = qualityReport.latestValidMetrics.esiRatio;
    const latestEt = qualityReport.latestValidMetrics.etDailyWm2;

    const vegIndicator = stressReport.indicators.find((i) => i.id === 'vegetation_condition');
    if (
      vegIndicator &&
      (vegIndicator.status === 'observed_concern' || vegIndicator.status === 'possible_stress') &&
      latestNdvi.value !== null &&
      latestNdvi.observationTimestamp &&
      !latestNdvi.isStale
    ) {
      const latestStep = ndviSeries.stepChanges.at(-1);
      const isConfirmedDecline = vegIndicator.status === 'observed_concern';
      rawAlerts.push({
        id: `alert-ndvi-${latestNdvi.observationTimestamp.slice(0, 10)}`,
        dedupeKey: `vegetation_decline:${latestNdvi.observationTimestamp.slice(0, 10)}`,
        category: 'vegetation_decline',
        severity: vegIndicator.severity === 'high' ? 'critical' : 'warning',
        claimType: isConfirmedDecline ? 'confirmed_observation' : 'possible_risk',
        title: isConfirmedDecline
          ? 'Observed Canopy Greenness Decline (HLS NDVI)'
          : 'Low Canopy Greenness Detected (HLS NDVI)',
        farmerExplanation: isConfirmedDecline
          ? `Satellite reflectance shows your field's greenness (NDVI) dropped recently. Please inspect crop stand vigor, weeding, or recent harvest changes on the ground before deciding field action.`
          : `Observed NDVI (${latestNdvi.value.toFixed(2)}) is currently low (< ${this.thresholds.lowNdviThreshold.toFixed(2)}). This can occur in early emergence, sparse stands, or fallow stages — verify crop growth stage in the field.`,
        metricEvidence: latestStep
          ? `Latest NDVI ${latestNdvi.value.toFixed(3)} on ${latestNdvi.observationTimestamp.slice(0, 10)} (Δ ${latestStep.deltaValue >= 0 ? '+' : ''}${latestStep.deltaValue.toFixed(3)} from ${latestStep.fromDate}).`
          : `Latest NDVI ${latestNdvi.value.toFixed(3)} on ${latestNdvi.observationTimestamp.slice(0, 10)}.`,
        observationDates: vegIndicator.observationDates,
        sources: ['NASA Landsat/HLS (30 m)'],
        recommendedVerification:
          'Walk representative field zones to check leaf vigor, plant density, and recent field operations rather than assuming a crop disease.',
      });
    } else if (vegIndicator && (vegIndicator.status === 'observed_concern' || vegIndicator.status === 'possible_stress')) {
      suppressedInvalidOrInsufficientCount += 1;
    }

    const ndwiIndicator = stressReport.indicators.find((i) => i.id === 'water_related_spectral');
    if (
      ndwiIndicator &&
      (ndwiIndicator.status === 'observed_concern' || ndwiIndicator.status === 'possible_stress') &&
      latestNdwi.value !== null &&
      latestNdwi.observationTimestamp &&
      !latestNdwi.isStale
    ) {
      const latestStep = ndwiSeries.stepChanges.at(-1);
      rawAlerts.push({
        id: `alert-ndwi-${latestNdwi.observationTimestamp.slice(0, 10)}`,
        dedupeKey: `water_spectral_stress:${latestNdwi.observationTimestamp.slice(0, 10)}`,
        category: 'water_spectral_stress',
        severity: ndwiIndicator.severity === 'high' ? 'warning' : 'advisory',
        claimType: ndwiIndicator.status === 'observed_concern' ? 'confirmed_observation' : 'possible_risk',
        title: 'Potential Canopy Surface Drying Signal (HLS NDWI)',
        farmerExplanation:
          'Satellite canopy water index (NDWI) is low or declining, indicating drier upper leaves or surface reflectance. Because optical NDWI does not measure deep root-zone soil moisture, check root-zone soil moisture manually or consult NASA SMAP before scheduling irrigation.',
        metricEvidence: latestStep
          ? `Latest NDWI ${latestNdwi.value.toFixed(3)} on ${latestNdwi.observationTimestamp.slice(0, 10)} (Δ ${latestStep.deltaValue >= 0 ? '+' : ''}${latestStep.deltaValue.toFixed(3)} from ${latestStep.fromDate}).`
          : `Latest NDWI ${latestNdwi.value.toFixed(3)} on ${latestNdwi.observationTimestamp.slice(0, 10)}.`,
        observationDates: ndwiIndicator.observationDates,
        sources: ['NASA Landsat/HLS (30 m)'],
        recommendedVerification:
          'Check soil moisture at 15 cm root depth and compare with NASA SMAP & recent NASA POWER rainfall.',
      });
    } else if (ndwiIndicator && (ndwiIndicator.status === 'observed_concern' || ndwiIndicator.status === 'possible_stress')) {
      suppressedInvalidOrInsufficientCount += 1;
    }

    const ecoIndicator = stressReport.indicators.find((i) => i.id === 'evaporative_stress');
    if (
      ecoIndicator &&
      (ecoIndicator.status === 'observed_concern' || ecoIndicator.status === 'possible_stress') &&
      ((latestEsi.value !== null && !latestEsi.isStale) || (latestEt.value !== null && !latestEt.isStale))
    ) {
      const esiStep = esiSeries.stepChanges.at(-1);
      const primaryDate =
        latestEsi.observationTimestamp?.slice(0, 10) ??
        latestEt.observationTimestamp?.slice(0, 10) ??
        'unknown';
      const isConfirmedEsiStress = ecoIndicator.status === 'observed_concern';
      rawAlerts.push({
        id: `alert-esi-${primaryDate}`,
        dedupeKey: `evaporative_stress:${primaryDate}`,
        category: 'evaporative_stress',
        severity: ecoIndicator.severity === 'high' ? 'critical' : 'warning',
        claimType: isConfirmedEsiStress ? 'confirmed_observation' : 'possible_risk',
        title: isConfirmedEsiStress
          ? 'High Evaporative Stress Observed (ECOSTRESS ESI)'
          : 'Moderate Thermal / Evaporative Stress Signal (ECOSTRESS)',
        farmerExplanation: isConfirmedEsiStress
          ? `Thermal satellite readings show crop water evaporation is well below potential demand (ESI < ${this.thresholds.esiStressThreshold.toFixed(2)}), a potential sign of heat or moisture stress. Check afternoon leaf wilting and soil moisture before deciding irrigation.`
          : 'ECOSTRESS indicates a moderate reduction in actual-to-potential evapotranspiration. Inspect crop moisture status during warm afternoon hours.',
        metricEvidence: [
          latestEsi.value !== null
            ? `ESI ${latestEsi.value.toFixed(3)} (${latestEsi.observationTimestamp?.slice(0, 10) ?? 'N/A'})`
            : null,
          latestEt.value !== null
            ? `ET ${latestEt.value.toFixed(1)} W/m² (${latestEt.observationTimestamp?.slice(0, 10) ?? 'N/A'})`
            : null,
          esiStep
            ? `ESI delta ${esiStep.deltaValue >= 0 ? '+' : ''}${esiStep.deltaValue.toFixed(3)}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        observationDates: ecoIndicator.observationDates,
        sources: ['NASA ECOSTRESS (70 m thermal grid)'],
        recommendedVerification:
          'Verify root-zone moisture on-site and review irrigation timing with local KVK/agronomy guidance (ET W/m² is energy flux, not irrigation volume).',
      });
    } else if (ecoIndicator && (ecoIndicator.status === 'observed_concern' || ecoIndicator.status === 'possible_stress')) {
      suppressedInvalidOrInsufficientCount += 1;
    }

    const changeIndicator = stressReport.indicators.find((i) => i.id === 'unusual_environmental_change');
    if (changeIndicator && changeIndicator.status === 'possible_stress') {
      const latestDate = changeIndicator.observationDates.at(-1) ?? 'window';
      rawAlerts.push({
        id: `alert-change-${latestDate}`,
        dedupeKey: `abrupt_change:${latestDate}`,
        category: 'abrupt_change',
        severity: 'advisory',
        claimType: 'possible_risk',
        title: 'Abrupt Environmental Shift Between Consecutive Scenes',
        farmerExplanation:
          'A sudden step change appeared between two recent clear-sky satellite scenes. Confirm whether harvesting, sowing, ploughing, or irrigation occurred between those dates.',
        metricEvidence: changeIndicator.directObservations.join(' '),
        observationDates: changeIndicator.observationDates,
        sources: ['NASA Landsat/HLS & ECOSTRESS'],
        recommendedVerification: 'Cross-check recent field management activities between the listed acquisition dates.',
      });
    }

    // 3. Emit Data Quality Limitations Notice when confidence is degraded/low/insufficient
    if (
      confidenceAssessment.confidenceLevel === 'low' ||
      confidenceAssessment.confidenceLevel === 'insufficient' ||
      qualityReport.latestValidMetrics.ndvi.isStale ||
      qualityReport.latestValidMetrics.etDailyWm2.isStale
    ) {
      const latestValidDates = [
        qualityReport.latestValidMetrics.etDailyWm2.observationTimestamp?.slice(0, 10),
        qualityReport.latestValidMetrics.esiRatio.observationTimestamp?.slice(0, 10),
        qualityReport.latestValidMetrics.ndvi.observationTimestamp?.slice(0, 10),
        qualityReport.latestValidMetrics.ndwi.observationTimestamp?.slice(0, 10),
      ].filter((d): d is string => Boolean(d));

      rawAlerts.push({
        id: `alert-quality-${confidenceAssessment.confidenceLevel}`,
        dedupeKey: `data_quality_limitation:${confidenceAssessment.confidenceLevel}`,
        category: 'data_quality_limitation',
        severity: 'info',
        claimType: 'data_quality_notice',
        title:
          confidenceAssessment.confidenceLevel === 'insufficient'
            ? 'Monitoring Limited: No Valid Clear-Sky Satellite Scenes'
            : 'Satellite Monitoring Confidence Limited',
        farmerExplanation:
          confidenceAssessment.confidenceLevel === 'insufficient'
            ? 'Cloud cover, masking, or missing passes prevented valid ECOSTRESS or HLS measurements for this window. Stress alerts are withheld so masked clouds never cause false alarms.'
            : `Environmental confidence is ${confidenceAssessment.confidenceLevel} because: ${confidenceAssessment.degradationReasons.slice(0, 2).join(' ')}`,
        metricEvidence: `ECOSTRESS usable: ${qualityReport.ecostress.usableScenesCount}/${qualityReport.ecostress.totalScenes}, HLS usable: ${qualityReport.hls.usableScenesCount}/${qualityReport.hls.totalScenes}, Confidence score: ${confidenceAssessment.confidenceScore0To100}/100.`,
        observationDates: Array.from(new Set(latestValidDates)).sort(),
        sources: ['FieldShift Phase 4 Quality Validator'],
        recommendedVerification:
          'Widen the date range window to capture newer cloud-free satellite passes and rely on direct field inspection in the meantime.',
      });
    }

    // 4. Deduplicate strictly by dedupeKey
    const seenKeys = new Set<string>();
    const alerts: MonitoringAlert[] = [];
    let deduplicatedCount = 0;

    for (const alert of rawAlerts) {
      if (seenKeys.has(alert.dedupeKey)) {
        deduplicatedCount += 1;
        continue;
      }
      seenKeys.add(alert.dedupeKey);
      alerts.push(alert);
    }

    return {
      evaluatedAt: new Date(nowMs).toISOString(),
      appliedThresholds: this.thresholds,
      alerts,
      suppressedInvalidOrInsufficientCount,
      deduplicatedCount,
      summaryNote:
        alerts.length === 0
          ? 'All validated clear-sky satellite observations fall within normal monitoring thresholds with no active stress warnings.'
          : `${alerts.length} active monitoring notice(s) generated from validated observations; invalid, masked, and insufficient readings cannot trigger stress alerts.`,
    };
  }
}
