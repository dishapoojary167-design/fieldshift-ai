import type {
  EcostressEvapotranspirationObservation,
  EcostressProductId,
  EcostressResultPayload,
  EnvironmentalDataQualityReport,
  HlsProductId,
  HlsResultPayload,
  HlsSurfaceReflectanceObservation,
  LatestValidatedMetricSnapshot,
  MissionDataQualityReport,
  ObservationValidationIssue,
  QualityGrade,
  SceneQualityAudit,
} from '../../shared/index.ts';

export interface DataQualityValidationOptions {
  staleDaysThreshold?: number;
  minCoveragePercentThreshold?: number;
  referenceNowMs?: number;
}

export const DEFAULT_STALE_DAYS_THRESHOLD = 45;
export const DEFAULT_MIN_COVERAGE_PERCENT = 50;

const VALID_ECOSTRESS_PRODUCTS = new Set<string>(['ECO_L3T_JET.002', 'ECO_L4T_ESI.002']);
const VALID_HLS_PRODUCTS = new Set<string>(['HLSL30.002', 'HLSS30.002']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFillNumericValue(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
    return true;
  }
  return value === -999 || value === -9999 || value <= -900;
}

function validateMetricValue(
  rawValue: number | null | undefined,
  min: number,
  max: number,
  metric: 'etDailyWm2' | 'esiRatio' | 'ndvi' | 'ndwi',
  mission: 'ecostress' | 'hls',
  productId: string,
  observationTimestamp: string,
  issues: ObservationValidationIssue[],
): { valid: boolean; value: number | null; isGenuineZero: boolean } {
  if (rawValue === null || rawValue === undefined) {
    return { valid: false, value: null, isGenuineZero: false };
  }
  if (!Number.isFinite(rawValue) || rawValue === -999 || rawValue === -9999 || rawValue <= -900) {
    issues.push({
      mission,
      productId,
      observationTimestamp,
      severity: 'warning',
      code: 'FILL_VALUE_REJECTED',
      metric,
      message: `${metric} contained fill or non-finite value (${String(rawValue)}) and was excluded.`,
    });
    return { valid: false, value: null, isGenuineZero: false };
  }
  if (rawValue < min || rawValue > max) {
    issues.push({
      mission,
      productId,
      observationTimestamp,
      severity: 'error',
      code: 'OUT_OF_PHYSICAL_BOUNDS',
      metric,
      message: `${metric} value (${rawValue}) is outside valid physical bounds [${min}, ${max}] and was rejected.`,
    });
    return { valid: false, value: null, isGenuineZero: false };
  }
  const isGenuineZero = rawValue === 0;
  if (isGenuineZero) {
    issues.push({
      mission,
      productId,
      observationTimestamp,
      severity: 'info',
      code: 'GENUINE_ZERO_PRESERVED',
      metric,
      message: `${metric} measured exactly 0 within valid bounds; preserved as a genuine zero measurement.`,
    });
  }
  return { valid: true, value: rawValue, isGenuineZero };
}

function validateSceneTimestamps(
  mission: 'ecostress' | 'hls',
  productId: string,
  obsTimestamp: string,
  retTimestamp: string,
  explicitStale: boolean,
  referenceNowMs: number,
  staleDaysThreshold: number,
  issues: ObservationValidationIssue[],
): { validTimestamp: boolean; isStale: boolean; ageDays: number | null } {
  const obsMs = Date.parse(obsTimestamp);
  if (!obsTimestamp || !Number.isFinite(obsMs)) {
    issues.push({
      mission,
      productId,
      observationTimestamp: obsTimestamp || 'unknown',
      severity: 'error',
      code: 'INVALID_TIMESTAMP',
      metric: 'timestamp',
      message: `Observation acquisition timestamp "${obsTimestamp}" is not a valid ISO date.`,
    });
    return { validTimestamp: false, isStale: explicitStale, ageDays: null };
  }

  if (obsMs > referenceNowMs + 86_400_000) {
    issues.push({
      mission,
      productId,
      observationTimestamp: obsTimestamp,
      severity: 'error',
      code: 'FUTURE_TIMESTAMP',
      metric: 'timestamp',
      message: `Acquisition timestamp ${obsTimestamp} is in the future relative to evaluation time.`,
    });
    return { validTimestamp: false, isStale: false, ageDays: null };
  }

  const retMs = Date.parse(retTimestamp);
  if (retTimestamp && Number.isFinite(retMs) && retMs < obsMs - 60_000) {
    issues.push({
      mission,
      productId,
      observationTimestamp: obsTimestamp,
      severity: 'warning',
      code: 'RETRIEVAL_BEFORE_ACQUISITION',
      metric: 'timestamp',
      message: `Retrieval timestamp (${retTimestamp}) precedes acquisition timestamp (${obsTimestamp}).`,
    });
  }

  const ageDays = Math.max(0, Math.floor((referenceNowMs - obsMs) / 86_400_000));
  const isStale = explicitStale || ageDays > staleDaysThreshold;
  if (isStale) {
    issues.push({
      mission,
      productId,
      observationTimestamp: obsTimestamp,
      severity: 'warning',
      code: 'STALE_OBSERVATION',
      metric: 'timestamp',
      message: `Scene acquired ${obsTimestamp.slice(0, 10)} is ${ageDays} days old (> ${staleDaysThreshold}-day freshness threshold).`,
    });
  }

  return { validTimestamp: true, isStale, ageDays };
}

