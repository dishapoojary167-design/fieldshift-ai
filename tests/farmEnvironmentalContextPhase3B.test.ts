import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SUITABILITY_WEIGHTS } from '../server/engines/CropSuitabilityEngine.ts';
import { FarmEnvironmentalContextService } from '../server/services/implementations/FarmEnvironmentalContextService.ts';
import type { IEvapotranspirationRepository, ISoilRepository, IVegetationRepository, IWeatherRepository } from '../server/repositories/interfaces/index.ts';
import type { EcostressResultPayload, HlsResultPayload, WeatherTelemetrySnapshot, SoilProfile, SoilMoistureSnapshot } from '../shared/index.ts';

function createMockWeatherRepo(): IWeatherRepository {
  return {
    fetchWeatherTelemetry: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
      dataClassification: 'observed_historical',
      forecastDisclaimer: 'Historical observation only',
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
        meanTempC: 28.5,
        maxTempC: 34.0,
        minTempC: 24.0,
        totalPrecipitationMm: 250,
        meanSolarRadiationMjM2Day: 20.0,
        meanRelativeHumidityPercent: 80,
        meanWindSpeedMs: 3.5,
      },
      temperatureTrend: { slopeCPerDay: 0, totalChangeC: 0, direction: 'stable', sampleCount: 30 },
      dailySeries: [],
      monthlySummaries: [],
      gpmImerg: null,
      sourceAttributions: [],
      sources: ['POWER'],
      retrievedAt: new Date().toISOString(),
    } as unknown as WeatherTelemetrySnapshot),
    fetchClimateTrends: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      baselineYears: 5,
      dataClassification: 'observed_historical',
      forecastDisclaimer: 'Historical only',
      temperatureAnomalyC: 0,
      annualMeanTempC: 28.5,
      annualPrecipitationMm: 1200,
      precipitationAnomalyPercent: 0,
      heatStressDaysTrend: 'stable',
      yearlySummaries: [],
      sources: ['POWER'],
      sourceAttributions: [],
    }),
  };
}

function createMockSoilRepo(): ISoilRepository {
  return {
    fetchSoilProfile: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      selectedDepthCm: '0-5',
      dataClassification: 'modelled_estimate',
      status: 'available',
      providerUsed: 'soilgrids-rest-v2',
      fallbackUsed: false,
      depthLayers: [],
      surfaceSummary: {
        depthIntervalCm: '0-5',
        textureClass: 'Clay Loam',
        ph: { mean: 6.8, q05: 6.2, q95: 7.4, uncertainty: 0.3, unit: 'pH' },
        organicCarbonGKg: { mean: 14.5, q05: 10, q95: 20, uncertainty: 2, unit: 'g/kg' },
        nitrogenGKg: { mean: 1.2, q05: 0.8, q95: 1.6, uncertainty: 0.2, unit: 'g/kg' },
        sandPercent: { mean: 35, q05: 30, q95: 40, uncertainty: 3, unit: '%' },
        siltPercent: { mean: 35, q05: 30, q95: 40, uncertainty: 3, unit: '%' },
        clayPercent: { mean: 30, q05: 25, q95: 35, uncertainty: 3, unit: '%' },
        bulkDensityKgDm3: { mean: 1.3, q05: 1.2, q95: 1.4, uncertainty: 0.05, unit: 'kg/dm³' },
        cecCmolKg: { mean: 25, q05: 20, q95: 30, uncertainty: 2, unit: 'cmol/kg' },
        waterRetentionSummary: 'Good moisture retention',
      },
      uncertaintyMethodology: 'ISRIC Q0.05-Q0.95',
      wmsReferenceLayer: { serviceUrl: '', layerName: '', attribution: '' },
      sourceAttribution: { id: 'soilgrids', name: 'SoilGrids', attribution: '', url: '', cached: false, retrievedAt: '' },
      caveats: [],
      retrievedAt: new Date().toISOString(),
    } as unknown as SoilProfile),
    fetchSoilMoisture: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      dataClassification: 'satellite_derived',
      status: 'available',
      product: 'SMAP',
      units: 'm³/m³',
      observationDate: new Date().toISOString().slice(0, 10),
      surfaceMoistureM3M3: 0.28,
      rootZoneMoistureM3M3: 0.31,
      moistureSeries: [],
      retrievalConfidenceNote: 'High confidence',
      sourceAttribution: { id: 'smap', name: 'SMAP', attribution: '', url: '', cached: false, retrievedAt: '' },
      retrievedAt: new Date().toISOString(),
    } as unknown as SoilMoistureSnapshot),
  };
}

