import type {
  ActionRecommendationsReport,
  FarmActionRecommendation,
  FarmObservedConditionsSnapshot,
  Phase4EnvironmentalAnalytics,
  PredictiveInsightsReport,
} from '../../shared/index.ts';

const PROHIBITED_PRESCRIPTION_GUARDRAIL =
  'Advisory screening guidance only — does NOT issue exact irrigation water volume/mm prescriptions, pump automation commands, chemical/fertilizer dosages, or plant disease diagnoses.';

function toActionConfidence(
  level: Phase4EnvironmentalAnalytics['confidenceAssessment']['confidenceLevel'],
): 'high' | 'moderate' | 'low' {
  if (level === 'high') return 'high';
  if (level === 'moderate') return 'moderate';
  return 'low';
}

export class ActionRecommendationEngine {
  public generate(params: {
    analytics: Phase4EnvironmentalAnalytics;
    predictions: PredictiveInsightsReport;
    observedConditions: FarmObservedConditionsSnapshot;
    referenceNowMs?: number;
  }): ActionRecommendationsReport {
    const nowIso = new Date(params.referenceNowMs ?? Date.now()).toISOString();
    const { analytics, predictions, observedConditions } = params;
    const { qualityReport, stressReport, confidenceAssessment } = analytics;
    const actionConf = toActionConfidence(confidenceAssessment.confidenceLevel);

    const recommendations: FarmActionRecommendation[] = [];
    let suppressedCount = 0;

    const esiInd = stressReport.indicators.find((i) => i.id === 'evaporative_stress');
    const vegInd = stressReport.indicators.find((i) => i.id === 'vegetation_condition');
    const ndwiInd = stressReport.indicators.find((i) => i.id === 'water_related_spectral');
    const abruptInd = stressReport.indicators.find((i) => i.id === 'unusual_environmental_change');

    // 1. Thermal Evaporative Stress + Moisture Cross-Check (5C irrigation verification without prescribing mm/L)
    if (
      esiInd &&
      (esiInd.status === 'observed_concern' || esiInd.status === 'possible_stress') &&
      observedConditions.latestEsiRatio !== null
    ) {
      const dates = [
        observedConditions.latestEsiDate?.slice(0, 10),
        observedConditions.smapObservationDate?.slice(0, 10),
      ].filter((d): d is string => Boolean(d));

      const smapText =
        observedConditions.smapRootZoneMoistureM3M3 !== null
          ? `SMAP root-zone moisture: ${observedConditions.smapRootZoneMoistureM3M3.toFixed(3)} m³/m³`
          : 'SMAP root-zone moisture unavailable';

      recommendations.push({
        id: 'act-irrigation-verification-esi',
        category: 'irrigation_verification',
        priority: esiInd.status === 'observed_concern' ? 'high' : 'moderate',
        claimType: 'actionable_recommendation',
        title: 'Inspect Canopy Water Stress & Root-Zone Moisture Before Irrigation Scheduling',
        reason:
          'NASA ECOSTRESS Evaporative Stress Index indicates elevated thermal stress relative to potential atmospheric demand.',
        evidence: `ECOSTRESS ESI = ${observedConditions.latestEsiRatio.toFixed(3)} (${observedConditions.latestEtWm2 !== null ? `ET = ${observedConditions.latestEtWm2.toFixed(1)} W/m², ` : ''}70 m thermal grid); ${smapText}.`,
        observationDates: dates.length > 0 ? dates : esiInd.observationDates,
        sources: [
          'NASA ECOSTRESS (ECO_L4T_ESI.002, 70 m)',
          ...(observedConditions.smapRootZoneMoistureM3M3 !== null ? ['NASA SMAP L4 Soil Moisture'] : []),
        ],
        confidence: actionConf,
        limitations:
          'ECOSTRESS thermal ET (W/m²) and ESI do not measure actual applied irrigation volume, root depth, or subsurface water availability.',
        nextVerificationStep:
          'Check soil moisture manually at 15–20 cm root depth across 3 representative spots in your field and review local irrigation schedule guidance with your KVK/agronomist.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    } else if (esiInd && esiInd.status === 'inconclusive') {
      suppressedCount += 1;
    }

    // 2. Vegetation Canopy Decline / Field Scouting
    if (
      vegInd &&
      (vegInd.status === 'observed_concern' || vegInd.status === 'possible_stress') &&
      observedConditions.latestNdvi !== null
    ) {
      recommendations.push({
        id: 'act-field-scouting-ndvi',
        category: 'field_scouting',
        priority: vegInd.status === 'observed_concern' ? 'high' : 'moderate',
        claimType: 'actionable_recommendation',
        title: 'Conduct Ground Stand & Canopy Vigor Scouting',
        reason:
          'Landsat/HLS 30 m NDVI detected reduced greenness or a declining canopy trend across clear-sky passes.',
        evidence: `Latest NDVI = ${observedConditions.latestNdvi.toFixed(3)}${predictions.insights.ndvi.projectionEligible ? ` (projected 14d range: ${predictions.insights.ndvi.projections[1]?.lowerBound}–${predictions.insights.ndvi.projections[1]?.upperBound})` : ''}.`,
        observationDates:
          observedConditions.latestNdviDate
            ? [observedConditions.latestNdviDate.slice(0, 10)]
            : vegInd.observationDates,
        sources: ['NASA Landsat/HLS (HLSL30/HLSS30, 30 m)'],
        confidence: actionConf,
        limitations:
          'Optical NDVI captures green leaf cover only; it cannot diagnose crop diseases, pests, weeds, or specific nutrient deficiencies, nor distinguish stress from planned harvest/tillage.',
        nextVerificationStep:
          'Walk field transects (edges and interior) to inspect crop emergence uniformity, weed pressure, or recent management operations before taking corrective action.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    } else if (vegInd && vegInd.status === 'inconclusive') {
      suppressedCount += 1;
    }

    // 3. Spectral Wetness (NDWI) Cross-Verification without Soil-Moisture Confusion
    if (
      ndwiInd &&
      (ndwiInd.status === 'observed_concern' || ndwiInd.status === 'possible_stress') &&
      observedConditions.latestNdwi !== null
    ) {
      recommendations.push({
        id: 'act-ndwi-smap-crosscheck',
        category: 'irrigation_verification',
        priority: 'moderate',
        claimType: 'actionable_recommendation',
        title: 'Verify Subsurface Soil Moisture Independently of Leaf Wetness (NDWI)',
        reason:
          'Optical NDWI indicates drier upper canopy/surface conditions, which warrants verifying whether root-zone soil moisture is also depleted.',
        evidence: `Latest HLS NDWI = ${observedConditions.latestNdwi.toFixed(3)}; NASA POWER rain = ${observedConditions.weatherTotalPrecipitationMm !== null ? `${observedConditions.weatherTotalPrecipitationMm.toFixed(1)} mm` : 'not loaded'}.`,
        observationDates:
          observedConditions.latestNdwiDate
            ? [observedConditions.latestNdwiDate.slice(0, 10)]
            : ndwiInd.observationDates,
        sources: ['NASA Landsat/HLS (30 m)', 'NASA POWER / SMAP (when loaded)'],
        confidence: actionConf,
        limitations:
          'NDWI reflects foliar/surface spectral wetness only and must NEVER be treated as a direct root-zone soil moisture measurement.',
        nextVerificationStep:
          'Perform a hand-feel or tensiometer check at root zone depth (15 cm) and confirm recent rainfall timing before modifying crop or water management.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    }

    // 4. Abrupt Change / Management Reconciliation
    if (abruptInd && abruptInd.status === 'possible_stress') {
      recommendations.push({
        id: 'act-abrupt-transition-review',
        category: 'crop_management_review',
        priority: 'moderate',
        claimType: 'actionable_recommendation',
        title: 'Reconcile Abrupt Satellite Shift Against Recent Field Operations',
        reason:
          'Successive valid acquisitions registered an abrupt change that may reflect harvesting, tillage, irrigation, or emerging field stress.',
        evidence: abruptInd.directObservations[0] ?? 'Rapid step change observed across scenes.',
        observationDates: abruptInd.observationDates,
        sources: ['Phase 4 Multi-Temporal Analyzer (ECOSTRESS / HLS)'],
        confidence: actionConf,
        limitations:
          'Multi-temporal step changes alone cannot differentiate planned harvest/plowing from weather shock or unflagged atmospheric haze.',
        nextVerificationStep:
          'Log sowing, weeding, irrigation, or harvest dates in your farm records to confirm whether this shift aligns with field activity.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    }

    // 5. Data Collection / Quality Remediation Recommendation when quality or confidence is degraded
    if (
      confidenceAssessment.confidenceLevel === 'insufficient' ||
      confidenceAssessment.confidenceLevel === 'low' ||
      qualityReport.overallGrade === 'degraded' ||
      qualityReport.overallGrade === 'poor'
    ) {
      recommendations.push({
        id: 'act-data-collection-coverage',
        category: 'data_collection',
        priority: confidenceAssessment.confidenceLevel === 'insufficient' ? 'high' : 'moderate',
        claimType: 'actionable_recommendation',
        title: 'Expand Satellite Date Window or Complement with Ground & Lab Measurements',
        reason:
          'Cloud/shadow masking, low polygon coverage, stale acquisitions, or missing missions currently limit automated remote-sensing certainty.',
        evidence: `Quality grade: ${qualityReport.overallGrade} (${qualityReport.overallScore0To100}/100); Confidence: ${confidenceAssessment.confidenceLevel} (${confidenceAssessment.confidenceScore0To100}/100).`,
        observationDates: [],
        sources: ['Phase 4 Data Quality Validator'],
        confidence: actionConf === 'high' ? 'moderate' : actionConf,
        limitations:
          'Masked or low-coverage satellite pixels cannot support automated field stress decisions.',
        nextVerificationStep:
          'Widen the AppEEARS query window to 60–90 days for additional clear-sky overpasses and enter local soil lab test results or rain-gauge notes.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    }

    // 6. Routine Cadence Recommendation when all active conditions are nominal & data is solid
    if (recommendations.length === 0 && confidenceAssessment.confidenceLevel !== 'insufficient') {
      recommendations.push({
        id: 'act-routine-monitoring-cadence',
        category: 'monitoring_cadence',
        priority: 'low',
        claimType: 'actionable_recommendation',
        title: 'Maintain Routine Weekly Satellite & Field Observation Cadence',
        reason:
          'Currently validated ECOSTRESS thermal and HLS reflectance observations do not show active stress concerns.',
        evidence: `Confidence: ${confidenceAssessment.confidenceLevel}; Latest NDVI = ${observedConditions.latestNdvi !== null ? observedConditions.latestNdvi.toFixed(3) : 'N/A'}, ESI = ${observedConditions.latestEsiRatio !== null ? observedConditions.latestEsiRatio.toFixed(3) : 'N/A'}.`,
        observationDates: [
          observedConditions.latestNdviDate?.slice(0, 10),
          observedConditions.latestEsiDate?.slice(0, 10),
        ].filter((d): d is string => Boolean(d)),
        sources: ['NASA ECOSTRESS (70 m)', 'NASA Landsat/HLS (30 m)'],
        confidence: actionConf,
        limitations:
          'Absence of detected satellite stress does not guarantee zero pest, localized drainage, or micro-nutrient issues between overpasses.',
        nextVerificationStep:
          'Refresh satellite observations in 7–10 days and continue routine field walkthroughs at critical crop growth stages.',
        prohibitedActionsGuardrail: PROHIBITED_PRESCRIPTION_GUARDRAIL,
      });
    }

    return {
      generatedAt: nowIso,
      recommendations,
      suppressedGenericOrUnsafeCount: suppressedCount,
      advisoryScopeNote:
        'Recommendations combine validated satellite observations, stress screening rules, and soil/weather context into conservative field verification steps. Consult your nearest KVK or certified agronomist before making consequential input or financial decisions.',
    };
  }
}