function validateSpatialCoverage(
  mission: 'ecostress' | 'hls',
  productId: string,
  obsTimestamp: string,
  coveragePercent: number | null,
  validPixelCount: number | null,
  intersectingPixelCount: number | null,
  minCoverageThreshold: number,
  issues: ObservationValidationIssue[],
): { hasValidSpatialMetadata: boolean; isLowCoverage: boolean } {
  let valid = true;
  let isLowCoverage = false;

  if (
    isFiniteNumber(validPixelCount) &&
    isFiniteNumber(intersectingPixelCount) &&
    (validPixelCount < 0 || intersectingPixelCount < 0 || validPixelCount > intersectingPixelCount)
  ) {
    valid = false;
    issues.push({
      mission,
      productId,
      observationTimestamp: obsTimestamp,
      severity: 'error',
      code: 'INVALID_PIXEL_COUNT_RATIO',
      metric: 'coveragePercent',
      message: `Valid pixel count (${validPixelCount}) cannot exceed intersecting pixel count (${intersectingPixelCount}).`,
    });
  }

  if (isFiniteNumber(coveragePercent)) {
    if (coveragePercent < 0 || coveragePercent > 100) {
      valid = false;
      issues.push({
        mission,
        productId,
        observationTimestamp: obsTimestamp,
        severity: 'error',
        code: 'OUT_OF_PHYSICAL_BOUNDS',
        metric: 'coveragePercent',
        message: `Spatial coverage percentage (${coveragePercent}%) is outside [0, 100].`,
      });
    } else if (coveragePercent === 0) {
      valid = false;
      isLowCoverage = true;
      issues.push({
        mission,
        productId,
        observationTimestamp: obsTimestamp,
        severity: 'warning',
        code: 'ZERO_COVERAGE',
        metric: 'coveragePercent',
        message: `Scene has 0% valid unmasked spatial coverage over the parcel and is excluded.`,
      });
    } else if (coveragePercent < minCoverageThreshold) {
      isLowCoverage = true;
      issues.push({
        mission,
        productId,
        observationTimestamp: obsTimestamp,
        severity: 'warning',
        code: 'LOW_COVERAGE',
        metric: 'coveragePercent',
        message: `Parcel valid spatial coverage is ${coveragePercent.toFixed(1)}% (< ${minCoverageThreshold}% threshold); representativeness is reduced.`,
      });
    } else if (coveragePercent < 75) {
      issues.push({
        mission,
        productId,
        observationTimestamp: obsTimestamp,
        severity: 'info',
        code: 'MODERATE_COVERAGE',
        metric: 'coveragePercent',
        message: `Partial valid pixel coverage (${coveragePercent.toFixed(1)}%).`,
      });
    }
  }

  return { hasValidSpatialMetadata: valid, isLowCoverage };
}

function gradeFromScore(available: boolean, score: number, usableScenesCount: number): QualityGrade {
  if (!available) return 'unavailable';
  if (usableScenesCount === 0) return 'poor';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  if (score >= 35) return 'degraded';
  return 'poor';
}

export class EnvironmentalDataQualityValidator {
  private readonly staleDaysThreshold: number;
  private readonly minCoveragePercentThreshold: number;

  constructor(options?: DataQualityValidationOptions) {
    this.staleDaysThreshold = options?.staleDaysThreshold ?? DEFAULT_STALE_DAYS_THRESHOLD;
    this.minCoveragePercentThreshold =
      options?.minCoveragePercentThreshold ?? DEFAULT_MIN_COVERAGE_PERCENT;
  }

