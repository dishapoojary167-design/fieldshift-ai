import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  areDatesDistinct,
  buildCardEnvironmentalEvidence,
  buildEsiSeries,
  buildEtSeries,
  buildNdviSeries,
  buildNdwiSeries,
  extractLatestEcostressView,
  extractLatestHlsView,
  formatHlsSensorName,
  isTimestampStale,
} from '../client/components/environmental/environmentalUtils.ts';
import {
  GIBS_LAYER_DEFINITIONS,
  PARCEL_TELEMETRY_LAYER_DEFINITIONS,
} from '../client/config/gibsLayers.ts';
import { apiClient, ApiClientError } from '../client/services/apiClient.ts';
import {
  aiAssistantBodySchema,
  cropIntelligenceBodySchema,
} from '../server/validation/schemas.ts';
import type {
  CropSuitabilityOption,
  EcostressResultPayload,
  HlsResultPayload,
} from '../shared/index.ts';

function createSampleEcostressPayload(): EcostressResultPayload {
  return {
    jobId: 'eco-job-101',
    upstreamTaskId: 'upstream-eco-101',
    status: 'completed',
    dataClassification: 'satellite_derived_et',
    taskType: 'area',
    products: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
    dateRange: { startDate: '2026-10-01', endDate: '2026-11-10' },
    location: { latitude: 19.8762, longitude: 75.3433 },
    spatialProcessing: {
      requestedMode: 'polygon',
      appliedMode: 'polygon',
      hasPolygonGeometry: true,
      hasBoundingBox: true,
      note: 'Polygon area statistics via AppEEARS',
    },
    spatialResolution: { value: 70, unit: 'm', label: '70 m' },
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
    summary: {
      totalObservations: 4,
      clearSkyObservations: 2,
      cloudMaskedObservations: 1,
      waterMaskedObservations: 0,
      invalidOrMissingObservations: 1,
      staleObservations: 0,
      meanCoveragePercent: 91.5,
      meanEtDailyWm2: 205.5,
      latestEtDailyWm2: 214.0,
      meanInstantaneousEtWm2: 240.0,
      meanEsiRatio: 0.72,
      latestEsiRatio: 0.74,
      meanPetWm2: 295.0,
    },
    observations: [
      {
        observationTimestamp: '2026-10-12T09:15:00Z',
        retrievalTimestamp: '2026-11-12T08:00:00Z',
        productId: 'ECO_L3T_JET.002',
        productVersion: '002',
        spatialResolutionMeters: 70,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 16,
        validPixelCount: 15,
        coveragePercent: 93.8,
        etDailyWm2: 197.0,
        etInstUncertaintyWm2: 18.2,
        ptjplsmInstWm2: null,
        sticInstWm2: null,
        mod16InstWm2: null,
        bessInstWm2: null,
        canopyTranspirationRatio: 0.62,
        soilEvaporationRatio: 0.28,
        interceptionRatio: 0.1,
        sticCanopyRatio: null,
        esiRatio: 0.7,
        petWm2: 280.0,
        cloudMaskFlag: 0,
        waterMaskFlag: 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
        isStale: false,
        parameterUnits: { ETdaily: 'W/m²', ESI: 'Ratio (0–1)' },
        provenance: {
          providerId: 'nasa_appeears_ecostress',
          daac: 'LP DAAC',
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
      {
        observationTimestamp: '2026-10-28T09:30:00Z',
        retrievalTimestamp: '2026-11-12T08:00:00Z',
        productId: 'ECO_L3T_JET.002',
        productVersion: '002',
        spatialResolutionMeters: 70,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 16,
        validPixelCount: 2,
        coveragePercent: 12.5,
        etDailyWm2: 999.0,
        etInstUncertaintyWm2: null,
        ptjplsmInstWm2: null,
        sticInstWm2: null,
        mod16InstWm2: null,
        bessInstWm2: null,
        canopyTranspirationRatio: null,
        soilEvaporationRatio: null,
        interceptionRatio: null,
        sticCanopyRatio: null,
        esiRatio: 0.11,
        petWm2: null,
        cloudMaskFlag: 1,
        waterMaskFlag: 0,
        qualityFiltered: true,
        qualityStatus: 'cloud_masked',
        isStale: false,
        parameterUnits: { ETdaily: 'W/m²' },
        provenance: {
          providerId: 'nasa_appeears_ecostress',
          daac: 'LP DAAC',
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
      {
        observationTimestamp: '2026-11-04T10:05:00Z',
        retrievalTimestamp: '2026-11-12T08:00:00Z',
        productId: 'ECO_L3T_JET.002',
        productVersion: '002',
        spatialResolutionMeters: 70,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 16,
        validPixelCount: 15,
        coveragePercent: 93.8,
        etDailyWm2: 214.0,
        etInstUncertaintyWm2: 14.5,
        ptjplsmInstWm2: null,
        sticInstWm2: null,
        mod16InstWm2: null,
        bessInstWm2: null,
        canopyTranspirationRatio: 0.65,
        soilEvaporationRatio: 0.25,
        interceptionRatio: 0.1,
        sticCanopyRatio: null,
        esiRatio: null,
        petWm2: null,
        cloudMaskFlag: 0,
        waterMaskFlag: 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
        isStale: false,
        parameterUnits: { ETdaily: 'W/m²' },
        provenance: {
          providerId: 'nasa_appeears_ecostress',
          daac: 'LP DAAC',
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
      {
        observationTimestamp: '2026-11-05T10:20:00Z',
        retrievalTimestamp: '2026-11-12T08:00:00Z',
        productId: 'ECO_L4T_ESI.002',
        productVersion: '002',
        spatialResolutionMeters: 70,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 16,
        validPixelCount: 14,
        coveragePercent: 87.5,
        etDailyWm2: null,
        etInstUncertaintyWm2: null,
        ptjplsmInstWm2: null,
        sticInstWm2: null,
        mod16InstWm2: null,
        bessInstWm2: null,
        canopyTranspirationRatio: null,
        soilEvaporationRatio: null,
        interceptionRatio: null,
        sticCanopyRatio: null,
        esiRatio: 0.74,
        petWm2: 310.0,
        cloudMaskFlag: 0,
        waterMaskFlag: 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
        isStale: false,
        parameterUnits: { ESI: 'Ratio (0–1)', PET: 'W/m²' },
        provenance: {
          providerId: 'nasa_appeears_ecostress',
          daac: 'LP DAAC',
          productId: 'ECO_L4T_ESI.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
    ],
    bundleFiles: [],
    sourceAttribution: {
      providerId: 'nasa_appeears_ecostress',
      providerName: 'NASA LP DAAC AppEEARS ECOSTRESS',
      accessMethod: 'NASA AppEEARS API',
      daac: 'LP DAAC',
      productVersions: ['002'],
      datasetNames: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
      url: 'https://appeears.earthdatacloud.nasa.gov',
      retrievedAt: '2026-11-12T08:00:00Z',
      cached: false,
    },
    caveats: ['ET values are reported in W/m² thermal flux, not mm/day.'],
    retrievedAt: '2026-11-12T08:00:00Z',
  };
}

function createSampleHlsPayload(): HlsResultPayload {
  return {
    jobId: 'hls-job-202',
    upstreamTaskId: 'upstream-hls-202',
    status: 'completed',
    dataClassification: 'satellite_derived_surface_reflectance',
    taskType: 'area',
    products: ['HLSL30.002', 'HLSS30.002'],
    dateRange: { startDate: '2026-10-01', endDate: '2026-11-10' },
    location: { latitude: 19.8762, longitude: 75.3433 },
    spatialProcessing: {
      requestedMode: 'polygon',
      appliedMode: 'polygon',
      hasPolygonGeometry: true,
      hasBoundingBox: true,
      note: 'Polygon area statistics via AppEEARS',
    },
    spatialResolution: { value: 30, unit: 'm', label: '30 m' },
    units: {
      reflectance: 'Reflectance Ratio (0–1)',
      indices: 'Index Ratio (-1 to 1)',
      scaleFactor: '0.0001',
      fmask: 'Bitmask (0 = Clear, 1 = Cloud, etc.)',
    },
    summary: {
      totalObservations: 3,
      clearSkyObservations: 2,
      cloudMaskedObservations: 0,
      shadowMaskedObservations: 1,
      waterMaskedObservations: 0,
      invalidOrMissingObservations: 0,
      staleObservations: 0,
      meanCoveragePercent: 95.0,
      meanRedReflectance: 0.08,
      meanNirReflectance: 0.34,
      meanNdvi: 0.62,
      minNdvi: 0.58,
      maxNdvi: 0.66,
      meanNdwi: 0.21,
      latestNdvi: 0.66,
      latestNdwi: 0.24,
    },
    observations: [
      {
        observationTimestamp: '2026-10-15T05:10:00Z',
        retrievalTimestamp: '2026-11-12T08:01:00Z',
        productId: 'HLSL30.002',
        productVersion: '002',
        spatialResolutionMeters: 30,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 44,
        validPixelCount: 42,
        coveragePercent: 95.5,
        greenReflectance: 0.09,
        redReflectance: 0.08,
        nirReflectance: 0.31,
        swir1Reflectance: 0.21,
        ndvi: 0.58,
        ndwi: 0.18,
        cloudMaskFlag: 0,
        shadowMaskFlag: 0,
        waterMaskFlag: 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
        isStale: false,
        parameterUnits: { NDVI: 'Index Ratio (-1 to 1)', NDWI: 'Index Ratio (-1 to 1)' },
        provenance: {
          providerId: 'nasa_appeears_hls',
          daac: 'LP DAAC',
          productId: 'HLSL30.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
      {
        observationTimestamp: '2026-10-20T05:12:00Z',
        retrievalTimestamp: '2026-11-12T08:01:00Z',
        productId: 'HLSS30.002',
        productVersion: '002',
        spatialResolutionMeters: 30,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 44,
        validPixelCount: 4,
        coveragePercent: 9.1,
        greenReflectance: 0.05,
        redReflectance: 0.04,
        nirReflectance: 0.12,
        swir1Reflectance: 0.09,
        ndvi: 0.12,
        ndwi: -0.25,
        cloudMaskFlag: 0,
        shadowMaskFlag: 1,
        waterMaskFlag: 0,
        qualityFiltered: true,
        qualityStatus: 'shadow_masked',
        isStale: false,
        parameterUnits: { NDVI: 'Index Ratio (-1 to 1)', NDWI: 'Index Ratio (-1 to 1)' },
        provenance: {
          providerId: 'nasa_appeears_hls',
          daac: 'LP DAAC',
          productId: 'HLSS30.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
      {
        observationTimestamp: '2026-11-08T05:15:00Z',
        retrievalTimestamp: '2026-11-12T08:01:00Z',
        productId: 'HLSS30.002',
        productVersion: '002',
        spatialResolutionMeters: 30,
        spatialAggregation: 'polygon_area_stats',
        intersectingPixelCount: 44,
        validPixelCount: 44,
        coveragePercent: 100.0,
        greenReflectance: 0.08,
        redReflectance: 0.07,
        nirReflectance: 0.37,
        swir1Reflectance: 0.22,
        ndvi: 0.66,
        ndwi: 0.24,
        cloudMaskFlag: 0,
        shadowMaskFlag: 0,
        waterMaskFlag: 0,
        qualityFiltered: false,
        qualityStatus: 'valid',
        isStale: false,
        parameterUnits: { NDVI: 'Index Ratio (-1 to 1)', NDWI: 'Index Ratio (-1 to 1)' },
        provenance: {
          providerId: 'nasa_appeears_hls',
          daac: 'LP DAAC',
          productId: 'HLSS30.002',
          productVersion: '002',
          accessMethod: 'NASA AppEEARS API',
        },
      },
    ],
    bundleFiles: [],
    sourceAttribution: {
      providerId: 'nasa_appeears_hls',
      providerName: 'NASA LP DAAC AppEEARS HLS',
      accessMethod: 'NASA AppEEARS API',
      daac: 'LP DAAC',
      productVersions: ['002'],
      datasetNames: ['HLSL30.002', 'HLSS30.002'],
      url: 'https://appeears.earthdatacloud.nasa.gov',
      retrievedAt: '2026-11-12T08:01:00Z',
      cached: false,
    },
    caveats: ['NDWI is spectral canopy/surface moisture reflectance, not volumetric soil moisture.'],
    retrievedAt: '2026-11-12T08:01:00Z',
  };
}

describe('Phase 3E Environmental Intelligence Dashboard utilities & safeguards', () => {
  it('filters masked scenes from ECOSTRESS & HLS views and preserves independent timestamps', () => {
    const eco = createSampleEcostressPayload();
    const hls = createSampleHlsPayload();
    const refNow = Date.parse('2026-11-15T12:00:00Z');

    const ecoView = extractLatestEcostressView(eco, refNow);
    const hlsView = extractLatestHlsView(hls, refNow);

    assert.ok(ecoView);
    assert.equal(ecoView.latestEtWm2, 214.0);
    assert.equal(ecoView.etObservationDate, '2026-11-04T10:05:00Z');
    assert.equal(ecoView.latestEsiRatio, 0.74);
    assert.equal(ecoView.esiObservationDate, '2026-11-05T10:20:00Z');
    assert.equal(ecoView.cloudMaskedObservations, 1);

    assert.ok(hlsView);
    assert.equal(hlsView.latestNdvi, 0.66);
    assert.equal(hlsView.ndviAcquisitionDate, '2026-11-08T05:15:00Z');
    assert.equal(hlsView.ndviProductId, 'HLSS30.002');
    assert.equal(formatHlsSensorName('HLSS30.002'), 'Sentinel-2 MSI (HLSS30)');
    assert.equal(formatHlsSensorName('HLSL30.002'), 'Landsat 8/9 OLI (HLSL30)');

    // ECOSTRESS (2026-11-04) vs HLS (2026-11-08) must never be merged as simultaneous
    assert.equal(areDatesDistinct(ecoView.etObservationDate, hlsView.ndviAcquisitionDate), true);
  });

  it('builds chronological series excluding cloud/shadow-masked scenes and detects staleness', () => {
    const eco = createSampleEcostressPayload();
    const hls = createSampleHlsPayload();
    const refNow = Date.parse('2026-11-15T12:00:00Z');

    const etSeries = buildEtSeries(eco, refNow);
    const esiSeries = buildEsiSeries(eco, refNow);
    const ndviSeries = buildNdviSeries(hls, refNow);
    const ndwiSeries = buildNdwiSeries(hls, refNow);

    // Masked scenes (999 W/m² cloud_masked, 0.12 shadow_masked) are excluded cleanly
    assert.deepEqual(
      etSeries.map((p) => p.value),
      [197.0, 214.0],
    );
    assert.deepEqual(
      esiSeries.map((p) => p.value),
      [0.7, 0.74],
    );
    assert.deepEqual(
      ndviSeries.map((p) => ({ value: p.value, productId: p.productId })),
      [
        { value: 0.58, productId: 'HLSL30.002' },
        { value: 0.66, productId: 'HLSS30.002' },
      ],
    );
    assert.deepEqual(
      ndwiSeries.map((p) => p.value),
      [0.18, 0.24],
    );

    assert.equal(isTimestampStale('2026-09-01T00:00:00Z', false, refNow), true);
    assert.equal(isTimestampStale('2026-11-08T05:15:00Z', false, refNow), false);
    assert.equal(isTimestampStale(null, true, refNow), true);
  });

  it('never fabricates observations when payloads or usable scenes are absent', () => {
    assert.equal(extractLatestEcostressView(null), null);
    assert.equal(extractLatestHlsView(null), null);
    assert.deepEqual(buildEtSeries(null), []);
    assert.deepEqual(buildNdviSeries(null), []);

    const maskedOnlyEco = createSampleEcostressPayload();
    maskedOnlyEco.observations = [maskedOnlyEco.observations[1]]; // cloud_masked only
    maskedOnlyEco.summary.latestEtDailyWm2 = null;
    maskedOnlyEco.summary.latestEsiRatio = null;

    const ecoView = extractLatestEcostressView(maskedOnlyEco);
    assert.ok(ecoView);
    assert.equal(ecoView.latestEtWm2, null);
    assert.equal(ecoView.latestEsiRatio, null);
    assert.deepEqual(buildEtSeries(maskedOnlyEco), []);
  });

  it('extracts CropRecommendationCard Environmental Evidence without altering suitability scores', () => {
    const mockCrop: CropSuitabilityOption = {
      rank: 1,
      cropId: 'soybean',
      cropName: 'Soybean',
      scientificName: 'Glycine max',
      cropGroup: 'Oilseed',
      eligibilityStatus: 'recommended',
      suitabilityScore: 84,
      suitabilityBand: 'high',
      suitabilityCategory: 'Highly Suitable',
      dataCompletenessPercent: 85,
      uncertaintyLevel: 'low',
      dataConfidence: {
        score: 85,
        level: 'high',
        completenessPercent: 85,
        missingDataPenaltyPoints: 0,
        note: 'High coverage of weather, soil, and satellite inputs.',
      },
      waterRequirement: 'moderate',
      waterRequirementDetail: {
        category: 'moderate',
        seasonalMinMm: 450,
        seasonalMaxMm: 700,
        rainfedViability: 'high',
        droughtTolerance: 'Moderate',
        waterloggingSensitivity: 'Sensitive',
        conservationFitNote: 'Suitable under normal monsoon distribution.',
      },
      growingSeasons: ['Kharif'],
      seasonalSuitability: {
        targetSeason: 'Kharif',
        matchesTargetSeason: true,
        documentedSeasons: ['Kharif'],
        sowingWindow: 'June–July',
        durationDaysRange: [95, 110],
        summary: 'Fits Kharif season.',
      },
      soilCompatibility: {
        summary: 'Well suited to clay-loam pH 6.8',
        phFit: 'Optimal',
        textureFit: 'Optimal',
        soilHealthNote: 'Nitrogen fixing legume.',
        drainageNote: 'Requires well-drained topsoil.',
      },
      factorScores: [],
      supportingObservations: [
        {
          parameter: 'etDailyWm2',
          label: 'ECOSTRESS Daily ET',
          observedValue: '214.0 W/m²',
          status: 'available',
          dataSource: 'satellite_derived',
          sourceLabel: 'NASA ECOSTRESS',
          datasetId: 'ECO_L3T_JET.002',
          spatialResolution: '70 m',
          observationTimestamp: '2026-11-04T10:05:00Z',
          stalenessNote: 'Observation is 11 days old.',
        },
        {
          parameter: 'ndvi',
          label: 'Landsat/HLS NDVI',
          observedValue: '0.66',
          status: 'available',
          dataSource: 'satellite_derived',
          sourceLabel: 'NASA Landsat/HLS',
          datasetId: 'HLSS30.002',
          spatialResolution: '30 m',
          observationTimestamp: '2026-11-08T05:15:00Z',
          representativenessNote: 'Clear-sky polygon mean (100% coverage).',
        },
      ],
      preferenceAdjustments: [],
      hardConstraintsFailed: [],
      rejectionReasons: [],
      advantages: ['Good Kharif rainfall fit'],
      disadvantages: [],
      limitingFactors: [],
      limitations: [],
      missingDataWarnings: ['Soil organic carbon lab measurement missing; using SoilGrids.'],
      missingOrUncertainInputs: ['ECOSTRESS ESI unavailable for selected window.'],
      dataSourcesUsed: [
        {
          id: 'nasa-ecostress',
          name: 'NASA ECOSTRESS',
          dataset: 'ECO_L3T_JET.002',
          spatialResolution: '70 m',
          role: 'satellite_evapotranspiration',
          isFresh: true,
          limitations: 'Subject to cloud cover',
          observationDate: '2026-11-04',
        },
      ],
      climateFitSummary: 'Favorable thermal & moisture regime.',
      explanation: 'Deterministic match based on ICAR parameters.',
    };

    const evidence = buildCardEnvironmentalEvidence(mockCrop);
    assert.equal(evidence.satelliteItems.length, 4);
    assert.equal(evidence.satelliteItems[0].observedValue, '214.0 W/m²');
    assert.equal(evidence.satelliteItems[1].status, 'missing');
    assert.equal(evidence.satelliteItems[2].observedValue, '0.66');
    assert.equal(evidence.satelliteItems[3].status, 'missing');
    assert.ok(evidence.warnings.some((w) => w.includes('ECOSTRESS ESI observation is unavailable')));
    assert.ok(evidence.warnings.some((w) => w.includes('Landsat/HLS NDWI observation is unavailable')));
    assert.equal(evidence.sources[0].dataset, 'ECO_L3T_JET.002');
    // Score remains unchanged
    assert.equal(mockCrop.suitabilityScore, 84);
  });

  it('preserves all 5 GIBS map layers while marking parcel ECOSTRESS/HLS map tiles unavailable', () => {
    assert.equal(GIBS_LAYER_DEFINITIONS.length, 5);
    assert.equal(PARCEL_TELEMETRY_LAYER_DEFINITIONS.length, 2);

    const ecoLayer = PARCEL_TELEMETRY_LAYER_DEFINITIONS.find((l) => l.id === 'ecostress_et');
    const hlsLayer = PARCEL_TELEMETRY_LAYER_DEFINITIONS.find((l) => l.id === 'hls_ndvi_ndwi');

    assert.ok(ecoLayer);
    assert.equal(ecoLayer.spatialRasterAvailable, false);
    assert.ok(ecoLayer.datasetName.includes('ECO_L3T_JET.002'));
    assert.equal(ecoLayer.resolutionLabel, '70 m × 70 m');
    assert.match(ecoLayer.unavailableReason, /unavailable/i);

    assert.ok(hlsLayer);
    assert.equal(hlsLayer.spatialRasterAvailable, false);
    assert.ok(hlsLayer.datasetName.includes('HLSL30.002'));
    assert.equal(hlsLayer.resolutionLabel, '30 m × 30 m');
    assert.match(hlsLayer.unavailableReason, /unavailable/i);
  });

  it('supports async AppEEARS job polling in apiClient without failing on 202 pending flow', async () => {
    const originalFetch = globalThis.fetch;
    const ecoPayload = createSampleEcostressPayload();
    const hlsPayload = createSampleHlsPayload();
    const calls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith('/api/v1/evapotranspiration/jobs')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { jobId: 'eco-job-101', status: 'submitted', resultAvailable: false },
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:00Z' },
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/evapotranspiration/jobs/eco-job-101?refresh=true')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { jobId: 'eco-job-101', status: 'completed', resultAvailable: true },
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:01Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/v1/evapotranspiration/jobs/eco-job-101/results')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: ecoPayload,
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:02Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/v1/vegetation?')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { jobId: 'hls-job-202', status: 'processing', resultAvailable: false },
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:00Z' },
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/v1/vegetation/jobs/hls-job-202?refresh=true')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { jobId: 'hls-job-202', status: 'completed', resultAvailable: true },
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:01Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/v1/vegetation/jobs/hls-job-202/results')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: hlsPayload,
            meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:02Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'JOB_FAILED', message: 'Upstream AppEEARS failure' },
          meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:00Z' },
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const ecoRes = await apiClient.fetchEcostressForFarm(
        {
          location: { latitude: 19.8762, longitude: 75.3433 },
          dateRange: { startDate: '2026-10-01', endDate: '2026-11-10' },
        },
        { pollIntervalMs: 5, maxPollAttempts: 3 },
      );
      assert.equal(ecoRes.summary.latestEtDailyWm2, 214.0);

      const hlsRes = await apiClient.fetchHlsForFarm(
        {
          location: { latitude: 19.8762, longitude: 75.3433 },
          dateRange: { startDate: '2026-10-01', endDate: '2026-11-10' },
        },
        { pollIntervalMs: 5, maxPollAttempts: 3 },
      );
      assert.equal(hlsRes.summary.latestNdvi, 0.66);
      assert.ok(calls.some((u) => u.includes('/evapotranspiration/jobs/eco-job-101/results')));
      assert.ok(calls.some((u) => u.includes('/vegetation/jobs/hls-job-202/results')));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces explicit ApiClientError when ECOSTRESS async extraction fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            jobId: 'eco-fail-1',
            status: 'failed',
            errorMessage: 'NASA AppEEARS Earthdata credentials not configured.',
            resultAvailable: false,
          },
          meta: { apiVersion: 'v1', timestamp: '2026-11-15T00:00:00Z' },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          apiClient.fetchEcostressForFarm(
            {
              location: { latitude: 19.8762, longitude: 75.3433 },
              dateRange: { startDate: '2026-10-01', endDate: '2026-11-10' },
            },
            { pollIntervalMs: 1, maxPollAttempts: 1 },
          ),
        (err: unknown) =>
          err instanceof ApiClientError &&
          err.code === 'ECOSTRESS_JOB_FAILED' &&
          err.message.includes('Earthdata credentials'),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves optional ECOSTRESS & HLS payloads in Zod request schemas without stripping', () => {
    const eco = createSampleEcostressPayload();
    const hls = createSampleHlsPayload();

    const cropParsed = cropIntelligenceBodySchema.parse({
      location: { latitude: 19.8762, longitude: 75.3433 },
      ecostressResult: eco,
      hlsResult: hls,
    });
    assert.ok(cropParsed.ecostressResult);
    assert.ok(cropParsed.hlsResult);

    const aiParsed = aiAssistantBodySchema.parse({
      prompt: 'Is there evidence of evaporative stress?',
      location: { latitude: 19.8762, longitude: 75.3433 },
      farmContext: {
        ecostressPayload: eco,
        hlsPayload: hls,
      },
    });
    assert.ok(aiParsed.farmContext?.ecostressPayload);
    assert.ok(aiParsed.farmContext?.hlsPayload);
  });
});
