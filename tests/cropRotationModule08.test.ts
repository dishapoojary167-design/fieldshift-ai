import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import {
  evaluateRotationStrategies,
  generateRotationStrategies,
  normalizeRotationWeights,
} from '../server/engines/CropRotationEngine.ts';
import { CropRotationRepository } from '../server/repositories/implementations/CropRotationRepository.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import type { ISoilRepository, IWeatherRepository } from '../server/repositories/interfaces/index.ts';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  RegionalRotationRule,
  RotationPlannerResult,
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

const MAHARASHTRA_RULES: RegionalRotationRule[] = [
  {
    id: 'in-mh-rule-legume-cereal',
    countryCode: 'IN',
    regionCode: 'IN-MH',
    title: 'Legume-Cereal Nitrogen Replenishment Cycle',
    ruleType: 'nitrogen_replenishment',
    precedingCategories: ['cereal', 'millet', 'fiber'],
    recommendedFollowingCategories: ['pulse', 'oilseed'],
    rationale: 'Following cereals or millets with pulses restores biological nitrogen reserves.',
    soilHealthImpact: 'Improves available soil nitrogen and residue balance.',
  },
];

describe('Module 8: Intelligent Crop Rotation Planner & /api/v1/rotation/*', async () => {
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

  it('serves POST /api/v1/rotation/generate with Existing, Alternative A/B, User-Defined sequence, and Zod validation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/rotation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.8762, longitude: 75.3433 },
        autoFetchMissingFarmData: false,
        currentCrop: 'Sorghum',
        preferences: {
          farmingSystem: 'rainfed',
          waterConservationPriority: 'high',
          soilImprovementPriority: 'high',
          diversificationPreference: 'high',
          startingSeason: 'Kharif',
          seasonsCount: 4,
        },
        customSequence: [
          { year: 1, season: 'Kharif', cropId: 'soybean', cropName: 'Soybean' },
          { year: 1, season: 'Rabi', cropId: 'chickpea', cropName: 'Chickpea' },
          { year: 2, season: 'Kharif', cropId: 'pearl-millet', cropName: 'Pearl Millet' },
          { year: 2, season: 'Rabi', cropId: 'sorghum', cropName: 'Sorghum' },
        ],
        inputs: {
          agroClimaticZoneId: 'acz-09-western-plateau-hills',
          state: 'Maharashtra',
          temperatureMeanC: 26.5,
          seasonalRainfallMm: 640,
          soilMoistureM3M3: 0.25,
          soilPh: 7.1,
          soilPhSource: 'measured_lab',
          soilTexture: 'Clay Loam',
          organicCarbonGKg: 7.1,
        },
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ApiSuccessResponse<RotationPlannerResult>;
    assert.equal(body.success, true);

    const data = body.data;
    assert.ok(data.deterministicNoAiNotice.toLowerCase().includes('independent of gemini'));
    assert.ok(data.modelScopeDisclaimer.toLowerCase().includes('not quantitative yield'));
    assert.equal(data.strategies.length, 4);
    assert.deepEqual(
      data.strategies.map((s) => s.strategyId),
      ['existing', 'alternative_a', 'alternative_b', 'user_defined'],
    );
    for (const s of data.strategies) {
      assert.equal(s.slots.length, 4);
      assert.ok(s.overallScore >= 0 && s.overallScore <= 100);
      assert.ok(s.indicators.estimatedSeasonalWaterDemand.estimationNote.length > 0);
      assert.ok(s.indicators.soilHealthConsiderations.noFabricatedSocNotice.toLowerCase().includes('cannot be quantitatively predicted'));
    }

    assert.ok(data.regionalRulesApplied.length >= 1);
    assert.ok(data.recommendation.whyPreferred.length > 0);
    assert.ok(data.recommendation.environmentalAdvantages.length > 0);
    assert.ok(data.recommendation.possibleDisadvantages.length > 0);
    assert.ok(data.recommendation.importantUncertainties.length > 0);
    assert.ok(data.recommendation.informationToImprove.length > 0);

    // Invalid payload: seasonsCount < 3 and zero weights -> 400 VALIDATION_ERROR
    const invalidRes = await fetch(`${baseUrl}/api/v1/rotation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.8762, longitude: 75.3433 },
        preferences: { seasonsCount: 2 },
        indicatorWeights: {
          diversity: 0,
          waterEfficiency: 0,
          nitrogenAndNutrientBalance: 0,
          soilHealth: 0,
          seasonalAndRegionalFit: 0,
          pestBreakAndRisk: 0,
        },
      }),
    });
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as ApiErrorResponse;
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
  });

  it('serves POST /api/v1/rotation/compare to evaluate and rank user-edited strategies side-by-side', async () => {
    const res = await fetch(`${baseUrl}/api/v1/rotation/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 19.8762, longitude: 75.3433 },
        autoFetchMissingFarmData: false,
        preferences: {
          farmingSystem: 'rainfed',
          waterConservationPriority: 'high',
          soilImprovementPriority: 'high',
        },
        inputs: {
          agroClimaticZoneId: 'acz-09-western-plateau-hills',
          state: 'Maharashtra',
          temperatureMeanC: 26.2,
          seasonalRainfallMm: 610,
          soilMoistureM3M3: 0.24,
          soilPh: 7.2,
          soilTexture: 'Clay Loam',
          organicCarbonGKg: 6.5,
        },
        strategies: [
          {
            id: 'existing',
            label: 'Monoculture Cereal Baseline',
            sequence: [
              { year: 1, season: 'Kharif', cropId: 'sorghum', cropName: 'Sorghum' },
              { year: 1, season: 'Rabi', cropId: 'sorghum', cropName: 'Sorghum' },
              { year: 2, season: 'Kharif', cropId: 'sorghum', cropName: 'Sorghum' },
            ],
          },
          {
            id: 'alternative_a',
            label: 'Soybean-Chickpea-Millet Sequence',
            sequence: [
              { year: 1, season: 'Kharif', cropId: 'soybean', cropName: 'Soybean' },
              { year: 1, season: 'Rabi', cropId: 'chickpea', cropName: 'Chickpea' },
              { year: 2, season: 'Kharif', cropId: 'pearl-millet', cropName: 'Pearl Millet' },
            ],
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ApiSuccessResponse<RotationPlannerResult>;
    assert.equal(body.success, true);
    assert.equal(body.data.recommendation.preferredStrategyId, 'alternative_a');

    const baseline = body.data.strategies.find((s) => s.strategyId === 'existing')!;
    const diversified = body.data.strategies.find((s) => s.strategyId === 'alternative_a')!;
    assert.equal(baseline.isEligible, false);
    assert.equal(diversified.isEligible, true);
    assert.ok(diversified.overallScore > baseline.overallScore);
  });

  it('detects incompatible seasons, consecutive monoculture repeats, same-family Poaceae carryover, and Kharif->Rabi duration squeeze', () => {
    const weights = normalizeRotationWeights();
    const result = evaluateRotationStrategies({
      location: { latitude: 19.8762, longitude: 75.3433 },
      crops: allCrops,
      regionalRules: MAHARASHTRA_RULES,
      strictRegionFilter: false,
      weights,
      preferences: {
        farmingSystem: 'rainfed',
        irrigationAvailable: false,
        waterConservationPriority: 'high',
        soilImprovementPriority: 'high',
        diversificationPreference: 'high',
      },
      inputs: {
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
        state: 'Maharashtra',
        irrigationAvailable: false,
        temperatureMeanC: 26.0,
        seasonalRainfallMm: 620,
        soilMoistureM3M3: 0.25,
        soilPh: 7.0,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
      strategies: [
        {
          id: 'existing',
          label: 'Problematic Sequence',
          sequence: [
            // Slot 0: Long-duration Pigeon Pea in Kharif
            { year: 1, season: 'Kharif', cropId: 'pigeonpea', cropName: 'Pigeon Pea' },
            // Slot 1: Soybean in Rabi (INCOMPATIBLE SEASON!) + duration squeeze after Pigeon Pea
            { year: 1, season: 'Rabi', cropId: 'soybean', cropName: 'Soybean' },
            // Slot 2: Sorghum in Kharif (Poaceae)
            { year: 2, season: 'Kharif', cropId: 'sorghum', cropName: 'Sorghum' },
            // Slot 3: Wheat in Rabi (Poaceae -> Poaceae family repeat + irrigated crop in rainfed system)
            { year: 2, season: 'Rabi', cropId: 'wheat', cropName: 'Wheat' },
            // Slot 4: Wheat in Rabi again (same crop repeat!)
            { year: 3, season: 'Rabi', cropId: 'wheat', cropName: 'Wheat' },
          ],
        },
        {
          id: 'alternative_a',
          label: 'Healthy Diversified Sequence',
          sequence: [
            { year: 1, season: 'Kharif', cropId: 'soybean', cropName: 'Soybean' },
            { year: 1, season: 'Rabi', cropId: 'sorghum', cropName: 'Sorghum' },
            { year: 2, season: 'Kharif', cropId: 'groundnut', cropName: 'Groundnut' },
          ],
        },
      ],
    });

    const bad = result.strategies[0];
    assert.equal(bad.isEligible, false);
    assert.equal(bad.slots[1].seasonalMatch, false);
    assert.ok(bad.slots[1].transitionFromPrevious?.durationConflictNote?.includes('Squeeze') || bad.slots[1].transitionFromPrevious?.durationConflictNote?.includes('squeezing'));
    assert.equal(bad.slots[3].transitionFromPrevious?.familyRepeated, true);
    assert.equal(bad.slots[3].transitionFromPrevious?.sequenceStatus, 'caution');
    assert.equal(bad.slots[4].transitionFromPrevious?.cropRepeated, true);
    assert.equal(bad.slots[4].transitionFromPrevious?.sequenceStatus, 'incompatible');
    assert.ok(bad.indicators.cropDiversity.consecutiveFamilyRepeats >= 2);
    assert.equal(bad.indicators.cropDiversity.consecutiveCropRepeats, 1);
    assert.ok(bad.indicators.agronomicRisk.pestAndDiseaseCarryoverCount >= 2);
    assert.equal(bad.indicators.agronomicRisk.riskLevel, 'high');
    assert.ok(bad.indicators.agronomicRisk.constraintViolations.length >= 2);

    const healthy = result.strategies[1];
    assert.equal(healthy.isEligible, true);
    assert.equal(healthy.indicators.cropDiversity.consecutiveCropRepeats, 0);
    assert.equal(healthy.indicators.cropDiversity.consecutiveFamilyRepeats, 0);
    assert.equal(result.recommendation.preferredStrategyId, 'alternative_a');
  });

  it('enforces regional crop calendar constraints when strictRegionFilter is enabled', () => {
    const result = evaluateRotationStrategies({
      location: { latitude: 19.8762, longitude: 75.3433 },
      crops: allCrops,
      regionalRules: MAHARASHTRA_RULES,
      strictRegionFilter: true,
      preferences: {
        farmingSystem: 'irrigated',
        irrigationAvailable: true,
      },
      inputs: {
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
        state: 'Maharashtra',
        irrigationAvailable: true,
        temperatureMeanC: 26.5,
        seasonalRainfallMm: 800,
        soilMoistureM3M3: 0.28,
        soilPh: 7.0,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
      strategies: [
        {
          id: 'user_defined',
          label: 'Out-of-Zone Sequence',
          sequence: [
            // Rice is documented for acz-04/05/07 in the knowledge base, not acz-09 Western Plateau & Hills
            { year: 1, season: 'Kharif', cropId: 'rice', cropName: 'Rice' },
            // Indian Mustard is documented for acz-04/05/06/08, not acz-09
            { year: 1, season: 'Rabi', cropId: 'indian-mustard', cropName: 'Indian Mustard' },
            { year: 2, season: 'Kharif', cropId: 'soybean', cropName: 'Soybean' },
          ],
        },
      ],
    });

    const evaluated = result.strategies[0];
    assert.equal(evaluated.slots[0].regionalMatch, false);
    assert.equal(evaluated.slots[1].regionalMatch, false);
    assert.equal(evaluated.slots[2].regionalMatch, true);
    assert.equal(evaluated.isEligible, false);
    assert.ok(
      evaluated.indicators.agronomicRisk.constraintViolations.some((v) =>
        v.includes('outside documented regional suitability'),
      ),
    );
  });

  it('handles missing environmental data transparently with uncertainty flags and penalty without fabricating values', () => {
    const commonProps = {
      location: { latitude: 19.8762, longitude: 75.3433 },
      crops: allCrops,
      regionalRules: MAHARASHTRA_RULES,
      strictRegionFilter: false,
      preferences: {
        farmingSystem: 'rainfed' as const,
        irrigationAvailable: false,
      },
      strategies: [
        {
          id: 'alternative_a' as const,
          label: 'Soybean-Chickpea-Sorghum',
          sequence: [
            { year: 1, season: 'Kharif' as const, cropId: 'soybean', cropName: 'Soybean' },
            { year: 1, season: 'Rabi' as const, cropId: 'chickpea', cropName: 'Chickpea' },
            { year: 2, season: 'Kharif' as const, cropId: 'sorghum', cropName: 'Sorghum' },
          ],
        },
      ],
    };

    const complete = evaluateRotationStrategies({
      ...commonProps,
      inputs: {
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
        state: 'Maharashtra',
        irrigationAvailable: false,
        temperatureMeanC: 26.0,
        seasonalRainfallMm: 620,
        soilMoistureM3M3: 0.25,
        soilPh: 7.0,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
    });

    const missingEnv = evaluateRotationStrategies({
      ...commonProps,
      inputs: {
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
        state: 'Maharashtra',
        // Missing temperature, rainfall, SMAP moisture, soil pH, soil texture, and OC
      },
    });

    assert.equal(complete.dataCompletenessPercent, 100);
    assert.equal(complete.uncertaintyLevel, 'low');

    assert.ok(missingEnv.dataCompletenessPercent < 30);
    assert.equal(missingEnv.uncertaintyLevel, 'high');
    assert.ok(missingEnv.missingDataWarnings.length >= 5);
    assert.equal(missingEnv.strategies[0].slots[0].soilTextureAndDrainageFit, 'unknown');
    assert.ok(missingEnv.strategies[0].overallScore < complete.strategies[0].overallScore);
    assert.ok(missingEnv.recommendation.informationToImprove.length >= 4);
    assert.equal(missingEnv.evaluatedInputs.soilPh, undefined);
    assert.equal(missingEnv.evaluatedInputs.soilMoistureM3M3, undefined);
  });

  it('auto-fetches available NASA/SoilGrids data in CropRotationRepository and gracefully reports rejected providers', async () => {
    const failingWeatherRepo: IWeatherRepository = {
      fetchWeatherTelemetry: async () => {
        throw new Error('NASA POWER upstream timeout');
      },
      fetchClimateTrends: async () => {
        throw new Error('Climate baseline timeout');
      },
    };

    const partialSoilRepo: ISoilRepository = {
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
            ph: { mean: 7.3, q05: 6.7, q95: 7.9, uncertainty: 0.3, unit: 'pH' },
            organicCarbonGKg: { mean: 6.4, q05: 4.2, q95: 8.5, uncertainty: 0.4, unit: 'g/kg' },
            nitrogenGKg: { mean: 0.8, q05: 0.5, q95: 1.1, uncertainty: 0.4, unit: 'g/kg' },
            sandPercent: { mean: 27, q05: 20, q95: 36, uncertainty: 0.3, unit: '%' },
            siltPercent: { mean: 35, q05: 26, q95: 44, uncertainty: 0.3, unit: '%' },
            clayPercent: { mean: 38, q05: 29, q95: 47, uncertainty: 0.3, unit: '%' },
            bulkDensityKgDm3: { mean: 1.37, q05: 1.24, q95: 1.49, uncertainty: 0.2, unit: 'kg/dm³' },
            cecCmolKg: { mean: 31, q05: 24, q95: 39, uncertainty: 0.3, unit: 'cmol(c)/kg' },
            waterRetentionSummary: 'Vertic retention',
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
      fetchSoilMoisture: async () => {
        throw new Error('NASA SMAP unavailable');
      },
    };

    const repo = new CropRotationRepository({
      cropKnowledgeRepository: knowledgeRepo,
      weatherRepository: failingWeatherRepo,
      soilRepository: partialSoilRepo,
    });

    const generated = await repo.generateRotationStrategies({
      location: { latitude: 19.8762, longitude: 75.3433 },
      currentCrop: 'Soybean',
      preferences: {
        farmingSystem: 'rainfed',
        seasonsCount: 4,
      },
      inputs: {
        state: 'Maharashtra',
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
      },
    });

    assert.equal(generated.evaluatedInputs.soilPh, 7.3);
    assert.equal(generated.evaluatedInputs.soilTexture, 'Clay Loam');
    assert.equal(generated.evaluatedInputs.temperatureMeanC, undefined);
    assert.ok(generated.caveats.some((c) => c.includes('NASA POWER')));
    assert.ok(generated.caveats.some((c) => c.includes('NASA SMAP')));
    assert.ok(generated.strategies.length === 3);
  });

  it('generates distinct Existing, Alternative A, and Alternative B sequences for Maharashtra', () => {
    const strategies = generateRotationStrategies({
      location: { latitude: 19.8762, longitude: 75.3433 },
      crops: allCrops,
      strictRegionFilter: true,
      currentCrop: 'Sorghum',
      preferences: {
        farmingSystem: 'rainfed',
        irrigationAvailable: false,
        waterConservationPriority: 'high',
        soilImprovementPriority: 'high',
        diversificationPreference: 'high',
        startingSeason: 'Kharif',
        seasonsCount: 4,
      },
      inputs: {
        state: 'Maharashtra',
        agroClimaticZoneId: 'acz-09-western-plateau-hills',
        temperatureMeanC: 26.5,
        seasonalRainfallMm: 620,
        soilMoistureM3M3: 0.25,
        soilPh: 7.1,
        soilTexture: 'Clay Loam',
        organicCarbonGKg: 7.0,
      },
    });

    assert.equal(strategies.length, 3);
    const existingSeq = strategies[0].sequence.map((s) => s.cropId).join(',');
    const altASeq = strategies[1].sequence.map((s) => s.cropId).join(',');
    const altBSeq = strategies[2].sequence.map((s) => s.cropId).join(',');

    assert.notEqual(altASeq, existingSeq);
    assert.notEqual(altBSeq, altASeq);
  });
});
