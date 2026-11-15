import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { evaluateCropSuitability } from '../server/engines/CropSuitabilityEngine.ts';
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

describe('Module 7: Explainable Crop Recommendation Engine & /api/v1/crops/recommend', async () => {
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

  it('serves POST /api/v1/crops/recommend with full Module 07 structured output and Zod validation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/crops/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.8762, longitude: 75.3433 },
        autoFetchMissingFarmData: false,
        preferences: {
          growingSeason: 'Kharif',
          farmingSystem: 'rainfed',
          currentCrop: 'Sorghum',
          waterConservationPriority: 'high',
          soilImprovementPriority: 'high',
          diversificationPreference: 'high',
        },
        pillarWeights: {
          waterAvailability: 45,
          temperature: 15,
          soilPh: 15,
          soilHealth: 15,
          seasonalCompatibility: 10,
        },
        inputs: {
          agroClimaticZoneId: 'acz-09-western-plateau-hills',
          state: 'Maharashtra',
          temperatureMeanC: 26.8,
          temperatureMaxC: 32.5,
          temperatureMinC: 21.5,
          seasonalRainfallMm: 640,
          gpmPrecipitationRateMmHr: 2.4,
          soilMoistureM3M3: 0.25,
          soilPh: 7.1,
          soilPhSource: 'measured_lab',
          soilTexture: 'Clay Loam',
          soilTextureSource: 'measured_lab',
          organicCarbonGKg: 7.2,
          organicCarbonSource: 'measured_lab',
        },
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ApiSuccessResponse<CropIntelligenceResult>;
    assert.equal(body.success, true);

    const data = body.data;
    assert.equal(data.evaluationStatus, 'completed');
    assert.ok(data.deterministicNoAiNotice.toLowerCase().includes('independent of gemini'));
    assert.ok(data.suitabilityVsYieldDisclaimer.toLowerCase().includes('not crop yield'));
    assert.equal(data.preferencesApplied.growingSeason, 'Kharif');
    assert.equal(data.preferencesApplied.farmingSystem, 'rainfed');
    assert.equal(data.preferencesApplied.irrigationAvailable, false);
    assert.equal(data.preferencesApplied.currentCrop, 'Sorghum');

    assert.ok(data.recommendations.length > 0);
    const top = data.recommendations[0];
    assert.ok(top.cropName.length > 0);
    assert.ok(top.suitabilityScore >= 0 && top.suitabilityScore <= 100);
    assert.ok(
      [
        'Highly Suitable',
        'Moderately Suitable',
        'Marginally Suitable',
        'Unsuitable',
        'Insufficient Data',
      ].includes(top.suitabilityCategory),
    );
    assert.equal(top.factorScores.length, 8);
    assert.ok(top.supportingObservations.length >= 6);
    assert.ok(
      top.supportingObservations.some(
        (obs) => obs.parameter === 'gpmPrecipitationRateMmHr' && obs.status === 'available',
      ),
    );
    assert.ok(top.soilCompatibility.summary.length > 0);
    assert.ok(top.soilCompatibility.phFit.length > 0);
    assert.equal(top.seasonalSuitability.targetSeason, 'Kharif');
    assert.equal(top.seasonalSuitability.matchesTargetSeason, true);
    assert.ok(top.waterRequirementDetail.category);
    assert.ok(top.dataConfidence.score >= 85);
    assert.equal(top.dataConfidence.level, 'high');
    assert.ok(top.explanation.toLowerCase().includes('not predicted yield'));

    assert.ok(data.excludedCrops.length > 0);
    const excluded = data.excludedCrops[0];
    assert.ok(excluded.rejectionReasons.length > 0);

    // Invalid pillarWeights (all zeros) returns 400 VALIDATION_ERROR
    const invalidRes = await fetch(`${baseUrl}/api/v1/crops/recommend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.8762, longitude: 75.3433 },
        pillarWeights: { waterAvailability: 0, temperature: 0, soilPh: 0 },
      }),
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as ApiErrorResponse;
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
  });

  it('applies water conservation, soil improvement, and diversification preferences deterministically', () => {
    const baseline = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      strictRegionFilter: false,
      inputs: {
        targetSeason: 'Kharif',
        irrigationAvailable: true,
        temperatureMeanC: 27.0,
        seasonalRainfallMm: 950,
        soilMoistureM3M3: 0.3,
        soilPh: 6.8,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
    });

    const conservationAndDiv = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      strictRegionFilter: false,
      preferences: {
        growingSeason: 'Kharif',
        farmingSystem: 'irrigated',
        currentCrop: 'Rice',
        waterConservationPriority: 'high',
        soilImprovementPriority: 'high',
        diversificationPreference: 'high',
      },
      inputs: {
        temperatureMeanC: 27.0,
        seasonalRainfallMm: 950,
        soilMoistureM3M3: 0.3,
        soilPh: 6.8,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
    });

    const baseRice = baseline.recommendations.find((c) => c.cropId === 'rice')!;
    const prefRice = conservationAndDiv.recommendations.find((c) => c.cropId === 'rice')!;
    const baseSoybean = baseline.recommendations.find((c) => c.cropId === 'soybean')!;
    const prefSoybean = conservationAndDiv.recommendations.find((c) => c.cropId === 'soybean')!;

    assert.ok(baseRice && prefRice && baseSoybean && prefSoybean);
    // Rice gets penalized for high water demand + monoculture repeat after Rice + cereal extractive N
    assert.ok(
      prefRice.suitabilityScore < baseRice.suitabilityScore,
      `Expected Rice score to drop under conservation+monoculture (${prefRice.suitabilityScore} < ${baseRice.suitabilityScore})`,
    );
    // Soybean gets boosted for biological N-fixation + crop diversification away from Rice
    assert.ok(
      prefSoybean.suitabilityScore >= baseSoybean.suitabilityScore,
      `Expected Soybean score to rise or hold high under soil improvement + diversification`,
    );
    assert.ok(
      prefSoybean.preferenceAdjustments.some((a) => a.factor.includes('Soil Improvement')),
    );
    assert.ok(
      prefSoybean.preferenceAdjustments.some((a) => a.factor.includes('Diversification')),
    );
  });

  it('penalizes missing inputs explicitly rather than silently assigning ideal scores and guards insufficient data', () => {
    const completeRun = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        agroClimaticZoneId: 'acz-08-central-plateau-hills',
        state: 'Madhya Pradesh',
        irrigationAvailable: false,
        temperatureMeanC: 25.5,
        seasonalRainfallMm: 620,
        soilMoistureM3M3: 0.25,
        soilPh: 6.8,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.5,
      },
    });

    const partialRun = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        agroClimaticZoneId: 'acz-08-central-plateau-hills',
        state: 'Madhya Pradesh',
        irrigationAvailable: false,
        temperatureMeanC: 25.5,
        seasonalRainfallMm: 620,
        soilPh: 6.8,
        soilTexture: 'Clay Loam',
        // Missing soilMoistureM3M3 and organicCarbonGKg
      },
    });

    const completeTop = completeRun.recommendations.find((c) => c.cropId === 'soybean')!;
    const partialTop = partialRun.recommendations.find((c) => c.cropId === 'soybean')!;

    assert.equal(completeTop.dataConfidence.missingDataPenaltyPoints, 0);
    assert.ok(partialTop.dataConfidence.missingDataPenaltyPoints > 0);
    assert.ok(partialTop.dataConfidence.score < completeTop.dataConfidence.score);
    assert.ok(
      partialTop.suitabilityScore < completeTop.suitabilityScore,
      `Expected missing-data penalty to reduce score (${partialTop.suitabilityScore} < ${completeTop.suitabilityScore})`,
    );

    const blockedRun = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      inputs: {
        targetSeason: 'Kharif',
        temperatureMeanC: 26.0,
        // Fewer than 2 of the 4 core environmental/soil dimensions -> insufficient data
      },
    });

    assert.equal(blockedRun.evaluationStatus, 'insufficient_essential_data');
    assert.equal(blockedRun.recommendations.length, 0);
  });

  it('enforces seasonal compatibility and farmingSystem constraints directly via preferences', () => {
    const rabiRainfed = evaluateCropSuitability({
      location: { latitude: 23.2599, longitude: 77.4126 },
      crops: allCrops,
      preferences: {
        growingSeason: 'Rabi',
        farmingSystem: 'rainfed',
      },
      inputs: {
        agroClimaticZoneId: 'acz-08-central-plateau-hills',
        state: 'Madhya Pradesh',
        temperatureMeanC: 19.5,
        seasonalRainfallMm: 210,
        soilMoistureM3M3: 0.24,
        soilPh: 7.2,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 6.5,
      },
    });

    const excludedIds = new Map(
      rabiRainfed.excludedCrops.map((c) => [c.cropId, c.hardConstraintsFailed.map((h) => h.code)]),
    );
    // Kharif-only Soybean and Pearl Millet must be excluded by INCOMPATIBLE_SEASON even when season came via preferences
    assert.ok(excludedIds.get('soybean')?.includes('INCOMPATIBLE_SEASON'));
    assert.ok(excludedIds.get('pearl-millet')?.includes('INCOMPATIBLE_SEASON'));
    // Low-rainfall Wheat must be excluded under farmingSystem: 'rainfed' (irrigationAvailable: false)
    assert.ok(excludedIds.get('wheat')?.includes('SEVERE_WATER_DEFICIT'));

    // Chickpea (rainfed Rabi pulse in Central Plateau & Hills) should remain eligible with seasonal sowing window metadata
    const chickpea = rabiRainfed.recommendations.find((c) => c.cropId === 'chickpea');
    assert.ok(chickpea);
    assert.equal(chickpea.seasonalSuitability.matchesTargetSeason, true);
    assert.ok(chickpea.seasonalSuitability.sowingWindow);
  });

  it('auto-fetches GPM IMERG rainfall rate alongside POWER, SoilGrids, and SMAP in CropIntelligenceRepository', async () => {
    const mockWeatherRepo: IWeatherRepository = {
      fetchWeatherTelemetry: async () =>
        ({
          location: { latitude: 19.87, longitude: 75.34 },
          dateRange: { startDate: '2026-07-01', endDate: '2026-09-28' },
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
            totalDays: 90,
            availableDays: 90,
            missingDays: 0,
            meanTempC: 26.4,
            maxTempC: 32.0,
            minTempC: 21.5,
            totalPrecipitationMm: 610,
            meanSolarRadiationMjM2Day: 17.5,
            meanRelativeHumidityPercent: 79,
            meanWindSpeedMs: 2.3,
          },
          temperatureTrend: {
            slopeCPerDay: 0,
            totalChangeC: 0,
            direction: 'stable',
            firstHalfMeanC: 26.4,
            secondHalfMeanC: 26.4,
            sampleCount: 90,
          },
          dailySeries: [],
          monthlySummaries: [],
          gpmImerg: {
            status: 'available',
            provider: 'NASA GPM IMERG Early',
            product: 'IMERG Early Half-Hourly',
            precipitationRateMmHr: 1.85,
            units: 'mm/hr',
            observationTimestamp: '2026-09-28T06:00:00Z',
          },
          sourceAttributions: [],
          sources: ['POWER', 'GPM'],
          retrievedAt: new Date().toISOString(),
        }) satisfies WeatherTelemetrySnapshot,
      fetchClimateTrends: async () => ({
        location: { latitude: 19.87, longitude: 75.34 },
        baselineYears: 5,
        dataClassification: 'observed_historical',
        forecastDisclaimer: 'Historical only',
        temperatureAnomalyC: 0.3,
        annualMeanTempC: 26.0,
        annualPrecipitationMm: 780,
        precipitationAnomalyPercent: -3,
        heatStressDaysTrend: 'stable',
        yearlySummaries: [],
        sources: ['POWER'],
        sourceAttributions: [],
      }),
    };

    const mockSoilRepo: ISoilRepository = {
      fetchSoilProfile: async () =>
        ({
          location: { latitude: 19.87, longitude: 75.34 },
          selectedDepthCm: '0-5',
          dataClassification: 'modelled_estimate',
          status: 'available',
          providerUsed: 'soilgrids-rest-v2',
          fallbackUsed: false,
          depthLayers: [],
          surfaceSummary: {
            depthIntervalCm: '0-5',
            textureClass: 'Clay Loam',
            ph: { mean: 7.1, q05: 6.4, q95: 7.7, uncertainty: 0.3, unit: 'pH' },
            organicCarbonGKg: { mean: 6.8, q05: 4.5, q95: 9.2, uncertainty: 0.4, unit: 'g/kg' },
            nitrogenGKg: { mean: 0.9, q05: 0.6, q95: 1.2, uncertainty: 0.4, unit: 'g/kg' },
            sandPercent: { mean: 28, q05: 20, q95: 38, uncertainty: 0.3, unit: '%' },
            siltPercent: { mean: 35, q05: 25, q95: 45, uncertainty: 0.3, unit: '%' },
            clayPercent: { mean: 37, q05: 28, q95: 46, uncertainty: 0.3, unit: '%' },
            bulkDensityKgDm3: { mean: 1.38, q05: 1.25, q95: 1.5, uncertainty: 0.2, unit: 'kg/dm³' },
            cecCmolKg: { mean: 32, q05: 24, q95: 40, uncertainty: 0.3, unit: 'cmol(c)/kg' },
            waterRetentionSummary: 'High vertic retention',
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
          location: { latitude: 19.87, longitude: 75.34 },
          dataClassification: 'satellite_derived',
          status: 'available',
          product: 'SMAP L4',
          units: 'm³/m³',
          observationDate: '2026-09-28',
          surfaceMoistureM3M3: 0.23,
          rootZoneMoistureM3M3: 0.26,
          surfaceMoistureBinM3M3: [0.2, 0.26],
          rootZoneMoistureBinM3M3: [0.23, 0.29],
          moistureSeries: [],
          retrievalConfidenceNote: 'Available',
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
      location: { latitude: 19.87, longitude: 75.34 },
      preferences: {
        growingSeason: 'Kharif',
        farmingSystem: 'rainfed',
      },
      inputs: {
        state: 'Maharashtra',
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
      },
    });

    assert.equal(result.evaluationStatus, 'completed');
    assert.equal(result.evaluatedInputs.gpmPrecipitationRateMmHr, 1.85);
    assert.equal(result.gpmImergObservation?.precipitationRateMmHr, 1.85);
    assert.ok(result.recommendations.length > 0);
    assert.ok(
      result.recommendations[0].supportingObservations.some(
        (obs) => obs.parameter === 'gpmPrecipitationRateMmHr' && obs.observedValue.includes('1.85'),
      ),
    );
  });
});
