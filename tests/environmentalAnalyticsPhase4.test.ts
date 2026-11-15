import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { runPhase4EnvironmentalAnalytics } from '../server/analytics/index.ts';
import { createApp } from '../server/app.ts';
import { evaluateRotationStrategies, generateRotationStrategies } from '../server/engines/CropRotationEngine.ts';
import { evaluateCropSuitability } from '../server/engines/CropSuitabilityEngine.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import type {
  IEvapotranspirationRepository,
  ISoilRepository,
  IVegetationRepository,
  IWeatherRepository,
} from '../server/repositories/interfaces/index.ts';
import { FarmEnvironmentalContextService } from '../server/services/implementations/FarmEnvironmentalContextService.ts';
import { extractLatestHlsView } from '../client/components/environmental/environmentalUtils.ts';
import type {
  ApiSuccessResponse,
  EcostressEvapotranspirationObservation,
  EcostressResultPayload,
  EnvironmentalAnalyticsResponse,
  HlsResultPayload,
  HlsSurfaceReflectanceObservation,
} from '../shared/index.ts';

const FIXED_NOW_MS = Date.parse('2026-10-15T12:00:00Z');

function buildEcostressObs(
  overrides: Partial<EcostressEvapotranspirationObservation> = {},
): EcostressEvapotranspirationObservation {
  return {
    observationTimestamp: '2026-10-10T10:30:00Z',
    retrievalTimestamp: '2026-10-11T04:00:00Z',
    productId: 'ECO_L3T_JET.002',
    productVersion: '002',
    spatialResolutionMeters: 70,
    spatialAggregation: 'polygon_area_stats',
    etDailyWm2: 265,
    etInstUncertaintyWm2: 18,
    esiRatio: 0.72,
    petWm2: 368,
    ptjplsmInstWm2: 260,
    sticInstWm2: 268,
    mod16InstWm2: 255,
    bessInstWm2: 270,
    canopyTranspirationRatio: 0.62,
    soilEvaporationRatio: 0.3,
    interceptionRatio: 0.08,
    sticCanopyRatio: 0.6,
    cloudMaskFlag: 0,
    waterMaskFlag: 0,
    qualityFiltered: true,
    qualityStatus: 'valid',
    isStale: false,
    validPixelCount: 45,
    intersectingPixelCount: 50,
    coveragePercent: 90,
    parameterUnits: { ETdaily: 'W/m²', ESI: 'Ratio (0–1)' },
    provenance: {
      providerId: 'nasa-appeears-ecostress',
      daac: 'LP DAAC',
      productId: 'ECO_L3T_JET.002',
      productVersion: '002',
      accessMethod: 'NASA AppEEARS API',
    },
    ...overrides,
  };
}

function buildHlsObs(
  overrides: Partial<HlsSurfaceReflectanceObservation> = {},
): HlsSurfaceReflectanceObservation {
  return {
    observationTimestamp: '2026-10-11T05:30:00Z',
    retrievalTimestamp: '2026-10-11T12:00:00Z',
    productId: 'HLSL30.002',
    productVersion: '002',
    spatialResolutionMeters: 30,
    spatialAggregation: 'polygon_area_stats',
    greenReflectance: 0.06,
    redReflectance: 0.05,
    nirReflectance: 0.32,
    swir1Reflectance: 0.19,
    ndvi: 0.64,
    ndwi: 0.18,
    cloudMaskFlag: 0,
    shadowMaskFlag: 0,
    waterMaskFlag: 0,
    qualityFiltered: true,
    qualityStatus: 'valid',
    isStale: false,
    validPixelCount: 190,
    intersectingPixelCount: 200,
    coveragePercent: 95,
    parameterUnits: { NDVI: 'Index Ratio (-1 to 1)', NDWI: 'Index Ratio (-1 to 1)' },
    provenance: {
      providerId: 'nasa-appeears-hls',
      daac: 'LP DAAC',
      productId: 'HLSL30.002',
      productVersion: '002',
      accessMethod: 'NASA AppEEARS API',
    },
    ...overrides,
  };
}