  public validateEcostress(
    payload: EcostressResultPayload | null | undefined,
    referenceNowMs = Date.now(),
  ): {
    report: MissionDataQualityReport;
    usableEtScenes: EcostressEvapotranspirationObservation[];
    usableEsiScenes: EcostressEvapotranspirationObservation[];
    latestEtSnapshot: LatestValidatedMetricSnapshot;
    latestEsiSnapshot: LatestValidatedMetricSnapshot;
    genuineZeroCount: number;
  } {
    const emptyLatestEt: LatestValidatedMetricSnapshot = {
      metric: 'etDailyWm2',
      value: null,
      unit: 'W/m²',
      productId: null,
      observationTimestamp: null,
      retrievalTimestamp: payload?.retrievedAt ?? null,
      coveragePercent: null,
      validPixelCount: null,
      cloudMaskFlag: null,
      shadowMaskFlag: null,
      waterMaskFlag: null,
      isStale: false,
      ageDays: null,
      spatialResolutionMeters: payload ? 70 : null,
    };
    const emptyLatestEsi: LatestValidatedMetricSnapshot = {
      ...emptyLatestEt,
      metric: 'esiRatio',
      unit: 'Ratio (0–1)',
    };

    if (!payload) {
      return {
        report: {
          mission: 'ecostress',
          available: false,
          grade: 'unavailable',
          score0To100: 0,
          totalScenes: 0,
          usableScenesCount: 0,
          cloudMaskedCount: 0,
          shadowMaskedCount: 0,
          waterMaskedCount: 0,
          staleScenesCount: 0,
          invalidScenesCount: 0,
          lowCoverageScenesCount: 0,
          meanCoveragePercent: null,
          expectedResolutionMeters: 70,
          resolutionVerified: false,
          productMetadataVerified: false,
          attributionPreserved: false,
          sourceName: null,
          daac: null,
          productVersions: [],
          issues: [],
          scenes: [],
        },
        usableEtScenes: [],
        usableEsiScenes: [],
        latestEtSnapshot: emptyLatestEt,
        latestEsiSnapshot: emptyLatestEsi,
        genuineZeroCount: 0,
      };
    }

    const products = Array.isArray(payload.products) ? payload.products : [];
    const missionIssues: ObservationValidationIssue[] = [];
    const resolutionVerified = payload.spatialResolution?.value === 70;
    if (payload.spatialResolution && !resolutionVerified) {
      missionIssues.push({
        mission: 'ecostress',
        productId: products.join(','),
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'RESOLUTION_MISMATCH',
        message: `Expected ECOSTRESS 70m spatial resolution metadata, found ${payload.spatialResolution?.value ?? 'missing'} ${payload.spatialResolution?.unit ?? ''}.`,
      });
    }

    const productMetadataVerified =
      products.length > 0 && products.every((p) => VALID_ECOSTRESS_PRODUCTS.has(p));
    if (products.length > 0 && !productMetadataVerified) {
      missionIssues.push({
        mission: 'ecostress',
        productId: products.join(',') || 'unknown',
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'UNKNOWN_PRODUCT_METADATA',
        message: `Unexpected ECOSTRESS product identifiers: ${products.join(', ') || 'none'}.`,
      });
    }

    const attributionPreserved = Boolean(
      payload.sourceAttribution?.providerName &&
        payload.sourceAttribution?.daac === 'LP DAAC' &&
        (payload.sourceAttribution?.productVersions?.length ?? 0) > 0,
    );
    if (payload.sourceAttribution && !attributionPreserved) {
      missionIssues.push({
        mission: 'ecostress',
        productId: products.join(','),
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'MISSING_ATTRIBUTION',
        message: 'NASA LP DAAC ECOSTRESS attribution or product version metadata is incomplete.',
      });
    }

    const sortedObs = [...payload.observations].sort((a, b) =>
      a.observationTimestamp.localeCompare(b.observationTimestamp),
    );

    const sceneAudits: SceneQualityAudit[] = [];
    const usableEtScenes: EcostressEvapotranspirationObservation[] = [];
    const usableEsiScenes: EcostressEvapotranspirationObservation[] = [];
    const coverages: number[] = [];

    let cloudMaskedCount = 0;
    let waterMaskedCount = 0;
    let staleScenesCount = 0;
    let invalidScenesCount = 0;
    let lowCoverageScenesCount = 0;
    let genuineZeroCount = 0;

    for (const obs of sortedObs) {
      const issues: ObservationValidationIssue[] = [];
      const sceneProduct = obs.productId ?? products[0] ?? 'ECO_L3T_JET.002';
      const ts = validateSceneTimestamps(
        'ecostress',
        sceneProduct,
        obs.observationTimestamp,
        obs.retrievalTimestamp ?? payload.retrievedAt ?? '',
        Boolean(obs.isStale),
        referenceNowMs,
        this.staleDaysThreshold,
        issues,
      );
      if (ts.isStale) staleScenesCount += 1;

      const sp = validateSpatialCoverage(
        'ecostress',
        sceneProduct,
        obs.observationTimestamp,
        obs.coveragePercent ?? null,
        obs.validPixelCount ?? null,
        obs.intersectingPixelCount ?? null,
        this.minCoveragePercentThreshold,
        issues,
      );
      if (sp.isLowCoverage) lowCoverageScenesCount += 1;
      if (isFiniteNumber(obs.coveragePercent) && obs.coveragePercent >= 0 && obs.coveragePercent <= 100) {
        coverages.push(obs.coveragePercent);
      }

      if (
        (obs.productId && !VALID_ECOSTRESS_PRODUCTS.has(obs.productId)) ||
        (obs.spatialResolutionMeters !== undefined && obs.spatialResolutionMeters !== 70)
      ) {
        issues.push({
          mission: 'ecostress',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'warning',
          code: 'RESOLUTION_MISMATCH',
          message: `Scene product=${sceneProduct}, resolution=${obs.spatialResolutionMeters ?? 'unknown'}m deviates from expected ECOSTRESS Collection 2 70m spec.`,
        });
      }

      const isCloudMasked = obs.cloudMaskFlag === 1 || obs.qualityStatus === 'cloud_masked';
      const isWaterMasked = obs.waterMaskFlag === 1 || obs.qualityStatus === 'water_masked';
      const isInvalidOrMissing =
        obs.qualityStatus === 'invalid_data' || obs.qualityStatus === 'missing_data';

      if (isCloudMasked) {
        cloudMaskedCount += 1;
        issues.push({
          mission: 'ecostress',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'CLOUD_MASKED',
          message: `ECOSTRESS scene is cloud masked (cloudMaskFlag=${obs.cloudMaskFlag ?? 'N/A'}) and excluded from quantitative values.`,
        });
      }
      if (isWaterMasked) {
        waterMaskedCount += 1;
        issues.push({
          mission: 'ecostress',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'WATER_MASKED',
          message: `ECOSTRESS scene is water masked and excluded from agricultural crop stress evaluation.`,
        });
      }
      if (obs.cloudMaskFlag === null || obs.cloudMaskFlag === undefined) {
        issues.push({
          mission: 'ecostress',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'MISSING_CLOUD_MASK_FLAG',
          message: 'ECOSTRESS cloudMaskFlag is null/absent; preserved as null rather than coerced to clear sky (0).',
        });
      }

      const etCheck = validateMetricValue(
        obs.etDailyWm2,
        0,
        1500,
        'etDailyWm2',
        'ecostress',
        sceneProduct,
        obs.observationTimestamp,
        issues,
      );
      const esiCheck = validateMetricValue(
        obs.esiRatio,
        0,
        1,
        'esiRatio',
        'ecostress',
        sceneProduct,
        obs.observationTimestamp,
        issues,
      );

      const genuineZeroMetrics: Array<'etDailyWm2' | 'esiRatio'> = [];
      if (etCheck.isGenuineZero && !isCloudMasked && !isWaterMasked && !isInvalidOrMissing) {
        genuineZeroMetrics.push('etDailyWm2');
        genuineZeroCount += 1;
      }
      if (esiCheck.isGenuineZero && !isCloudMasked && !isWaterMasked && !isInvalidOrMissing) {
        genuineZeroMetrics.push('esiRatio');
        genuineZeroCount += 1;
      }

      const gatePassed =
        ts.validTimestamp &&
        sp.hasValidSpatialMetadata &&
        !isCloudMasked &&
        !isWaterMasked &&
        !isInvalidOrMissing;

      const usableForEt = gatePassed && etCheck.valid;
      const usableForEsi = gatePassed && esiCheck.valid;

      if (!usableForEt && !usableForEsi && !isCloudMasked && !isWaterMasked) {
        invalidScenesCount += 1;
      }

      if (usableForEt) usableEtScenes.push(obs);
      if (usableForEsi) usableEsiScenes.push(obs);

      missionIssues.push(...issues);
      sceneAudits.push({
        mission: 'ecostress',
        productId: sceneProduct,
        observationTimestamp: obs.observationTimestamp,
        retrievalTimestamp: obs.retrievalTimestamp ?? payload.retrievedAt ?? '',
        usableForEt,
        usableForEsi,
        usableForNdvi: false,
        usableForNdwi: false,
        hasValidTimestamp: ts.validTimestamp,
        hasValidSpatialMetadata: sp.hasValidSpatialMetadata,
        isStale: ts.isStale,
        ageDays: ts.ageDays,
        coveragePercent: obs.coveragePercent ?? null,
        validPixelCount: obs.validPixelCount ?? null,
        intersectingPixelCount: obs.intersectingPixelCount ?? null,
        cloudMaskFlag: obs.cloudMaskFlag ?? null,
        shadowMaskFlag: null,
        waterMaskFlag: obs.waterMaskFlag ?? null,
        qualityStatus: obs.qualityStatus ?? 'unknown',
        genuineZeroMetrics,
        issues,
      });
    }

    const usableAnyCount = sceneAudits.filter((s) => s.usableForEt || s.usableForEsi).length;
    const meanCoveragePercent =
      coverages.length > 0
        ? Number((coverages.reduce((a, b) => a + b, 0) / coverages.length).toFixed(1))
        : (payload.summary?.meanCoveragePercent ?? null);

    // Transparent mission quality score (0-100)
    let score = 0;
    if (sortedObs.length > 0 && usableAnyCount > 0) {
      const usableRatio = usableAnyCount / sortedObs.length;
      const covScore = meanCoveragePercent !== null ? Math.min(1, meanCoveragePercent / 100) : 0.7;
      const staleRatio = staleScenesCount / sortedObs.length;
      score = Math.round(
        50 * usableRatio +
          30 * covScore +
          10 * (1 - staleRatio) +
          (resolutionVerified ? 5 : 0) +
          (attributionPreserved ? 5 : 0),
      );
      if (lowCoverageScenesCount > 0 && usableAnyCount === lowCoverageScenesCount) {
        score = Math.min(score, 62);
      }
    }

    const latestEtObs = usableEtScenes.at(-1) ?? null;
    const latestEsiObs = usableEsiScenes.at(-1) ?? null;
    const latestEtAudit = latestEtObs
      ? sceneAudits.find(
          (s) =>
            s.observationTimestamp === latestEtObs.observationTimestamp &&
            s.productId === latestEtObs.productId,
        )
      : null;
    const latestEsiAudit = latestEsiObs
      ? sceneAudits.find(
          (s) =>
            s.observationTimestamp === latestEsiObs.observationTimestamp &&
            s.productId === latestEsiObs.productId,
        )
      : null;

    const latestEtSnapshot: LatestValidatedMetricSnapshot = latestEtObs
      ? {
          metric: 'etDailyWm2',
          value: latestEtObs.etDailyWm2,
          unit: 'W/m²',
          productId: latestEtObs.productId ?? products[0] ?? 'ECO_L3T_JET.002',
          observationTimestamp: latestEtObs.observationTimestamp,
          retrievalTimestamp: latestEtObs.retrievalTimestamp ?? payload.retrievedAt ?? null,
          coveragePercent: latestEtObs.coveragePercent ?? null,
          validPixelCount: latestEtObs.validPixelCount ?? null,
          cloudMaskFlag: latestEtObs.cloudMaskFlag ?? null,
          shadowMaskFlag: null,
          waterMaskFlag: latestEtObs.waterMaskFlag ?? null,
          isStale: latestEtAudit?.isStale ?? Boolean(latestEtObs.isStale),
          ageDays: latestEtAudit?.ageDays ?? null,
          spatialResolutionMeters: latestEtObs.spatialResolutionMeters ?? 70,
        }
      : emptyLatestEt;

    const latestEsiSnapshot: LatestValidatedMetricSnapshot = latestEsiObs
      ? {
          metric: 'esiRatio',
          value: latestEsiObs.esiRatio,
          unit: 'Ratio (0–1)',
          productId: latestEsiObs.productId ?? products[0] ?? 'ECO_L4T_ESI.002',
          observationTimestamp: latestEsiObs.observationTimestamp,
          retrievalTimestamp: latestEsiObs.retrievalTimestamp ?? payload.retrievedAt ?? null,
          coveragePercent: latestEsiObs.coveragePercent ?? null,
          validPixelCount: latestEsiObs.validPixelCount ?? null,
          cloudMaskFlag: latestEsiObs.cloudMaskFlag ?? null,
          shadowMaskFlag: null,
          waterMaskFlag: latestEsiObs.waterMaskFlag ?? null,
          isStale: latestEsiAudit?.isStale ?? Boolean(latestEsiObs.isStale),
          ageDays: latestEsiAudit?.ageDays ?? null,
          spatialResolutionMeters: latestEsiObs.spatialResolutionMeters ?? 70,
        }
      : emptyLatestEsi;

    return {
      report: {
        mission: 'ecostress',
        available: true,
        grade: gradeFromScore(true, score, usableAnyCount),
        score0To100: score,
        totalScenes: sortedObs.length,
        usableScenesCount: usableAnyCount,
        cloudMaskedCount,
        shadowMaskedCount: 0,
        waterMaskedCount,
        staleScenesCount,
        invalidScenesCount,
        lowCoverageScenesCount,
        meanCoveragePercent,
        expectedResolutionMeters: 70,
        resolutionVerified,
        productMetadataVerified,
        attributionPreserved,
        sourceName: payload.sourceAttribution?.providerName ?? null,
        daac: payload.sourceAttribution?.daac ?? null,
        productVersions: payload.sourceAttribution?.productVersions ?? [],
        issues: missionIssues,
        scenes: sceneAudits,
      },
      usableEtScenes,
      usableEsiScenes,
      latestEtSnapshot,
      latestEsiSnapshot,
      genuineZeroCount,
    };
  }

