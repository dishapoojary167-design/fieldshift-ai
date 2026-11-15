import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleGroundedFarmContext, type FarmContextRepositories } from '../server/services/ai/FarmContextAssembler.ts';
import { AiAssistantService } from '../server/services/implementations/AiAssistantService.ts';
import { FarmEnvironmentalContextService } from '../server/services/implementations/FarmEnvironmentalContextService.ts';
import type { AiAssistantRequest, EcostressResultPayload, HlsResultPayload, WeatherTelemetrySnapshot, SoilProfile, SoilMoistureSnapshot, CropIntelligenceResult } from '../shared/index.ts';

function createMockRepos(): FarmContextRepositories {
  const weatherRepo = {
    fetchWeatherTelemetry: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      dateRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
      dataClassification: 'observed_historical',
      forecastDisclaimer: 'Historical observation only',
      units: { temperature: '°C', cumulativePrecipitation: 'mm', gpmRate: 'mm/hr' },
      summary: { totalDays: 30, availableDays: 30, missingDays: 0, meanTempC: 28.5, maxTempC: 34.0, minTempC: 24.0, totalPrecipitationMm: 150 },
      dailySeries: [],
      monthlySummaries: [],
      gpmImerg: { status: 'available', precipitationRateMmHr: 1.2, observationTimestamp: '2026-09-30T10:00:00Z', unit: 'mm/hr', sourceAttribution: { id: 'gpm', name: 'GPM', attribution: '', url: '', cached: false, retrievedAt: '' }, retrievedAt: '' },
      sources: ['POWER', 'GPM'],
      sourceAttributions: [],
    } as unknown as WeatherTelemetrySnapshot),
    fetchClimateTrends: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      baselineYears: 5,
      dataClassification: 'observed_historical' as const,
      forecastDisclaimer: 'Historical only',
      temperatureAnomalyC: 0,
      annualMeanTempC: 28.5,
      annualPrecipitationMm: 1100,
      precipitationAnomalyPercent: 0,
      heatStressDaysTrend: 'stable',
      yearlySummaries: [],
      sources: ['POWER'],
      sourceAttributions: [],
    } as any),
  };

  const soilRepo = {
    fetchSoilProfile: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      selectedDepthCm: '0-5',
      dataClassification: 'modelled_estimate',
      status: 'available',
      surfaceSummary: {
        depthIntervalCm: '0-5',
        textureClass: 'Clay Loam',
        ph: { mean: 6.8, q05: 6.2, q95: 7.4, uncertainty: 0.3, unit: 'pH' },
        organicCarbonGKg: { mean: 15.0, q05: 11, q95: 19, uncertainty: 2, unit: 'g/kg' },
      },
      sourceAttribution: { id: 'soilgrids', name: 'SoilGrids', attribution: '', url: '', cached: false, retrievedAt: '' },
    } as unknown as SoilProfile),
    fetchSoilMoisture: async () => ({
      location: { latitude: 19.076, longitude: 72.877 },
      dataClassification: 'satellite_derived',
      status: 'available',
      product: 'SMAP',
      units: 'm³/m³',
      observationDate: '2026-09-30',
      rootZoneMoistureM3M3: 0.32,
      surfaceMoistureM3M3: 0.28,
      sourceAttribution: { id: 'smap', name: 'SMAP', attribution: '', url: '', cached: false, retrievedAt: '' },
    } as unknown as SoilMoistureSnapshot),
  };

  const ecoRepo = {
    getCapabilities: () => ({} as any),
    submitJob: async () => ({} as any),
    getJobStatus: async () => ({} as any),
    getJobResults: async () => ({
      jobId: 'eco-3d',
      status: 'completed',
      observations: [{
        observationTimestamp: '2026-09-20T12:00:00Z',
        etDailyWm2: 480.0,
        esiRatio: 0.75,
        qualityStatus: 'valid',
        coveragePercent: 96,
      }],
    } as unknown as EcostressResultPayload),
    getLatestCompletedResult: async () => ({
      jobId: 'eco-3d',
      status: 'completed',
      observations: [{
        observationTimestamp: '2026-09-20T12:00:00Z',
        etDailyWm2: 480.0,
        esiRatio: 0.75,
        qualityStatus: 'valid',
        coveragePercent: 96,
      }],
    } as unknown as EcostressResultPayload),
  };

  const hlsRepo = {
    getCapabilities: () => ({} as any),
    submitJob: async () => ({} as any),
    getJobStatus: async () => ({} as any),
    getJobResults: async () => ({
      jobId: 'hls-3d',
      status: 'completed',
      observations: [{
        observationTimestamp: '2026-09-28T10:00:00Z',
        ndvi: 0.82,
        ndwi: 0.38,
        qualityStatus: 'valid',
        coveragePercent: 99,
      }],
    } as unknown as HlsResultPayload),
    getLatestCompletedResult: async () => ({
      jobId: 'hls-3d',
      status: 'completed',
      observations: [{
        observationTimestamp: '2026-09-28T10:00:00Z',
        ndvi: 0.82,
        ndwi: 0.38,
        qualityStatus: 'valid',
        coveragePercent: 99,
      }],
    } as unknown as HlsResultPayload),
  };

  return {
    weatherRepository: weatherRepo,
    soilRepository: soilRepo,
    cropKnowledgeRepository: {
      searchCrops: async () => ({
        crops: [
          {
            id: 'soybean',
            cropName: 'Soybean',
            scientificName: 'Glycine max',
            cropFamily: 'Fabaceae',
            cropGroup: 'Legumes',
            localNames: ['Soyabean', 'सोयाबीन'],
            growingSeasons: { value: ['Kharif'] },
            temperatureRequirements: { value: { optimalMinC: 20, optimalMaxC: 30 } },
            waterRequirements: { value: { category: 'medium', seasonalMinMm: 450, seasonalMaxMm: 700 } },
            soilPreferences: { value: { phMin: 6.0, phMax: 7.5, preferredTextures: ['Clay Loam', 'Loam'] } },
            nitrogenFixationCharacteristics: { value: { fixesAtmosphericNitrogen: true, residualNitrogenCreditKgNHa: [30, 50] } },
            regionalSuitability: { value: [] },
            growingDuration: { value: { daysMin: 90, daysMax: 120 } },
            nutrientRequirements: { value: { nitrogenKgHa: 20, phosphorusKgHa: 60, potassiumKgHa: 40 } },
            irrigationNeeds: { value: { category: 'medium', criticalStages: [] } },
            cropRotationCompatibility: { value: { recommendedPrecedingCrops: [], avoidedPrecedingCrops: [] } },
            validationStatus: 'verified',
            sourceReferences: [],
          },
        ],
        totalCount: 1,
        filteredCount: 1,
        appliedFilter: {},
        knowledgeSeparationNotice: '',
        dataAttribution: { id: 'icar', name: 'ICAR', attribution: '', url: '', cached: false, retrievedAt: '' },
      } as any),
      getCropById: async () => null,
      getAgroClimaticRegions: async () => ({ zones: [], states: [], sourceAttribution: {} as any } as any),
    },
    cropRepository: {
      evaluateSuitability: async () => ({
        location: { latitude: 19.076, longitude: 72.877 },
        evaluationStatus: 'completed',
        recommendations: [
          {
            cropId: 'soybean',
            cropName: 'Soybean',
            scientificName: 'Glycine max',
            suitabilityScore: 88,
            suitabilityCategory: 'highly_suitable',
            dataConfidence: { level: 'high', score: 90, factors: [] },
            advantages: ['Favorable rainfall and clay loam soil'],
            limitations: [],
            waterRequirementDetail: { category: 'medium', seasonalMinMm: 450, seasonalMaxMm: 700 },
          },
        ],
        excludedCrops: [],
      } as unknown as CropIntelligenceResult),
    },
    rotationRepository: {
      generateRotationStrategies: async () => ({
        strategies: [],
        recommendation: { preferredStrategyId: 'strat-1', preferredStrategyLabel: 'Soybean - Wheat Rotation', whyPreferred: 'Excellent legume N benefit' },
      } as any),
      buildRotationSchedule: async () => ({} as any),
      compareRotationStrategies: async () => ({} as any),
    },
    evapotranspirationRepository: ecoRepo,
    vegetationRepository: hlsRepo,
    farmEnvironmentalContextService: new FarmEnvironmentalContextService({
      weatherRepository: weatherRepo,
      soilRepository: soilRepo,
      evapotranspirationRepository: ecoRepo,
      vegetationRepository: hlsRepo,
    }),
  };
}