function buildEcostressPayload(
  observations: EcostressEvapotranspirationObservation[],
  overrides: Partial<EcostressResultPayload> = {},
): EcostressResultPayload {
  return {
    jobId: 'eco-phase4-1',
    upstreamTaskId: 'task-eco-1',
    status: 'completed',
    dataClassification: 'satellite_derived_et',
    taskType: 'area',
    products: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
    dateRange: { startDate: '2026-09-01', endDate: '2026-10-12' },
    location: { latitude: 19.076, longitude: 72.877 },
    spatialProcessing: {
      requestedMode: 'polygon',
      appliedMode: 'polygon',
      hasPolygonGeometry: true,
      hasBoundingBox: true,
      note: 'Polygon extraction',
    },
    spatialResolution: { value: 70, unit: 'm', label: '70 m thermal IR grid' },
    units: {
      etDaily: 'W/m²',
      instantaneousEt: 'W/m²',
      etInstUncertainty: 'W/m²',
      pet: 'W/m²',
      esi: 'Ratio (0–1)',
      partitionRatios: 'Ratio (0–1)',
      cloudMask: '0 = Clear, 1 = Cloud',
      waterMask: '0 = Land, 1 = Water',
    },
    observations,
    bundleFiles: [],
    summary: {
      totalObservations: observations.length,
      clearSkyObservations: observations.filter((o) => o.qualityStatus === 'valid').length,
      cloudMaskedObservations: observations.filter((o) => o.qualityStatus === 'cloud_masked').length,
      waterMaskedObservations: observations.filter((o) => o.qualityStatus === 'water_masked').length,
      invalidOrMissingObservations: 0,
      staleObservations: observations.filter((o) => o.isStale).length,
      meanEtDailyWm2: 240,
      latestEtDailyWm2: observations.at(-1)?.etDailyWm2 ?? null,
      meanInstantaneousEtWm2: 245,
      meanEsiRatio: 0.65,
      latestEsiRatio: observations.at(-1)?.esiRatio ?? null,
      meanPetWm2: 360,
      meanCoveragePercent: 88,
    },
    sourceAttribution: {
      providerId: 'nasa-appeears-ecostress',
      providerName: 'NASA AppEEARS ECOSTRESS Collection 2',
      accessMethod: 'NASA AppEEARS API',
      daac: 'LP DAAC',
      productVersions: ['002'],
      datasetNames: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
      url: 'https://appeears.earthdatacloud.nasa.gov/',
      cached: false,
      retrievedAt: '2026-10-12T00:00:00Z',
    },
    caveats: ['ETdaily is latent heat flux in W/m².'],
    retrievedAt: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

function buildHlsPayload(
  observations: HlsSurfaceReflectanceObservation[],
  overrides: Partial<HlsResultPayload> = {},
): HlsResultPayload {
  return {
    jobId: 'hls-phase4-1',
    upstreamTaskId: 'task-hls-1',
    status: 'completed',
    dataClassification: 'satellite_derived_surface_reflectance',
    taskType: 'area',
    products: ['HLSL30.002', 'HLSS30.002'],
    dateRange: { startDate: '2026-09-01', endDate: '2026-10-12' },
    location: { latitude: 19.076, longitude: 72.877 },
    spatialProcessing: {
      requestedMode: 'polygon',
      appliedMode: 'polygon',
      hasPolygonGeometry: true,
      hasBoundingBox: true,
      note: 'Polygon extraction',
    },
    spatialResolution: { value: 30, unit: 'm', label: '30 m harmonized surface reflectance grid' },
    units: {
      reflectance: 'Reflectance Ratio (0–1)',
      indices: 'Index Ratio (-1 to 1)',
      scaleFactor: '0.0001',
      fmask: 'Bitmask (0 = Clear, 1 = Cloud, etc.)',
    },
    observations,
    bundleFiles: [],
    summary: {
      totalObservations: observations.length,
      clearSkyObservations: observations.filter((o) => o.qualityStatus === 'valid').length,
      cloudMaskedObservations: observations.filter((o) => o.qualityStatus === 'cloud_masked').length,
      shadowMaskedObservations: observations.filter((o) => o.qualityStatus === 'shadow_masked').length,
      waterMaskedObservations: observations.filter((o) => o.qualityStatus === 'water_masked').length,
      invalidOrMissingObservations: 0,
      staleObservations: observations.filter((o) => o.isStale).length,
      meanRedReflectance: 0.05,
      meanNirReflectance: 0.31,
      meanNdvi: 0.55,
      minNdvi: 0.25,
      maxNdvi: 0.72,
      latestNdvi: observations.at(-1)?.ndvi ?? null,
      meanNdwi: 0.12,
      latestNdwi: observations.at(-1)?.ndwi ?? null,
      meanCoveragePercent: 90,
    },
    sourceAttribution: {
      providerId: 'nasa-appeears-hls',
      providerName: 'NASA AppEEARS Harmonized Landsat Sentinel-2 v2.0',
      accessMethod: 'NASA AppEEARS API',
      daac: 'LP DAAC',
      productVersions: ['002'],
      datasetNames: ['HLSL30.002', 'HLSS30.002'],
      url: 'https://appeears.earthdatacloud.nasa.gov/',
      cached: false,
      retrievedAt: '2026-10-12T00:00:00Z',
    },
    caveats: ['Surface reflectance NDVI/NDWI filtered by Fmask QA.'],
    retrievedAt: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

describe('Phase 4: Environmental Intelligence Validation & Advanced Analytics (4A–4E)', () => {
  it('4A: preserves genuine zero values, rejects fill/out-of-bounds, flags future/inverted timestamps, missing flags & pixel sanity', () => {
    const eco = buildEcostressPayload([
      // Genuine 0 W/m² ET and 0.0 ESI must be preserved!
      buildEcostressObs({
        observationTimestamp: '2026-10-01T10:00:00Z',
        retrievalTimestamp: '2026-10-02T10:00:00Z',
        etDailyWm2: 0,
        esiRatio: 0,
      }),
      // Fill value -9999 and physically impossible ET 2500 must be rejected
      buildEcostressObs({
        observationTimestamp: '2026-10-05T10:00:00Z',
        retrievalTimestamp: '2026-10-04T10:00:00Z', // retrieval before acquisition!
        etDailyWm2: 2500,
        esiRatio: -9999,
        validPixelCount: 75,
        intersectingPixelCount: 50, // valid > intersecting!
      }),
      // Zero coverage scene must not be selected as latest usable
      buildEcostressObs({
        observationTimestamp: '2026-10-12T10:00:00Z',
        retrievalTimestamp: '2026-10-12T18:00:00Z',
        etDailyWm2: 310,
        esiRatio: 0.85,
        coveragePercent: 0,
      }),
    ]);

    const hls = buildHlsPayload([
      // Phase 3E style qualityFiltered: false on valid clear-sky scene + null cloudMaskFlag must NOT coerce to 0
      buildHlsObs({
        observationTimestamp: '2026-10-08T05:00:00Z',
        retrievalTimestamp: '2026-10-08T12:00:00Z',
        ndvi: 0,
        ndwi: -0.1,
        cloudMaskFlag: null as unknown as 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
      }),
      // Cloud-masked scene at latest timestamp must be excluded
      buildHlsObs({
        observationTimestamp: '2026-10-13T05:00:00Z',
        retrievalTimestamp: '2026-10-13T12:00:00Z',
        ndvi: 0.88,
        ndwi: 0.45,
        cloudMaskFlag: 1,
        qualityFiltered: true,
        qualityStatus: 'cloud_masked',
      }),
    ]);

    const result = runPhase4EnvironmentalAnalytics({
      ecostressPayload: eco,
      hlsPayload: hls,
      referenceNowMs: FIXED_NOW_MS,
    });

    // Latest usable ET & ESI should come from genuine-0 Oct 01 scene, NOT the 0%-coverage Oct 12 scene
    assert.equal(result.qualityReport.latestValidMetrics.etDailyWm2.value, 0);
    assert.equal(result.qualityReport.latestValidMetrics.esiRatio.value, 0);
    assert.equal(result.qualityReport.latestValidMetrics.ndvi.value, 0);
    assert.equal(result.qualityReport.genuineZeroObservationsCount, 3);
    // Missing cloudMaskFlag stays null, not coerced to 0
    assert.equal(result.qualityReport.latestValidMetrics.ndvi.cloudMaskFlag, null);

    // Check validation issue codes recorded
    const allCodes = [
      ...result.qualityReport.ecostress.issues.map((i) => i.code),
      ...result.qualityReport.hls.issues.map((i) => i.code),
    ];
    assert.ok(allCodes.includes('GENUINE_ZERO_PRESERVED'));
    assert.ok(allCodes.includes('FILL_VALUE_REJECTED'));
    assert.ok(allCodes.includes('OUT_OF_PHYSICAL_BOUNDS'));
    assert.ok(allCodes.includes('RETRIEVAL_BEFORE_ACQUISITION'));
    assert.ok(allCodes.includes('INVALID_PIXEL_COUNT_RATIO'));
    assert.ok(allCodes.includes('ZERO_COVERAGE'));
    assert.ok(allCodes.includes('MISSING_CLOUD_MASK_FLAG'));
    assert.ok(allCodes.includes('CLOUD_MASKED'));

    // Frontend extractLatestHlsView also ignores cloud_masked latest and keeps valid qualityFiltered=false test fixture
    const hlsUiView = extractLatestHlsView(hls, FIXED_NOW_MS);
    assert.equal(hlsUiView?.latestNdvi, 0);
    assert.equal(hlsUiView?.ndviAcquisitionDate, '2026-10-08T05:00:00Z');
  });

  it('4B: enforces trend gating (<3 scenes or <7 days span -> insufficient_data) and computes chronological slopes when >=3 scenes span >=7 days', () => {
    // Case 1: Only 2 valid NDVI scenes -> trendEligible must be false
    const twoSceneHls = buildHlsPayload([
      buildHlsObs({ observationTimestamp: '2026-10-01T05:00:00Z', ndvi: 0.65, ndwi: 0.2 }),
      buildHlsObs({ observationTimestamp: '2026-10-12T05:00:00Z', ndvi: 0.55, ndwi: 0.1 }),
    ]);

    const shortAnalytics = runPhase4EnvironmentalAnalytics({
      hlsPayload: twoSceneHls,
      referenceNowMs: FIXED_NOW_MS,
    });
    assert.equal(shortAnalytics.temporalAnalysis.series.ndvi.calculatedStatistics.trendEligible, false);
    assert.equal(
      shortAnalytics.temporalAnalysis.series.ndvi.calculatedStatistics.trendDirection,
      'insufficient_data',
    );
    assert.equal(shortAnalytics.temporalAnalysis.series.ndvi.calculatedStatistics.netChange, -0.1);

    // Case 2: Out-of-order timestamps with >=3 scenes over >=7 days + irregular gap > 14 days
    const multiSceneHls = buildHlsPayload([
      buildHlsObs({ observationTimestamp: '2026-10-12T05:00:00Z', productId: 'HLSS30.002', ndvi: 0.42, ndwi: -0.05 }),
      buildHlsObs({ observationTimestamp: '2026-09-10T05:00:00Z', productId: 'HLSL30.002', ndvi: 0.72, ndwi: 0.25 }),
      buildHlsObs({ observationTimestamp: '2026-09-30T05:00:00Z', productId: 'HLSL30.002', ndvi: 0.58, ndwi: 0.1 }),
    ]);
    const ecoDiffDate = buildEcostressPayload([
      buildEcostressObs({ observationTimestamp: '2026-09-01T10:00:00Z', productId: 'ECO_L3T_JET.002', etDailyWm2: 320, esiRatio: 0.78 }),
      buildEcostressObs({ observationTimestamp: '2026-09-10T10:00:00Z', productId: 'ECO_L3T_JET.002', etDailyWm2: 260, esiRatio: 0.61 }),
      buildEcostressObs({ observationTimestamp: '2026-09-20T10:00:00Z', productId: 'ECO_L4T_ESI.002', etDailyWm2: 210, esiRatio: 0.34 }),
    ]);

    const multiAnalytics = runPhase4EnvironmentalAnalytics({
      ecostressPayload: ecoDiffDate,
      hlsPayload: multiSceneHls,
      referenceNowMs: FIXED_NOW_MS,
    });

    const ndviSeries = multiAnalytics.temporalAnalysis.series.ndvi;
    assert.equal(ndviSeries.observedValues[0]!.date, '2026-09-10');
    assert.equal(ndviSeries.observedValues[2]!.date, '2026-10-12');
    assert.equal(ndviSeries.calculatedStatistics.trendEligible, true);
    assert.equal(ndviSeries.calculatedStatistics.trendDirection, 'decreasing');
    assert.ok((ndviSeries.calculatedStatistics.slopePerWeek ?? 0) < 0);
    assert.equal(ndviSeries.hasIrregularSamplingGaps, true); // Sep 10 -> Sep 30 is 20 days (>14d)
    assert.equal(ndviSeries.mixedSensorsPresent, true); // HLSL30 + HLSS30
    // Cross-mission dates remain strictly non-simultaneous
    assert.equal(multiAnalytics.temporalAnalysis.crossMissionAlignment.treatedAsSimultaneous, false);
    assert.ok((multiAnalytics.temporalAnalysis.crossMissionAlignment.acquisitionGapDays ?? 0) >= 20);
  });

  it('4C & 4E: detects evaporative stress and NDVI drop with guardrails, while suppressing false stress alerts on masked/invalid scenes', () => {
    // Stressed valid series
    const ecoStress = buildEcostressPayload([
      buildEcostressObs({ observationTimestamp: '2026-09-20T10:00:00Z', etDailyWm2: 320, esiRatio: 0.75 }),
      buildEcostressObs({ observationTimestamp: '2026-10-02T10:00:00Z', etDailyWm2: 240, esiRatio: 0.52 }),
      buildEcostressObs({ observationTimestamp: '2026-10-12T10:00:00Z', etDailyWm2: 140, esiRatio: 0.28 }),
    ]);
    const hlsStress = buildHlsPayload([
      buildHlsObs({ observationTimestamp: '2026-09-18T05:00:00Z', ndvi: 0.74, ndwi: 0.24 }),
      buildHlsObs({ observationTimestamp: '2026-10-01T05:00:00Z', ndvi: 0.61, ndwi: 0.11 }),
      buildHlsObs({ observationTimestamp: '2026-10-12T05:00:00Z', ndvi: 0.42, ndwi: -0.08 }),
    ]);

    const stressAnalytics = runPhase4EnvironmentalAnalytics({
      ecostressPayload: ecoStress,
      hlsPayload: hlsStress,
      referenceNowMs: FIXED_NOW_MS,
    });

    assert.equal(stressAnalytics.stressReport.overallStatus, 'observed_concern');
    const ecoStressInd = stressAnalytics.stressReport.indicators.find(
      (i) => i.id === 'evaporative_stress',
    );
    const waterInd = stressAnalytics.stressReport.indicators.find(
      (i) => i.id === 'water_related_spectral',
    );
    assert.equal(ecoStressInd?.status, 'observed_concern');
    assert.ok(waterInd?.prohibitedInferenceGuardrail.toLowerCase().includes('soil moisture'));
    assert.ok(
      stressAnalytics.stressReport.diagnosticDisclaimer.toLowerCase().includes('never diagnose'),
    );

    assert.ok(stressAnalytics.monitoringReport.alerts.length >= 2);
    const dedupeKeys = stressAnalytics.monitoringReport.alerts.map((a) => a.dedupeKey);
    assert.equal(new Set(dedupeKeys).size, dedupeKeys.length);

    // Masked-only / invalid-only observations must NEVER trigger stress alerts (only data quality limitation notice)
    const maskedOnlyEco = buildEcostressPayload([
      buildEcostressObs({
        observationTimestamp: '2026-10-12T10:00:00Z',
        etDailyWm2: 50,
        esiRatio: 0.12,
        cloudMaskFlag: 1,
        qualityStatus: 'cloud_masked',
      }),
    ]);
    const maskedOnlyHls = buildHlsPayload([
      buildHlsObs({
        observationTimestamp: '2026-10-12T05:00:00Z',
        ndvi: 0.05,
        ndwi: -0.4,
        shadowMaskFlag: 1,
        qualityStatus: 'shadow_masked',
      }),
    ]);

    const maskedAnalytics = runPhase4EnvironmentalAnalytics({
      ecostressPayload: maskedOnlyEco,
      hlsPayload: maskedOnlyHls,
      referenceNowMs: FIXED_NOW_MS,
    });

    assert.equal(maskedAnalytics.confidenceAssessment.confidenceLevel, 'insufficient');
    assert.equal(maskedAnalytics.stressReport.overallStatus, 'inconclusive');
    assert.equal(
      maskedAnalytics.monitoringReport.alerts.some((a) => a.category !== 'data_quality_limitation'),
      false,
    );
    assert.ok(maskedAnalytics.monitoringReport.suppressedInvalidOrInsufficientCount >= 2);
  });

  it('4D Regression: FarmEnvironmentalContextService excludes masked scenes via Phase 4 validator & leaves Crop/Rotation engines untouched', async () => {
    const mockWeather: IWeatherRepository = {
      fetchWeatherTelemetry: async () =>
        ({
          location: { latitude: 19.076, longitude: 72.877 },
          dateRange: { startDate: '2026-09-10', endDate: '2026-10-10' },
          dataClassification: 'observed_historical',
          forecastDisclaimer: 'Historical',
          units: {
            temperature: '°C',
            precipitation: 'mm/day',
            cumulativePrecipitation: 'mm',
            solarRadiation: 'MJ/m²/day',
            relativeHumidity: '%',
            windSpeed: 'm/s',
            gpmRate: 'mm/hr',
          },
          summary: {
            totalDays: 30,
            availableDays: 30,
            missingDays: 0,
            meanTempC: 27,
            maxTempC: 32,
            minTempC: 22,
            totalPrecipitationMm: 220,
            meanSolarRadiationMjM2Day: 19,
            meanRelativeHumidityPercent: 75,
            meanWindSpeedMs: 3,
          },
          temperatureTrend: { slopeCPerDay: 0, totalChangeC: 0, direction: 'stable', sampleCount: 30 },
          dailySeries: [],
          monthlySummaries: [],
          gpmImerg: null,
          sourceAttributions: [],
          sources: ['POWER'],
          retrievedAt: '2026-10-12T00:00:00Z',
        }) as any,
      fetchClimateTrends: async () => ({} as any),
    };
    const mockSoil: ISoilRepository = {
      fetchSoilProfile: async () => ({ status: 'unavailable' }) as any,
      fetchSoilMoisture: async () => ({ status: 'unavailable' }) as any,
    };
    const mockEco: IEvapotranspirationRepository = {
      getCapabilities: () => ({} as any),
      submitJob: async () => ({} as any),
      getJobStatus: async () => ({} as any),
      getJobResults: async () => ({} as any),
      getLatestCompletedResult: async () =>
        buildEcostressPayload([
          buildEcostressObs({ observationTimestamp: '2026-10-08T10:00:00Z', etDailyWm2: 230, esiRatio: 0.72 }),
          buildEcostressObs({
            observationTimestamp: '2026-10-12T10:00:00Z',
            etDailyWm2: -999,
            esiRatio: 0.1,
            cloudMaskFlag: 1,
            qualityStatus: 'cloud_masked',
          }),
        ]),
    };
    const mockVeg: IVegetationRepository = {
      getCapabilities: () => ({} as any),
      submitJob: async () => ({} as any),
      getJobStatus: async () => ({} as any),
      getJobResults: async () => ({} as any),
      getLatestCompletedResult: async () =>
        buildHlsPayload([
          buildHlsObs({ observationTimestamp: '2026-10-09T05:00:00Z', ndvi: 0.66, ndwi: 0.21 }),
          buildHlsObs({
            observationTimestamp: '2026-10-13T05:00:00Z',
            ndvi: 0.01,
            ndwi: -0.9,
            shadowMaskFlag: 1,
            qualityStatus: 'shadow_masked',
          }),
        ]),
    };

    const envService = new FarmEnvironmentalContextService({
      weatherRepository: mockWeather,
      soilRepository: mockSoil,
      evapotranspirationRepository: mockEco,
      vegetationRepository: mockVeg,
    });

    const ctx = await envService.assembleContext({
      location: { latitude: 19.076, longitude: 72.877 },
    });

    // Must pick Oct 08 / Oct 09 valid scenes instead of Oct 12 / Oct 13 masked scenes!
    assert.equal(ctx.features.etDailyWm2, 230);
    assert.equal(ctx.features.esiRatio, 0.72);
    assert.equal(ctx.features.ndvi, 0.66);
    assert.equal(ctx.features.ndwi, 0.21);
    assert.ok(ctx.environmentalAnalytics);
    assert.equal(ctx.environmentalAnalytics?.preservesCropAndRotationScores, true);

    // Verify evaluateCropSuitability and generateRotationStrategies remain completely deterministic and unmodified
    const cropRepo = new JsonCropKnowledgeRepository();
    const { crops } = await cropRepo.searchCrops({});
    const res1 = evaluateCropSuitability({
      crops,
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: { targetSeason: 'Kharif', irrigationAvailable: true },
    });
    const res2 = evaluateCropSuitability({
      crops,
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: { targetSeason: 'Kharif', irrigationAvailable: true },
    });
    assert.equal(res1.recommendations[0]?.suitabilityScore, res2.recommendations[0]?.suitabilityScore);

    const generatedStrategies = generateRotationStrategies({
      crops,
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: { targetSeason: 'Kharif', irrigationAvailable: true },
      preferences: { seasonsCount: 3, startingSeason: 'Kharif' },
      strictRegionFilter: false,
    });
    assert.ok(generatedStrategies.length >= 2);
    const rot1 = evaluateRotationStrategies({
      crops,
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: { targetSeason: 'Kharif', irrigationAvailable: true },
      preferences: { seasonsCount: 3, startingSeason: 'Kharif' },
      strategies: generatedStrategies,
      regionalRules: [],
      strictRegionFilter: false,
    });
    assert.ok(rot1.strategies.length >= 2);
    assert.equal(typeof rot1.strategies[0]?.overallScore, 'number');
  });
});

describe('Phase 4 API Route: POST /api/v1/environmental/analyze', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const app = createApp();
    let server!: Server;
    baseUrl = await new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    closeServer = () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  after(async () => {
    await closeServer();
  });

  it('analyzes supplied ECOSTRESS & HLS payloads for a polygon parcel with configurable thresholds', async () => {
    const eco = buildEcostressPayload([
      buildEcostressObs({ observationTimestamp: '2026-09-25T10:00:00Z', etDailyWm2: 290, esiRatio: 0.71 }),
      buildEcostressObs({ observationTimestamp: '2026-10-03T10:00:00Z', etDailyWm2: 255, esiRatio: 0.62 }),
      buildEcostressObs({ observationTimestamp: '2026-10-11T10:00:00Z', etDailyWm2: 185, esiRatio: 0.37 }),
    ]);
    const hls = buildHlsPayload([
      buildHlsObs({ observationTimestamp: '2026-09-24T05:00:00Z', ndvi: 0.7, ndwi: 0.2 }),
      buildHlsObs({ observationTimestamp: '2026-10-02T05:00:00Z', ndvi: 0.64, ndwi: 0.14 }),
      buildHlsObs({ observationTimestamp: '2026-10-12T05:00:00Z', ndvi: 0.56, ndwi: 0.08 }),
    ]);

    const res = await fetch(`${baseUrl}/api/v1/environmental/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessingMode: 'auto',
        ecostressResult: eco,
        hlsResult: hls,
        autoFetchCompletedResults: false,
        thresholds: {
          esiStressThreshold: 0.4,
        },
      }),
    });

    assert.equal(res.status, 200);
    const json = (await res.json()) as ApiSuccessResponse<EnvironmentalAnalyticsResponse>;
    assert.equal(json.success, true);
    assert.equal(json.data.hasEcostressData, true);
    assert.equal(json.data.hasHlsData, true);
    assert.equal(json.data.analytics.preservesCropAndRotationScores, true);
    assert.equal(json.data.analytics.monitoringReport.appliedThresholds.esiStressThreshold, 0.4);
    assert.ok(json.data.analytics.monitoringReport.alerts.some((a) => a.category === 'evaporative_stress'));
  });
});