  public validateHls(
    payload: HlsResultPayload | null | undefined,
    referenceNowMs = Date.now(),
  ): {
    report: MissionDataQualityReport;
    usableNdviScenes: HlsSurfaceReflectanceObservation[];
    usableNdwiScenes: HlsSurfaceReflectanceObservation[];
    latestNdviSnapshot: LatestValidatedMetricSnapshot;
    latestNdwiSnapshot: LatestValidatedMetricSnapshot;
    genuineZeroCount: number;
  } {
    const emptyLatestNdvi: LatestValidatedMetricSnapshot = {
      metric: 'ndvi',
      value: null,
      unit: 'Ratio (-1 to 1)',
      productId: null,
      observationTimestamp: null,
      retrievalTimestamp: payload?.retrievedAt ?? null,
      coveragePercent: null,
      validPixelCount: null,
      cloudMaskFlag: null,
      shadowMaskFlag: null,
      waterMaskFlag: null,
      isStale: false,
      ageDays: null,
      spatialResolutionMeters: payload ? 30 : null,
    };
    const emptyLatestNdwi: LatestValidatedMetricSnapshot = {
      ...emptyLatestNdvi,
      metric: 'ndwi',
    };

    if (!payload) {
      return {
        report: {
          mission: 'hls',
          available: false,
          grade: 'unavailable',
          score0To100: 0,
          totalScenes: 0,
          usableScenesCount: 0,
          cloudMaskedCount: 0,
          shadowMaskedCount: 0,
          waterMaskedCount: 0,
          staleScenesCount: 0,
          invalidScenesCount: 0,
          lowCoverageScenesCount: 0,
          meanCoveragePercent: null,
          expectedResolutionMeters: 30,
          resolutionVerified: false,
          productMetadataVerified: false,
          attributionPreserved: false,
          sourceName: null,
          daac: null,
          productVersions: [],
          issues: [],
          scenes: [],
        },
        usableNdviScenes: [],
        usableNdwiScenes: [],
        latestNdviSnapshot: emptyLatestNdvi,
        latestNdwiSnapshot: emptyLatestNdwi,
        genuineZeroCount: 0,
      };
    }

    const hlsProducts = Array.isArray(payload.products) ? payload.products : [];
    const missionIssues: ObservationValidationIssue[] = [];
    const resolutionVerified = payload.spatialResolution?.value === 30;
    if (payload.spatialResolution && !resolutionVerified) {
      missionIssues.push({
        mission: 'hls',
        productId: hlsProducts.join(','),
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'RESOLUTION_MISMATCH',
        message: `Expected HLS 30m spatial resolution metadata, found ${payload.spatialResolution?.value ?? 'missing'} ${payload.spatialResolution?.unit ?? ''}.`,
      });
    }

    const productMetadataVerified =
      hlsProducts.length > 0 && hlsProducts.every((p) => VALID_HLS_PRODUCTS.has(p));
    if (hlsProducts.length > 0 && !productMetadataVerified) {
      missionIssues.push({
        mission: 'hls',
        productId: hlsProducts.join(',') || 'unknown',
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'UNKNOWN_PRODUCT_METADATA',
        message: `Unexpected HLS product identifiers: ${hlsProducts.join(', ') || 'none'}.`,
      });
    }

    const attributionPreserved = Boolean(
      payload.sourceAttribution?.providerName &&
        payload.sourceAttribution?.daac === 'LP DAAC' &&
        (payload.sourceAttribution?.productVersions?.length ?? 0) > 0,
    );
    if (payload.sourceAttribution && !attributionPreserved) {
      missionIssues.push({
        mission: 'hls',
        productId: hlsProducts.join(','),
        observationTimestamp: payload.retrievedAt ?? new Date(referenceNowMs).toISOString(),
        severity: 'warning',
        code: 'MISSING_ATTRIBUTION',
        message: 'NASA LP DAAC HLS attribution or product version metadata is incomplete.',
      });
    }

    const sortedObs = [...payload.observations].sort((a, b) =>
      a.observationTimestamp.localeCompare(b.observationTimestamp),
    );

    const sceneAudits: SceneQualityAudit[] = [];
    const usableNdviScenes: HlsSurfaceReflectanceObservation[] = [];
    const usableNdwiScenes: HlsSurfaceReflectanceObservation[] = [];
    const coverages: number[] = [];

    let cloudMaskedCount = 0;
    let shadowMaskedCount = 0;
    let waterMaskedCount = 0;
    let staleScenesCount = 0;
    let invalidScenesCount = 0;
    let lowCoverageScenesCount = 0;
    let genuineZeroCount = 0;

    for (const obs of sortedObs) {
      const issues: ObservationValidationIssue[] = [];
      const sceneProduct = obs.productId ?? hlsProducts[0] ?? 'HLSL30.002';
      const ts = validateSceneTimestamps(
        'hls',
        sceneProduct,
        obs.observationTimestamp,
        obs.retrievalTimestamp ?? payload.retrievedAt ?? '',
        Boolean(obs.isStale),
        referenceNowMs,
        this.staleDaysThreshold,
        issues,
      );
      if (ts.isStale) staleScenesCount += 1;

      const sp = validateSpatialCoverage(
        'hls',
        sceneProduct,
        obs.observationTimestamp,
        obs.coveragePercent ?? null,
        obs.validPixelCount ?? null,
        obs.intersectingPixelCount ?? null,
        this.minCoveragePercentThreshold,
        issues,
      );
      if (sp.isLowCoverage) lowCoverageScenesCount += 1;
      if (isFiniteNumber(obs.coveragePercent) && obs.coveragePercent >= 0 && obs.coveragePercent <= 100) {
        coverages.push(obs.coveragePercent);
      }

      if (
        (obs.productId && !VALID_HLS_PRODUCTS.has(obs.productId)) ||
        (obs.spatialResolutionMeters !== undefined && obs.spatialResolutionMeters !== 30)
      ) {
        issues.push({
          mission: 'hls',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'warning',
          code: 'RESOLUTION_MISMATCH',
          message: `Scene product=${sceneProduct}, resolution=${obs.spatialResolutionMeters ?? 'unknown'}m deviates from expected HLS Collection 2 30m spec.`,
        });
      }

      const isCloudMasked = obs.cloudMaskFlag === 1 || obs.qualityStatus === 'cloud_masked';
      const isShadowMasked = obs.shadowMaskFlag === 1 || obs.qualityStatus === 'shadow_masked';
      const isWaterMasked = obs.waterMaskFlag === 1 || obs.qualityStatus === 'water_masked';
      const isInvalidOrMissing =
        obs.qualityStatus === 'invalid_data' || obs.qualityStatus === 'missing_data';

      if (isCloudMasked) {
        cloudMaskedCount += 1;
        issues.push({
          mission: 'hls',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'CLOUD_MASKED',
          message: `HLS scene Fmask indicated cloud contamination (cloudMaskFlag=${obs.cloudMaskFlag ?? 'N/A'}) and was excluded.`,
        });
      }
      if (isShadowMasked) {
        shadowMaskedCount += 1;
        issues.push({
          mission: 'hls',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'SHADOW_MASKED',
          message: `HLS scene Fmask indicated cloud shadow contamination (shadowMaskFlag=${obs.shadowMaskFlag ?? 'N/A'}) and was excluded.`,
        });
      }
      if (isWaterMasked) {
        waterMaskedCount += 1;
        issues.push({
          mission: 'hls',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'WATER_MASKED',
          message: `HLS scene Fmask indicated water/snow/ice mask and was excluded.`,
        });
      }
      if (obs.cloudMaskFlag === null || obs.cloudMaskFlag === undefined) {
        issues.push({
          mission: 'hls',
          productId: sceneProduct,
          observationTimestamp: obs.observationTimestamp,
          severity: 'info',
          code: 'MISSING_CLOUD_MASK_FLAG',
          message: 'HLS cloudMaskFlag is null/absent; preserved as null rather than coerced to clear sky (0).',
        });
      }

      const ndviCheck = validateMetricValue(
        obs.ndvi,
        -1,
        1,
        'ndvi',
        'hls',
        sceneProduct,
        obs.observationTimestamp,
        issues,
      );
      const ndwiCheck = validateMetricValue(
        obs.ndwi,
        -1,
        1,
        'ndwi',
        'hls',
        sceneProduct,
        obs.observationTimestamp,
        issues,
      );

      const genuineZeroMetrics: Array<'ndvi' | 'ndwi'> = [];
      if (ndviCheck.isGenuineZero && !isCloudMasked && !isShadowMasked && !isWaterMasked && !isInvalidOrMissing) {
        genuineZeroMetrics.push('ndvi');
        genuineZeroCount += 1;
      }
      if (ndwiCheck.isGenuineZero && !isCloudMasked && !isShadowMasked && !isWaterMasked && !isInvalidOrMissing) {
        genuineZeroMetrics.push('ndwi');
        genuineZeroCount += 1;
      }

      const gatePassed =
        ts.validTimestamp &&
        sp.hasValidSpatialMetadata &&
        !isCloudMasked &&
        !isShadowMasked &&
        !isWaterMasked &&
        !isInvalidOrMissing;

      const usableForNdvi = gatePassed && ndviCheck.valid;
      const usableForNdwi = gatePassed && ndwiCheck.valid;

      if (!usableForNdvi && !usableForNdwi && !isCloudMasked && !isShadowMasked && !isWaterMasked) {
        invalidScenesCount += 1;
      }

      if (usableForNdvi) usableNdviScenes.push(obs);
      if (usableForNdwi) usableNdwiScenes.push(obs);

      missionIssues.push(...issues);
      sceneAudits.push({
        mission: 'hls',
        productId: sceneProduct,
        observationTimestamp: obs.observationTimestamp,
        retrievalTimestamp: obs.retrievalTimestamp ?? payload.retrievedAt ?? '',
        usableForEt: false,
        usableForEsi: false,
        usableForNdvi,
        usableForNdwi,
        hasValidTimestamp: ts.validTimestamp,
        hasValidSpatialMetadata: sp.hasValidSpatialMetadata,
        isStale: ts.isStale,
        ageDays: ts.ageDays,
        coveragePercent: obs.coveragePercent ?? null,
        validPixelCount: obs.validPixelCount ?? null,
        intersectingPixelCount: obs.intersectingPixelCount ?? null,
        cloudMaskFlag: obs.cloudMaskFlag ?? null,
        shadowMaskFlag: obs.shadowMaskFlag ?? null,
        waterMaskFlag: obs.waterMaskFlag ?? null,
        qualityStatus: obs.qualityStatus ?? 'unknown',
        genuineZeroMetrics,
        issues,
      });
    }

    const usableAnyCount = sceneAudits.filter((s) => s.usableForNdvi || s.usableForNdwi).length;
    const meanCoveragePercent =
      coverages.length > 0
        ? Number((coverages.reduce((a, b) => a + b, 0) / coverages.length).toFixed(1))
        : (payload.summary?.meanCoveragePercent ?? null);

    let score = 0;
    if (sortedObs.length > 0 && usableAnyCount > 0) {
      const usableRatio = usableAnyCount / sortedObs.length;
      const covScore = meanCoveragePercent !== null ? Math.min(1, meanCoveragePercent / 100) : 0.7;
      const staleRatio = staleScenesCount / sortedObs.length;
      score = Math.round(
        50 * usableRatio +
          30 * covScore +
          10 * (1 - staleRatio) +
          (resolutionVerified ? 5 : 0) +
          (attributionPreserved ? 5 : 0),
      );
      if (lowCoverageScenesCount > 0 && usableAnyCount === lowCoverageScenesCount) {
        score = Math.min(score, 62);
      }
    }

    const latestNdviObs = usableNdviScenes.at(-1) ?? null;
    const latestNdwiObs = usableNdwiScenes.at(-1) ?? null;
    const latestNdviAudit = latestNdviObs
      ? sceneAudits.find(
          (s) =>
            s.observationTimestamp === latestNdviObs.observationTimestamp &&
            s.productId === latestNdviObs.productId,
        )
      : null;
    const latestNdwiAudit = latestNdwiObs
      ? sceneAudits.find(
          (s) =>
            s.observationTimestamp === latestNdwiObs.observationTimestamp &&
            s.productId === latestNdwiObs.productId,
        )
      : null;

    const latestNdviSnapshot: LatestValidatedMetricSnapshot = latestNdviObs
      ? {
          metric: 'ndvi',
          value: latestNdviObs.ndvi,
          unit: 'Ratio (-1 to 1)',
          productId: latestNdviObs.productId ?? hlsProducts[0] ?? 'HLSL30.002',
          observationTimestamp: latestNdviObs.observationTimestamp,
          retrievalTimestamp: latestNdviObs.retrievalTimestamp ?? payload.retrievedAt ?? null,
          coveragePercent: latestNdviObs.coveragePercent ?? null,
          validPixelCount: latestNdviObs.validPixelCount ?? null,
          cloudMaskFlag: latestNdviObs.cloudMaskFlag ?? null,
          shadowMaskFlag: latestNdviObs.shadowMaskFlag ?? null,
          waterMaskFlag: latestNdviObs.waterMaskFlag ?? null,
          isStale: latestNdviAudit?.isStale ?? Boolean(latestNdviObs.isStale),
          ageDays: latestNdviAudit?.ageDays ?? null,
          spatialResolutionMeters: latestNdviObs.spatialResolutionMeters ?? 30,
        }
      : emptyLatestNdvi;

    const latestNdwiSnapshot: LatestValidatedMetricSnapshot = latestNdwiObs
      ? {
          metric: 'ndwi',
          value: latestNdwiObs.ndwi,
          unit: 'Ratio (-1 to 1)',
          productId: latestNdwiObs.productId ?? hlsProducts[0] ?? 'HLSL30.002',
          observationTimestamp: latestNdwiObs.observationTimestamp,
          retrievalTimestamp: latestNdwiObs.retrievalTimestamp ?? payload.retrievedAt ?? null,
          coveragePercent: latestNdwiObs.coveragePercent ?? null,
          validPixelCount: latestNdwiObs.validPixelCount ?? null,
          cloudMaskFlag: latestNdwiObs.cloudMaskFlag ?? null,
          shadowMaskFlag: latestNdwiObs.shadowMaskFlag ?? null,
          waterMaskFlag: latestNdwiObs.waterMaskFlag ?? null,
          isStale: latestNdwiAudit?.isStale ?? Boolean(latestNdwiObs.isStale),
          ageDays: latestNdwiAudit?.ageDays ?? null,
          spatialResolutionMeters: latestNdwiObs.spatialResolutionMeters ?? 30,
        }
      : emptyLatestNdwi;

    return {
      report: {
        mission: 'hls',
        available: true,
        grade: gradeFromScore(true, score, usableAnyCount),
        score0To100: score,
        totalScenes: sortedObs.length,
        usableScenesCount: usableAnyCount,
        cloudMaskedCount,
        shadowMaskedCount,
        waterMaskedCount,
        staleScenesCount,
        invalidScenesCount,
        lowCoverageScenesCount,
        meanCoveragePercent,
        expectedResolutionMeters: 30,
        resolutionVerified,
        productMetadataVerified,
        attributionPreserved,
        sourceName: payload.sourceAttribution?.providerName ?? null,
        daac: payload.sourceAttribution?.daac ?? null,
        productVersions: payload.sourceAttribution?.productVersions ?? [],
        issues: missionIssues,
        scenes: sceneAudits,
      },
      usableNdviScenes,
      usableNdwiScenes,
      latestNdviSnapshot,
      latestNdwiSnapshot,
      genuineZeroCount,
    };
  }