describe('Phase 3D: ECOSTRESS & Landsat/HLS AI Assistant Integration Tests', () => {
    it('successfully extracts ECOSTRESS and Landsat/HLS context and detects temporal separation > 7 days', async () => {
    const repos = createMockRepos();
    const request: AiAssistantRequest = {
      prompt: 'How are the crop and moisture conditions according to satellite observations?',
      location: { latitude: 19.076, longitude: 72.877 },
      language: 'en',
    };

    const context = await assembleGroundedFarmContext(request, repos);

    assert.equal(context.sourceCitations.some((s) => s.sourceId === 'nasa-ecostress' && s.status === 'available'), true);
    assert.equal(context.sourceCitations.some((s) => s.sourceId === 'nasa-hls' && s.status === 'available'), true);

    // ECOSTRESS observation date: 2026-09-20, HLS date: 2026-09-28 (8 days apart -> > 7 days conflict)
    const temporalConflict = context.dataConflicts.find((c) => c.topic.includes('Temporal Acquisition Gap'));
    assert.ok(temporalConflict, 'Should detect temporal acquisition gap > 7 days between ECOSTRESS and HLS');
  });

  it('AiAssistantService generates grounded response successfully with ECOSTRESS and HLS context', async () => {
    const repos = createMockRepos();
    const mockGeminiClient = {
      generateContent: async () => JSON.stringify({
        answer: 'Based on NASA ECOSTRESS thermal data (ET = 480.0 W/m², ESI = 0.75) and Landsat/HLS (NDVI = 0.82, NDWI = 0.38), your farm displays healthy canopy greenness and favorable transpiration stress ratios. Note that ECOSTRESS thermal ET is expressed in W/m² (thermal energy flux) and NDWI reflects canopy water content rather than direct soil moisture. Soybean is top-ranked (88/100).',
        actionSteps: [
          'Verify soil moisture at root depth with a hand auger.',
          'Consult local KVK agronomist before scheduling irrigation changes.',
        ],
        referencedSources: ['NASA ECOSTRESS', 'NASA Landsat/HLS', 'NASA SMAP', 'ICAR Knowledge Base'],
        acknowledgedMissingData: [],
      }),
    };

    const service = new AiAssistantService({
      repos,
      geminiClient: mockGeminiClient,
      envConfig: {
        isGeminiConfigured: true,
        geminiApiKey: 'test-key',
        geminiModel: 'gemini-2.5-flash',
        geminiHttpTimeoutMs: 10000,
        nodeEnv: 'test',
        port: 3000,
      } as any,
    });

    const response = await service.askAssistant({
      prompt: 'Explain my crop and thermal observations',
      location: { latitude: 19.076, longitude: 72.877 },
      language: 'en',
    });

    assert.ok(response.answer.includes('ECOSTRESS'));
    assert.ok(response.answer.includes('Landsat/HLS'));
    assert.equal(response.sourceCitations.length > 0, true);
    assert.ok(response.safetyDisclaimer);
  });
});
