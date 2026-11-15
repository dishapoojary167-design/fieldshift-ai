import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import {
  DEFAULT_SUITABILITY_WEIGHTS,
  evaluateCropSuitability,
  normalizeSuitabilityWeights,
} from '../server/engines/CropSuitabilityEngine.ts';
import { CropIntelligenceRepository } from '../server/repositories/implementations/CropIntelligenceRepository.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import type { ISoilRepository, IWeatherRepository } from '../server/repositories/interfaces/index.ts';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  CropIntelligenceResult,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../shared/index.ts';

async function startTestServer(app: ReturnType<typeof createApp>) {
  let server!: Server;
  const baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('Module 6: Explainable Deterministic Crop Recommendation Engine', async () => {
  const knowledgeRepo = new JsonCropKnowledgeRepository();
  const allCrops = (await knowledgeRepo.searchCrops({})).crops;

  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const app = createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  after(async () => {
    await closeServer();
  });

  it('ranks Soybean top in Central India Malwa Vertisol Kharif and excludes Rabi-only crops', () => {
    const result = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        agroClimaticZoneId: 'acz-08-central-plateau-hills',
        state: 'Madhya Pradesh',
        irrigationAvailable: false,
        temperatureMeanC: 25.5,
        temperatureMaxC: 31.0,
        temperatureMinC: 20.5,
        seasonalRainfallMm: 600,
        soilMoistureM3M3: 0.26,
        soilPh: 6.8,
        soilPhSource: 'measured_lab',
        soilTexture: 'Clay Loam',
        soilTextureSource: 'measured_lab',
        organicCarbonGKg: 7.5,
        organicCarbonSource: 'measured_lab',
      },
    });

    assert.equal(result.evaluationStatus, 'completed');
    assert.equal(result.uncertaintyLevel, 'low');
    assert.equal(result.dataCompletenessPercent, 100);
    assert.ok(result.deterministicNoAiNotice.toLowerCase().includes('independent of gemini'));

    const topCrop = result.recommendations[0];
    assert.ok(topCrop);
    assert.equal(topCrop.cropId, 'soybean');
    assert.equal(topCrop.rank, 1);
    assert.equal(topCrop.eligibilityStatus, 'recommended');
    assert.ok(topCrop.suitabilityScore >= 90, `Expected Soybean >= 90, got ${topCrop.suitabilityScore}`);
    assert.equal(topCrop.factorScores.length, 8);
    assert.ok(topCrop.advantages.some((a) => a.includes('Biological Nitrogen Fixation')));

    const excludedIds = new Map(
      result.excludedCrops.map((c) => [c.cropId, c.hardConstraintsFailed.map((h) => h.code)]),
    );
    assert.ok(excludedIds.get('wheat')?.includes('INCOMPATIBLE_SEASON'));
    assert.ok(excludedIds.get('chickpea')?.includes('INCOMPATIBLE_SEASON'));
    assert.ok(excludedIds.get('indian-mustard')?.includes('INCOMPATIBLE_SEASON'));
    assert.ok(excludedIds.get('pearl-millet')?.includes('UNSUPPORTED_REGION'));
  });

  it('ranks Pearl Millet (Bajra) #1 in arid Western Rajasthan Kharif and excludes water-intensive Rice', () => {
    const result = evaluateCropSuitability({
      location: { latitude: 26.2389, longitude: 73.0243 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        agroClimaticZoneId: 'acz-14-western-dry',
        state: 'Rajasthan',
        irrigationAvailable: false,
        temperatureMeanC: 30.0,
        temperatureMaxC: 39.0,
        temperatureMinC: 24.0,
        seasonalRainfallMm: 300,
        soilMoistureM3M3: 0.15,
        soilPh: 7.4,
        soilTexture: 'Sandy Loam',
        organicCarbonGKg: 3.2,
      },
    });

    assert.equal(result.evaluationStatus, 'completed');
    assert.equal(result.recommendations[0]?.cropId, 'pearl-millet');
    assert.ok(result.recommendations[0].suitabilityScore >= 85);

    const rice = result.excludedCrops.find((c) => c.cropId === 'rice');
    assert.ok(rice);
    assert.ok(
      rice.hardConstraintsFailed.some(
        (h) => h.code === 'UNSUPPORTED_REGION' || h.code === 'SEVERE_WATER_DEFICIT',
      ),
    );
  });

  it('evaluates Punjab Rabi irrigated Wheat #1 and flags SEVERE_WATER_DEFICIT when rainfed only', () => {
    const irrigatedResult = evaluateCropSuitability({
      location: { latitude: 30.901, longitude: 75.8573 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Rabi',
        agroClimaticZoneId: 'acz-06-trans-gangetic-plains',
        state: 'Punjab',
        irrigationAvailable: true,
        temperatureMeanC: 17.5,
        temperatureMaxC: 24.0,
        temperatureMinC: 10.0,
        seasonalRainfallMm: 120,
        soilMoistureM3M3: 0.27,
        soilPh: 7.2,
        soilTexture: 'Loam',
        organicCarbonGKg: 7.6,
      },
    });

    const topTwoIds = irrigatedResult.recommendations.slice(0, 2).map((c) => c.cropId);
    assert.ok(topTwoIds.includes('wheat'), `Expected wheat in top 2, got ${topTwoIds.join(', ')}`);
    const irrigatedWheat = irrigatedResult.recommendations.find((c) => c.cropId === 'wheat')!;
    assert.ok(irrigatedWheat.suitabilityScore >= 88);
    assert.equal(irrigatedWheat.eligibilityStatus, 'recommended');

    const rainfedResult = evaluateCropSuitability({
      location: { latitude: 30.901, longitude: 75.8573 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Rabi',
        agroClimaticZoneId: 'acz-06-trans-gangetic-plains',
        state: 'Punjab',
        irrigationAvailable: false,
        temperatureMeanC: 17.5,
        seasonalRainfallMm: 120,
        soilMoistureM3M3: 0.27,
        soilPh: 7.2,
        soilTexture: 'Loam',
        organicCarbonGKg: 7.6,
      },
    });

    const excludedWheat = rainfedResult.excludedCrops.find((c) => c.cropId === 'wheat');
    assert.ok(excludedWheat);
    assert.ok(
      excludedWheat.hardConstraintsFailed.some((h) => h.code === 'SEVERE_WATER_DEFICIT'),
    );
  });

  it('enforces EXTREME_SOIL_PH and EXTREME_TEMPERATURE hard constraints', () => {
    const extremePh = evaluateCropSuitability({
      location: { latitude: 23.0, longitude: 77.0 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        temperatureMeanC: 26,
        seasonalRainfallMm: 600,
        soilPh: 4.1,
        soilTexture: 'Loam',
        soilMoistureM3M3: 0.25,
        organicCarbonGKg: 6.0,
        irrigationAvailable: false,
      },
    });

    const chickpeaOrSoybean = extremePh.excludedCrops.find((c) => c.cropId === 'soybean');
    assert.ok(chickpeaOrSoybean);
    assert.ok(
      chickpeaOrSoybean.hardConstraintsFailed.some((h) => h.code === 'EXTREME_SOIL_PH'),
    );

    const extremeHeat = evaluateCropSuitability({
      location: { latitude: 26.0, longitude: 73.0 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        temperatureMeanC: 48,
        seasonalRainfallMm: 500,
        soilPh: 7.0,
        soilTexture: 'Loam',
        soilMoistureM3M3: 0.25,
        organicCarbonGKg: 6.0,
        irrigationAvailable: true,
      },
    });

    assert.ok(
      extremeHeat.excludedCrops.every((c) =>
        c.hardConstraintsFailed.some((h) => h.code === 'EXTREME_TEMPERATURE'),
      ),
    );
    assert.equal(extremeHeat.recommendations.length, 0);
  });

  it('normalizes configurable factor weights and deterministically reflects custom priorities', () => {
    const normalized = normalizeSuitabilityWeights({
      temperature: 1,
      rainfall: 1,
      soilMoisture: 1,
      soilPh: 1,
      soilTexture: 1,
      organicCarbon: 1,
      waterRequirement: 1,
      growingSeason: 1,
    });
    const sum = Object.values(normalized).reduce((s, w) => s + w, 0);
    assert.ok(Math.abs(sum - 1) < 0.01);

    const defaultRun = evaluateCropSuitability({
      location: { latitude: 20.0, longitude: 78.0 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        temperatureMeanC: 27,
        seasonalRainfallMm: 600,
        soilMoistureM3M3: 0.24,
        soilPh: 6.8,
        soilTexture: 'Sandy Loam',
        organicCarbonGKg: 4.5,
        irrigationAvailable: false,
      },
    });

    const phHeavyRun = evaluateCropSuitability({
      location: { latitude: 20.0, longitude: 78.0 },
      crops: allCrops,
      weights: { ...DEFAULT_SUITABILITY_WEIGHTS, soilPh: 0.7, organicCarbon: 0.02 },
      inputs: {
        targetSeason: 'Kharif',
        temperatureMeanC: 27,
        seasonalRainfallMm: 600,
        soilMoistureM3M3: 0.24,
        soilPh: 6.8,
        soilTexture: 'Sandy Loam',
        organicCarbonGKg: 4.5,
        irrigationAvailable: false,
      },
    });

    assert.notEqual(
      defaultRun.recommendations[0]?.suitabilityScore,
      phHeavyRun.recommendations[0]?.suitabilityScore,
    );
    assert.ok(phHeavyRun.appliedWeights.soilPh > defaultRun.appliedWeights.soilPh);
  });

  it('blocks recommendations when essential data is missing and clearly flags partial uncertainty', () => {
    const blocked = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
      },
    });

    assert.equal(blocked.evaluationStatus, 'insufficient_essential_data');
    assert.equal(blocked.uncertaintyLevel, 'high');
    assert.equal(blocked.recommendations.length, 0);
    assert.ok(blocked.missingDataWarnings.length >= 4);

    const partial = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        temperatureMeanC: 25.0,
        seasonalRainfallMm: 600,
        soilPh: 6.8,
      },
    });

    assert.equal(partial.evaluationStatus, 'completed_with_uncertainty');
    assert.equal(partial.uncertaintyLevel, 'high');
    assert.ok(partial.recommendations.length > 0);
    assert.equal(partial.recommendations[0]?.eligibilityStatus, 'provisional_uncertain');
    assert.ok(partial.recommendations[0].missingDataWarnings.length >= 3);
  });

  it('auto-fetches missing farm data via weather and soil repositories without fabricating unavailable fields', async () => {
    const mockWeatherRepo: IWeatherRepository = {
      fetchWeatherTelemetry: async () =>
        ({
          location: { latitude: 23.25, longitude: 77.41 },
          dateRange: { startDate: '2026-07-01', endDate: '2026-08-30' },
          dataClassification: 'observed_historical',
          forecastDisclaimer: 'Historical only',
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
            totalDays: 60,
            availableDays: 60,
            missingDays: 0,
            meanTempC: 26.2,
            maxTempC: 31.5,
            minTempC: 21.8,
            totalPrecipitationMm: 330,
            meanSolarRadiationMjM2Day: 18,
            meanRelativeHumidityPercent: 78,
            meanWindSpeedMs: 2.1,
          },
          temperatureTrend: {
            slopeCPerDay: 0,
            totalChangeC: 0,
            direction: 'stable',
            firstHalfMeanC: 26,
            secondHalfMeanC: 26.4,
            sampleCount: 60,
          },
          dailySeries: [],
          monthlySummaries: [],
          gpmImerg: null,
          sourceAttributions: [],
          sources: ['POWER'],
          retrievedAt: new Date().toISOString(),
        }) satisfies WeatherTelemetrySnapshot,
      fetchClimateTrends: async () => ({
        location: { latitude: 23.25, longitude: 77.41 },
        baselineYears: 5,
        dataClassification: 'observed_historical',
        forecastDisclaimer: 'Historical only',
        temperatureAnomalyC: 0.2,
        annualMeanTempC: 25.4,
        annualPrecipitationMm: 980,
        precipitationAnomalyPercent: 2,
        heatStressDaysTrend: 'stable',
        yearlySummaries: [],
        sources: ['POWER'],
        sourceAttributions: [],
      }),
    };

    const mockSoilRepo: ISoilRepository = {
      fetchSoilProfile: async () =>
        ({
          location: { latitude: 23.25, longitude: 77.41 },
          selectedDepthCm: '0-5',
          dataClassification: 'modelled_estimate',
          status: 'available',
          providerUsed: 'soilgrids-rest-v2',
          fallbackUsed: false,
          depthLayers: [],
          surfaceSummary: {
            depthIntervalCm: '0-5',
            textureClass: 'Clay Loam',
            ph: { mean: 6.9, q05: 6.2, q95: 7.5, uncertainty: 0.3, unit: 'pH' },
            organicCarbonGKg: { mean: 7.2, q05: 4.5, q95: 10.0, uncertainty: 0.4, unit: 'g/kg' },
            nitrogenGKg: { mean: 1.1, q05: 0.7, q95: 1.5, uncertainty: 0.4, unit: 'g/kg' },
            sandPercent: { mean: 30, q05: 20, q95: 40, uncertainty: 0.3, unit: '%' },
            siltPercent: { mean: 36, q05: 26, q95: 46, uncertainty: 0.3, unit: '%' },
            clayPercent: { mean: 34, q05: 25, q95: 44, uncertainty: 0.3, unit: '%' },
            bulkDensityKgDm3: { mean: 1.35, q05: 1.2, q95: 1.5, uncertainty: 0.2, unit: 'kg/dm³' },
            cecCmolKg: { mean: 28, q05: 20, q95: 36, uncertainty: 0.3, unit: 'cmol(c)/kg' },
            waterRetentionSummary: 'Moderate-high',
          },
          uncertaintyMethodology: 'Q0.05-Q0.95',
          wmsReferenceLayer: { serviceUrl: '', layerName: '', attribution: '' },
          sourceAttribution: {
            id: 'soilgrids',
            name: 'ISRIC SoilGrids',
            attribution: 'ISRIC',
            url: 'https://soilgrids.org',
            cached: false,
            retrievedAt: new Date().toISOString(),
          },
          caveats: [],
          retrievedAt: new Date().toISOString(),
        }) satisfies SoilProfile,
      fetchSoilMoisture: async () =>
        ({
          location: { latitude: 23.25, longitude: 77.41 },
          dataClassification: 'satellite_derived',
          status: 'unavailable',
          product: 'SMAP L4',
          units: 'm³/m³',
          observationDate: null,
          surfaceMoistureM3M3: null,
          rootZoneMoistureM3M3: null,
          surfaceMoistureBinM3M3: null,
          rootZoneMoistureBinM3M3: null,
          moistureSeries: [],
          retrievalConfidenceNote: 'Unavailable in mock test',
          sourceAttribution: {
            id: 'smap',
            name: 'NASA SMAP',
            attribution: 'NASA',
            url: 'https://smap.jpl.nasa.gov',
            cached: false,
            retrievedAt: new Date().toISOString(),
          },
          retrievedAt: new Date().toISOString(),
        }) satisfies SoilMoistureSnapshot,
    };

    const repo = new CropIntelligenceRepository({
      cropKnowledgeRepository: knowledgeRepo,
      weatherRepository: mockWeatherRepo,
      soilRepository: mockSoilRepo,
    });

    const result = await repo.evaluateSuitability({
      location: { latitude: 23.25, longitude: 77.41 },
      inputs: {
        targetSeason: 'Kharif',
        state: 'Madhya Pradesh',
      },
    });

    assert.equal(result.evaluationStatus, 'completed_with_uncertainty');
    const recommendedIds = result.recommendations.map((c) => c.cropId);
    assert.ok(recommendedIds.slice(0, 3).includes('soybean'));
    const soybeanRec = result.recommendations.find((c) => c.cropId === 'soybean')!;
    assert.ok(soybeanRec.suitabilityScore >= 85);
    assert.equal(soybeanRec.uncertaintyLevel, 'moderate');
    assert.ok(soybeanRec.missingDataWarnings.some((w) => w.includes('SMAP')));
    assert.ok(result.missingDataWarnings.some((w) => w.includes('SMAP')));
  });

  it('serves POST /api/v1/crops/suitability with deterministic recommendations and Zod validation', async () => {
    const validRes = await fetch(`${baseUrl}/api/v1/crops/suitability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 23.2599, longitude: 77.4126 },
        autoFetchMissingFarmData: false,
        inputs: {
          targetSeason: 'Kharif',
          agroClimaticZoneId: 'acz-08-central-plateau-hills',
          state: 'Madhya Pradesh',
          irrigationAvailable: false,
          temperatureMeanC: 25.5,
          seasonalRainfallMm: 620,
          soilMoistureM3M3: 0.25,
          soilPh: 6.7,
          soilTexture: 'Clay Loam',
          organicCarbonGKg: 7.4,
        },
      }),
    });

    assert.equal(validRes.status, 200);
    const body = (await validRes.json()) as ApiSuccessResponse<CropIntelligenceResult>;
    assert.equal(body.success, true);
    assert.equal(body.data.recommendations[0]?.cropId, 'soybean');
    assert.equal(body.data.evaluationStatus, 'completed');

    const invalidRes = await fetch(`${baseUrl}/api/v1/crops/suitability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 23.2599, longitude: 77.4126 },
        weights: { temperature: 0, rainfall: 0, soilPh: 0 },
      }),
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as ApiErrorResponse;
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
  });
});