  public validateAll(
    ecostressPayload: EcostressResultPayload | null | undefined,
    hlsPayload: HlsResultPayload | null | undefined,
    referenceNowMs = Date.now(),
  ): {
    qualityReport: EnvironmentalDataQualityReport;
    usableEtScenes: EcostressEvapotranspirationObservation[];
    usableEsiScenes: EcostressEvapotranspirationObservation[];
    usableNdviScenes: HlsSurfaceReflectanceObservation[];
    usableNdwiScenes: HlsSurfaceReflectanceObservation[];
  } {
    const eco = this.validateEcostress(ecostressPayload, referenceNowMs);
    const hls = this.validateHls(hlsPayload, referenceNowMs);

    const availableReports = [eco.report, hls.report].filter((r) => r.available);
    const overallScore0To100 =
      availableReports.length > 0
        ? Math.round(
            availableReports.reduce((sum, r) => sum + r.score0To100, 0) / availableReports.length,
          )
        : 0;
    const totalUsable = eco.report.usableScenesCount + hls.report.usableScenesCount;
    const overallGrade =
      availableReports.length === 0
        ? 'unavailable'
        : gradeFromScore(true, overallScore0To100, totalUsable);

    const allIssues = [...eco.report.issues, ...hls.report.issues];
    const criticalIssues = allIssues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.mission.toUpperCase()} (${i.observationTimestamp.slice(0, 10)}): ${i.message}`);

    const caveats: string[] = [
      'Cloud-masked, shadow-masked, water-masked, out-of-range, and 0%-coverage scenes are strictly excluded rather than gap-filled.',
      'Valid zero measurements (e.g., 0 W/m² ET or 0.0 index ratio) are preserved distinctly from missing or fill values.',
      'Missing quality flags (null) remain unknown rather than coerced to clear sky (0).',
    ];
    if (eco.report.staleScenesCount > 0 || hls.report.staleScenesCount > 0) {
      caveats.push(
        `One or more usable scenes exceed the ${this.staleDaysThreshold}-day freshness window and may not reflect present canopy conditions.`,
      );
    }

    return {
      qualityReport: {
        evaluatedAt: new Date(referenceNowMs).toISOString(),
        staleDaysThreshold: this.staleDaysThreshold,
        minCoveragePercentThreshold: this.minCoveragePercentThreshold,
        overallGrade,
        overallScore0To100,
        ecostress: eco.report,
        hls: hls.report,
        latestValidMetrics: {
          etDailyWm2: eco.latestEtSnapshot,
          esiRatio: eco.latestEsiSnapshot,
          ndvi: hls.latestNdviSnapshot,
          ndwi: hls.latestNdwiSnapshot,
        },
        genuineZeroObservationsCount: eco.genuineZeroCount + hls.genuineZeroCount,
        totalIssuesCount: allIssues.length,
        criticalIssues,
        caveats,
      },
      usableEtScenes: eco.usableEtScenes,
      usableEsiScenes: eco.usableEsiScenes,
      usableNdviScenes: hls.usableNdviScenes,
      usableNdwiScenes: hls.usableNdwiScenes,
    };
  }
}

export function isFillValueCheck(value: number | null | undefined): boolean {
  return isFillNumericValue(value);
}

export function normalizeProductsList(
  eco: EcostressResultPayload | null | undefined,
  hls: HlsResultPayload | null | undefined,
): { ecostressProducts: EcostressProductId[]; hlsProducts: HlsProductId[] } {
  return {
    ecostressProducts: eco?.products ?? [],
    hlsProducts: hls?.products ?? [],
  };
}