describe('Phase 3B: ECOSTRESS and Landsat/HLS Integration into FarmEnvironmentalContextService', () => {
  it('successfully integrates ECOSTRESS ET/ESI and Landsat/HLS NDVI/NDWI observations', async () => {
    const mockEcostressRepo: IEvapotranspirationRepository = {
      getCapabilities: () => ({} as any),
      submitJob: async () => ({} as any),
      getJobStatus: async () => ({} as any),
      getJobResults: async () => ({
        jobId: 'eco-test-1',
        upstreamTaskId: 'task-eco-1',
        status: 'completed',
        dataClassification: 'satellite_derived_et',
        taskType: 'area',
        products: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessing: { requestedMode: 'auto', appliedMode: 'polygon', hasPolygonGeometry: true, hasBoundingBox: true, note: '' },
        spatialResolution: { value: 70, unit: 'm', label: '70m thermal grid' },
        units: { etDaily: 'W/m²', instantaneousEt: 'W/m²', etInstUncertainty: 'W/m²', pet: 'W/m²', esi: 'Ratio (0–1)', partitionRatios: 'Ratio (0–1)', cloudMask: '0 = Clear', waterMask: '0 = Land' },
        summary: { totalObservations: 1, clearSkyObservations: 1, cloudMaskedObservations: 0, waterMaskedObservations: 0, invalidOrMissingObservations: 0, staleObservations: 0, meanCoveragePercent: 95, meanEtDailyWm2: 450.5, latestEtDailyWm2: 450.5, meanInstantaneousEtWm2: 300, meanEsiRatio: 0.78, latestEsiRatio: 0.78, meanPetWm2: 600 },
        observations: [{
          observationTimestamp: new Date().toISOString(),
          retrievalTimestamp: new Date().toISOString(),
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          spatialResolutionMeters: 70,
          spatialAggregation: 'polygon_area_stats',
          intersectingPixelCount: 100,
          validPixelCount: 95,
          coveragePercent: 95,
          etDailyWm2: 450.5,
          etInstUncertaintyWm2: 25,
          ptjplsmInstWm2: 280,
          sticInstWm2: 290,
          mod16InstWm2: 300,
          bessInstWm2: 310,
          canopyTranspirationRatio: 0.65,
          soilEvaporationRatio: 0.25,
          interceptionRatio: 0.1,
          sticCanopyRatio: 0.6,
          esiRatio: 0.78,
          petWm2: 600,
          cloudMaskFlag: 0,
          waterMaskFlag: 0,
          qualityFiltered: true,
          qualityStatus: 'valid',
          isStale: false,
          parameterUnits: { ETdaily: 'W/m²', ESI: 'Ratio (0–1)' },
          provenance: { providerId: 'eco', daac: 'LP DAAC', productId: 'ECO_L3T_JET.002', productVersion: '002', accessMethod: 'AppEEARS' },
        }],
        bundleFiles: [],
        sourceAttribution: { providerId: 'eco', providerName: 'ECOSTRESS', accessMethod: 'AppEEARS', daac: 'LP DAAC', productVersions: ['002'], datasetNames: ['ECO_L3T_JET'], url: '', retrievedAt: '', cached: false },
        caveats: [],
        retrievedAt: new Date().toISOString(),
      } as unknown as EcostressResultPayload),
      getLatestCompletedResult: async () => ({
        jobId: 'eco-test-1',
        upstreamTaskId: 'task-eco-1',
        status: 'completed',
        dataClassification: 'satellite_derived_et',
        taskType: 'area',
        products: ['ECO_L3T_JET.002', 'ECO_L4T_ESI.002'],
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessing: { requestedMode: 'auto', appliedMode: 'polygon', hasPolygonGeometry: true, hasBoundingBox: true, note: '' },
        spatialResolution: { value: 70, unit: 'm', label: '70m thermal grid' },
        units: { etDaily: 'W/m²', instantaneousEt: 'W/m²', etInstUncertainty: 'W/m²', pet: 'W/m²', esi: 'Ratio (0–1)', partitionRatios: 'Ratio (0–1)', cloudMask: '0 = Clear', waterMask: '0 = Land' },
        summary: { totalObservations: 1, clearSkyObservations: 1, cloudMaskedObservations: 0, waterMaskedObservations: 0, invalidOrMissingObservations: 0, staleObservations: 0, meanCoveragePercent: 95, meanEtDailyWm2: 450.5, latestEtDailyWm2: 450.5, meanInstantaneousEtWm2: 300, meanEsiRatio: 0.78, latestEsiRatio: 0.78, meanPetWm2: 600 },
        observations: [{
          observationTimestamp: new Date().toISOString(),
          retrievalTimestamp: new Date().toISOString(),
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          spatialResolutionMeters: 70,
          spatialAggregation: 'polygon_area_stats',
          intersectingPixelCount: 100,
          validPixelCount: 95,
          coveragePercent: 95,
          etDailyWm2: 450.5,
          etInstUncertaintyWm2: 25,
          ptjplsmInstWm2: 280,
          sticInstWm2: 290,
          mod16InstWm2: 300,
          bessInstWm2: 310,
          canopyTranspirationRatio: 0.65,
          soilEvaporationRatio: 0.25,
          interceptionRatio: 0.1,
          sticCanopyRatio: 0.6,
          esiRatio: 0.78,
          petWm2: 600,
          cloudMaskFlag: 0,
          waterMaskFlag: 0,
          qualityFiltered: true,
          qualityStatus: 'valid',
          isStale: false,
          parameterUnits: { ETdaily: 'W/m²', ESI: 'Ratio (0–1)' },
          provenance: { providerId: 'eco', daac: 'LP DAAC', productId: 'ECO_L3T_JET.002', productVersion: '002', accessMethod: 'AppEEARS' },
        }],
        bundleFiles: [],
        sourceAttribution: { providerId: 'eco', providerName: 'ECOSTRESS', accessMethod: 'AppEEARS', daac: 'LP DAAC', productVersions: ['002'], datasetNames: ['ECO_L3T_JET'], url: '', retrievedAt: '', cached: false },
        caveats: [],
        retrievedAt: new Date().toISOString(),
      } as unknown as EcostressResultPayload),
    };

    const mockHlsRepo: IVegetationRepository = {
      getCapabilities: () => ({} as any),
      submitJob: async () => ({} as any),
      getJobStatus: async () => ({} as any),
      getJobResults: async () => ({
        jobId: 'hls-test-1',
        upstreamTaskId: 'task-hls-1',
        status: 'completed',
        dataClassification: 'satellite_derived_surface_reflectance',
        taskType: 'area',
        products: ['HLSL30.002'],
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessing: { requestedMode: 'auto', appliedMode: 'polygon', hasPolygonGeometry: true, hasBoundingBox: true, note: '' },
        spatialResolution: { value: 30, unit: 'm', label: '30m grid' },
        units: { reflectance: '0-1', indices: '(-1 to 1)', scaleFactor: '0.0001', fmask: 'Bitmask' },
        summary: { totalObservations: 1, clearSkyObservations: 1, cloudMaskedObservations: 0, shadowMaskedObservations: 0, waterMaskedObservations: 0, invalidOrMissingObservations: 0, staleObservations: 0, meanCoveragePercent: 98, meanRedReflectance: 0.05, meanNirReflectance: 0.45, meanNdvi: 0.80, minNdvi: 0.75, maxNdvi: 0.85, meanNdwi: 0.35, latestNdvi: 0.80, latestNdwi: 0.35 },
        observations: [{
          observationTimestamp: new Date().toISOString(),
          retrievalTimestamp: new Date().toISOString(),
          productId: 'HLSL30.002',
          productVersion: '002',
          spatialResolutionMeters: 30,
          spatialAggregation: 'polygon_area_stats',
          intersectingPixelCount: 200,
          validPixelCount: 196,
          coveragePercent: 98,
          greenReflectance: 0.08,
          redReflectance: 0.05,
          nirReflectance: 0.45,
          swir1Reflectance: 0.15,
          ndvi: 0.80,
          ndwi: 0.35,
          cloudMaskFlag: 0,
          shadowMaskFlag: 0,
          waterMaskFlag: 0,
          qualityFiltered: true,
          qualityStatus: 'valid',
          isStale: false,
          parameterUnits: { NDVI: '(-1 to 1)', NDWI: '(-1 to 1)' },
          provenance: { providerId: 'hls', daac: 'LP DAAC', productId: 'HLSL30.002', productVersion: '002', accessMethod: 'AppEEARS' },
        }],
        bundleFiles: [],
        sourceAttribution: { providerId: 'hls', providerName: 'HLS', accessMethod: 'AppEEARS', daac: 'LP DAAC', productVersions: ['002'], datasetNames: ['HLSL30'], url: '', retrievedAt: '', cached: false },
        caveats: [],
        retrievedAt: new Date().toISOString(),
      } as unknown as HlsResultPayload),
      getLatestCompletedResult: async () => ({
        jobId: 'hls-test-1',
        upstreamTaskId: 'task-hls-1',
        status: 'completed',
        dataClassification: 'satellite_derived_surface_reflectance',
        taskType: 'area',
        products: ['HLSL30.002'],
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessing: { requestedMode: 'auto', appliedMode: 'polygon', hasPolygonGeometry: true, hasBoundingBox: true, note: '' },
        spatialResolution: { value: 30, unit: 'm', label: '30m grid' },
        units: { reflectance: '0-1', indices: '(-1 to 1)', scaleFactor: '0.0001', fmask: 'Bitmask' },
        summary: { totalObservations: 1, clearSkyObservations: 1, cloudMaskedObservations: 0, shadowMaskedObservations: 0, waterMaskedObservations: 0, invalidOrMissingObservations: 0, staleObservations: 0, meanCoveragePercent: 98, meanRedReflectance: 0.05, meanNirReflectance: 0.45, meanNdvi: 0.80, minNdvi: 0.75, maxNdvi: 0.85, meanNdwi: 0.35, latestNdvi: 0.80, latestNdwi: 0.35 },
        observations: [{
          observationTimestamp: new Date().toISOString(),
          retrievalTimestamp: new Date().toISOString(),
          productId: 'HLSL30.002',
          productVersion: '002',
          spatialResolutionMeters: 30,
          spatialAggregation: 'polygon_area_stats',
          intersectingPixelCount: 200,
          validPixelCount: 196,
          coveragePercent: 98,
          greenReflectance: 0.08,
          redReflectance: 0.05,
          nirReflectance: 0.45,
          swir1Reflectance: 0.15,
          ndvi: 0.80,
          ndwi: 0.35,
          cloudMaskFlag: 0,
          shadowMaskFlag: 0,
          waterMaskFlag: 0,
          qualityFiltered: true,
          qualityStatus: 'valid',
          isStale: false,
          parameterUnits: { NDVI: '(-1 to 1)', NDWI: '(-1 to 1)' },
          provenance: { providerId: 'hls', daac: 'LP DAAC', productId: 'HLSL30.002', productVersion: '002', accessMethod: 'AppEEARS' },
        }],
        bundleFiles: [],
        sourceAttribution: { providerId: 'hls', providerName: 'HLS', accessMethod: 'AppEEARS', daac: 'LP DAAC', productVersions: ['002'], datasetNames: ['HLSL30'], url: '', retrievedAt: '', cached: false },
        caveats: [],
        retrievedAt: new Date().toISOString(),
      } as unknown as HlsResultPayload),
    };

    const service = new FarmEnvironmentalContextService({
      weatherRepository: createMockWeatherRepo(),
      soilRepository: createMockSoilRepo(),
      evapotranspirationRepository: mockEcostressRepo,
      vegetationRepository: mockHlsRepo,
    });

    const context = await service.assembleContext({
      location: { latitude: 19.076, longitude: 72.877 },
      targetSeason: 'Kharif',
    });

    assert.equal(context.features.etDailyWm2, 450.5);
    assert.equal(context.features.esiRatio, 0.78);
    assert.equal(context.features.ndvi, 0.80);
    assert.equal(context.features.ndwi, 0.35);

    assert.ok(context.observations.some((o) => o.sourceProvider === 'NASA ECOSTRESS' && o.parameterId === 'etDailyWm2'));
    assert.ok(context.observations.some((o) => o.sourceProvider === 'NASA ECOSTRESS' && o.parameterId === 'esiRatio'));
    assert.ok(context.observations.some((o) => o.sourceProvider === 'NASA Landsat/HLS' && o.parameterId === 'ndvi'));
    assert.ok(context.observations.some((o) => o.sourceProvider === 'NASA Landsat/HLS' && o.parameterId === 'ndwi'));

    assert.ok(context.ecostressPayload);
    assert.ok(context.hlsPayload);
    assert.ok(context.dataSources.some((ds) => ds.id === 'nasa-ecostress'));
    assert.ok(context.dataSources.some((ds) => ds.id === 'nasa-hls'));
  });

  it('rejects out-of-range fill values (-9999) without zero coercion and populates missing status', async () => {
    const mockEcostressRepo: IEvapotranspirationRepository = {
      getCapabilities: () => ({} as any),
      submitJob: async () => ({} as any),
      getJobStatus: async () => ({} as any),
      getJobResults: async () => ({} as any),
      getLatestCompletedResult: async () => ({
        jobId: 'eco-fill',
        upstreamTaskId: 'task-eco-fill',
        status: 'completed',
        dataClassification: 'satellite_derived_et',
        taskType: 'area',
        products: ['ECO_L3T_JET.002'],
        dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
        location: { latitude: 19.076, longitude: 72.877 },
        spatialProcessing: { requestedMode: 'auto', appliedMode: 'polygon', hasPolygonGeometry: true, hasBoundingBox: true, note: '' },
        spatialResolution: { value: 70, unit: 'm', label: '70m' },
        units: { etDaily: 'W/m²', instantaneousEt: 'W/m²', etInstUncertainty: 'W/m²', pet: 'W/m²', esi: 'Ratio', partitionRatios: 'Ratio', cloudMask: '0', waterMask: '0' },
        summary: { totalObservations: 1, clearSkyObservations: 0, cloudMaskedObservations: 1, waterMaskedObservations: 0, invalidOrMissingObservations: 0, staleObservations: 0, meanCoveragePercent: 0, meanEtDailyWm2: -9999, latestEtDailyWm2: -9999, meanInstantaneousEtWm2: 0, meanEsiRatio: -9999, latestEsiRatio: -9999, meanPetWm2: 0 },
        observations: [{
          observationTimestamp: new Date().toISOString(),
          retrievalTimestamp: new Date().toISOString(),
          productId: 'ECO_L3T_JET.002',
          productVersion: '002',
          spatialResolutionMeters: 70,
          spatialAggregation: 'polygon_area_stats',
          intersectingPixelCount: 100,
          validPixelCount: 0,
          coveragePercent: 0,
          etDailyWm2: -9999,
          etInstUncertaintyWm2: null,
          ptjplsmInstWm2: null,
          sticInstWm2: null,
          mod16InstWm2: null,
          bessInstWm2: null,
          canopyTranspirationRatio: null,
          soilEvaporationRatio: null,
          interceptionRatio: null,
          sticCanopyRatio: null,
          esiRatio: -9999,
          petWm2: null,
          cloudMaskFlag: 1,
          waterMaskFlag: 0,
          qualityFiltered: true,
          qualityStatus: 'cloud_masked',
          isStale: false,
          parameterUnits: {},
          provenance: { providerId: 'eco', daac: 'LP DAAC', productId: 'ECO_L3T_JET.002', productVersion: '002', accessMethod: 'AppEEARS' },
        }],
        bundleFiles: [],
        sourceAttribution: { providerId: 'eco', providerName: 'ECOSTRESS', accessMethod: 'AppEEARS', daac: 'LP DAAC', productVersions: ['002'], datasetNames: ['ECO_L3T_JET'], url: '', retrievedAt: '', cached: false },
        caveats: [],
        retrievedAt: new Date().toISOString(),
      } as unknown as EcostressResultPayload),
    };

    const service = new FarmEnvironmentalContextService({
      weatherRepository: createMockWeatherRepo(),
      soilRepository: createMockSoilRepo(),
      evapotranspirationRepository: mockEcostressRepo,
    });

    const context = await service.assembleContext({
      location: { latitude: 19.076, longitude: 72.877 },
      targetSeason: 'Kharif',
    });

    assert.equal(context.features.etDailyWm2, null);
    assert.equal(context.features.esiRatio, null);
    assert.ok(context.missingParameters.includes('etDailyWm2'));
    assert.ok(context.missingParameters.includes('esiRatio'));
  });

  it('verifies default suitability weights remain untouched', () => {
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.temperature, 0.16);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.rainfall, 0.16);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.soilMoisture, 0.1);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.soilPh, 0.14);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.soilTexture, 0.1);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.organicCarbon, 0.08);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.waterRequirement, 0.14);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.growingSeason, 0.12);

    const sum = Object.values(DEFAULT_SUITABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 100) / 100, 1.0);
  });
});
