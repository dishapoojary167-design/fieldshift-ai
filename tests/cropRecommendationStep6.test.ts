import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { DEFAULT_SUITABILITY_WEIGHTS } from '../server/engines/CropSuitabilityEngine.ts';
import { CropIntelligenceRepository } from '../server/repositories/implementations/CropIntelligenceRepository.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import type { ISoilRepository, IWeatherRepository } from '../server/repositories/interfaces/index.ts';
import { FarmEnvironmentalContextService } from '../server/services/implementations/FarmEnvironmentalContextService.ts';
import type {
  ApiSuccessResponse,
  CropIntelligenceResult,
  GeoCoordinates,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../shared/index.ts';

function buildWeatherRepoForLocations(
  byLocation: (loc: GeoCoordinates) => {
    telemetry: WeatherTelemetrySnapshot;
    annualPrecipitationMm: number | null;
  },
): IWeatherRepository {
  return {
    fetchWeatherTelemetry: async (req) => {
      const target = req.location ?? req.boundary?.centroid;
      if (!target) throw new Error('Missing location/centroid in test stub');
      return byLocation(target).telemetry;
    },
    fetchClimateTrends: async (query) => {
      const cfg = byLocation({ latitude: query.latitude, longitude: query.longitude });
      return {
        location: { latitude: query.latitude, longitude: query.longitude },
        baselineYears: 5,
        dataClassification: 'observed_historical',
        forecastDisclaimer: 'Historical NASA POWER observations only, not a future forecast.',
        temperatureAnomalyC: 0.2,
        annualMeanTempC: cfg.telemetry.summary.meanTempC,
        annualPrecipitationMm: cfg.annualPrecipitationMm,
        precipitationAnomalyPercent: 0,
        heatStressDaysTrend: 'stable',
        yearlySummaries: [],
        sources: ['POWER'],
        sourceAttributions: [],
      };
    },
  };
}

function buildSoilRepoForLocations(
  byLocation: (loc: GeoCoordinates) => {
    profile: SoilProfile;
    moisture: SoilMoistureSnapshot;
  },
): ISoilRepository {
  return {
    fetchSoilProfile: async (req) => {
      const target = req.location ?? req.boundary?.centroid;
      if (!target) throw new Error('Missing location/centroid in test stub');
      return byLocation(target).profile;
    },
    fetchSoilMoisture: async (req) => {
      const target = req.location ?? req.boundary?.centroid;
      if (!target) throw new Error('Missing location/centroid in test stub');
      return byLocation(target).moisture;
    },
  };
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeTelemetry(params: {
  location: GeoCoordinates;
  endDate: string;
  startDate?: string;
  availableDays?: number;
  meanTempC: number | null;
  maxTempC: number | null;
  minTempC: number | null;
  totalPrecipitationMm: number;
  dailyPrecipValues?: Array<number | null>;
  humidity?: number | null;
  solar?: number | null;
  wind?: number | null;
  gpmRateMmHr?: number | null;
  gpmTimestamp?: string | null;
}): WeatherTelemetrySnapshot {
  const days = params.availableDays ?? 30;
  const startDate = params.startDate ?? daysAgoIso(days + 4);
  const dailySeries = (params.dailyPrecipValues ?? [params.totalPrecipitationMm / days]).map(
    (precip, idx) => ({
      date: idx === (params.dailyPrecipValues?.length ?? 1) - 1 ? params.endDate : startDate,
      temperatureMeanC: params.meanTempC,
      temperatureMaxC: params.maxTempC,
      temperatureMinC: params.minTempC,
      precipitationMmDay: precip,
      cumulativePrecipitationMm: params.totalPrecipitationMm,
      solarRadiationMjM2Day: params.solar ?? 18.5,
      relativeHumidityPercent: params.humidity ?? 68,
      windSpeedMs: params.wind ?? 2.4,
    }),
  );

  return {
    location: params.location,
    dateRange: { startDate, endDate: params.endDate },
    dataClassification: 'observed_historical',
    forecastDisclaimer: 'Historical NASA POWER observations only, not a weather forecast.',
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
      totalDays: days,
      availableDays: days,
      missingDays: 0,
      meanTempC: params.meanTempC,
      maxTempC: params.maxTempC,
      minTempC: params.minTempC,
      totalPrecipitationMm: params.totalPrecipitationMm,
      meanSolarRadiationMjM2Day: params.solar === undefined ? 18.5 : params.solar,
      meanRelativeHumidityPercent: params.humidity === undefined ? 68 : params.humidity,
      meanWindSpeedMs: params.wind === undefined ? 2.4 : params.wind,
    },
    temperatureTrend: {
      slopeCPerDay: 0,
      totalChangeC: 0,
      direction: 'stable',
      firstHalfMeanC: params.meanTempC,
      secondHalfMeanC: params.meanTempC,
      sampleCount: days,
    },
    dailySeries,
    monthlySummaries: [],
    gpmImerg:
      params.gpmRateMmHr !== undefined
        ? {
            status: params.gpmRateMmHr !== null ? 'available' : 'unavailable',
            provider: 'NASA GPM IMERG',
            product: 'GPM_3IMERGDF',
            precipitationRateMmHr: params.gpmRateMmHr,
            units: 'mm/hr',
            observationTimestamp: params.gpmTimestamp ?? `${params.endDate}T06:00:00Z`,
          }
        : null,
    sourceAttributions: [],
    sources: ['POWER', 'GPM'],
    retrievedAt: new Date().toISOString(),
  };
}

function makeSoilProfile(params: {
  location: GeoCoordinates;
  ph: number | null;
  textureClass: string | null;
  organicCarbonGKg: number | null;
}): SoilProfile {
  return {
    location: params.location,
    selectedDepthCm: '0-5',
    dataClassification: 'modelled_estimate',
    status: 'available',
    providerUsed: 'soilgrids-rest-v2',
    fallbackUsed: false,
    depthLayers: [],
    surfaceSummary: {
      depthIntervalCm: '0-5',
      textureClass: params.textureClass,
      ph: { mean: params.ph, q05: null, q95: null, uncertainty: null, unit: 'pH' },
      organicCarbonGKg: {
        mean: params.organicCarbonGKg,
        q05: null,
        q95: null,
        uncertainty: null,
        unit: 'g/kg',
      },
      nitrogenGKg: { mean: 0.9, q05: null, q95: null, uncertainty: null, unit: 'g/kg' },
      sandPercent: { mean: 30, q05: null, q95: null, uncertainty: null, unit: '%' },
      siltPercent: { mean: 35, q05: null, q95: null, uncertainty: null, unit: '%' },
      clayPercent: { mean: 35, q05: null, q95: null, uncertainty: null, unit: '%' },
      bulkDensityKgDm3: { mean: 1.38, q05: null, q95: null, uncertainty: null, unit: 'kg/dm³' },
      cecCmolKg: { mean: 24, q05: null, q95: null, uncertainty: null, unit: 'cmol(c)/kg' },
      waterRetentionSummary: 'Standard soil profile',
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
  };
}

function makeSoilMoisture(params: {
  location: GeoCoordinates;
  observationDate: string;
  surfaceMoistureM3M3: number | null;
  rootZoneMoistureM3M3: number | null;
}): SoilMoistureSnapshot {
  return {
    location: params.location,
    dataClassification: 'satellite_derived',
    status: params.rootZoneMoistureM3M3 !== null ? 'available' : 'unavailable',
    product: 'SPL4SMGP V007',
    units: 'm³/m³',
    observationDate: params.observationDate,
    surfaceMoistureM3M3: params.surfaceMoistureM3M3,
    rootZoneMoistureM3M3: params.rootZoneMoistureM3M3,
    surfaceMoistureBinM3M3: null,
    rootZoneMoistureBinM3M3: null,
    moistureSeries: [],
    retrievalConfidenceNote: 'SMAP L4',
    sourceAttribution: {
      id: 'smap',
      name: 'NASA SMAP',
      attribution: 'NASA',
      url: 'https://smap.jpl.nasa.gov',
      cached: false,
      retrievedAt: new Date().toISOString(),
    },
    retrievedAt: new Date().toISOString(),
  };
}

function makeLabSoilTest(params: {
  sampleDate: string;
  labName: string;
  ph: number | null;
  textureClass: string | null;
  organicCarbonGKg: number | null;
}) {
  return {
    id: 'lab-test-1',
    parcelKey: 'marker:default',
    dataClassification: 'measured_lab' as const,
    sampleDate: params.sampleDate,
    labName: params.labName,
    sampleDepthCm: '0-5' as const,
    ph: params.ph,
    organicCarbonGKg: params.organicCarbonGKg,
    organicMatterPercent: null,
    totalNitrogenGKg: null,
    availableNitrogenMgKg: null,
    phosphorusMgKg: null,
    potassiumMgKg: null,
    cecCmolKg: null,
    bulkDensityKgDm3: null,
    sandPercent: null,
    siltPercent: null,
    clayPercent: null,
    textureClass: params.textureClass,
    notes: 'Test lab record',
    updatedAt: new Date().toISOString(),
  };
}

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

describe('NASA Integration Step 6: FarmEnvironmentalContext & Crop Recommendation Integration', async () => {
  const knowledgeRepo = new JsonCropKnowledgeRepository();

  it('preserves DEFAULT_SUITABILITY_WEIGHTS deterministically', () => {
    assert.deepEqual(DEFAULT_SUITABILITY_WEIGHTS, {
      temperature: 0.16,
      rainfall: 0.16,
      soilMoisture: 0.1,
      soilPh: 0.14,
      soilTexture: 0.1,
      organicCarbon: 0.08,
      waterRequirement: 0.14,
      growingSeason: 0.12,
    });
  });

  it('rejects fill values, out-of-bounds numbers, all-null daily rainfall, and future timestamps without coercing missing values to 0', async () => {
    const farmLoc = { latitude: 19.8762, longitude: 75.3433 };
    const weatherRepo = buildWeatherRepoForLocations(() => ({
      telemetry: makeTelemetry({
        location: farmLoc,
        endDate: '2099-05-01', // Future date should be rejected
        meanTempC: -999, // Fill value
        maxTempC: 35,
        minTempC: 20,
        totalPrecipitationMm: 0, // Must NOT pass through if dailySeries precipitation is all null
        dailyPrecipValues: [null, null],
        humidity: 120, // Out of bounds [0, 100]
        solar: -5, // Out of bounds [0, 45]
        wind: 2.5,
        gpmRateMmHr: -9999, // Fill value
      }),
      annualPrecipitationMm: null,
    }));

    const soilRepo = buildSoilRepoForLocations(() => ({
      profile: makeSoilProfile({
        location: { latitude: 21.0, longitude: 76.0 }, // > 5 km distant -> non-representative
        ph: 14.5, // Out of bounds [2.5, 11]
        textureClass: 'Clay Loam',
        organicCarbonGKg: 6.5,
      }),
      moisture: makeSoilMoisture({
        location: farmLoc,
        observationDate: daysAgoIso(30), // > 14 days -> stale
        surfaceMoistureM3M3: 0.22,
        rootZoneMoistureM3M3: 0.25,
      }),
    }));

    const contextService = new FarmEnvironmentalContextService({
      weatherRepository: weatherRepo,
      soilRepository: soilRepo,
    });

    const ctx = await contextService.assembleContext({
      location: farmLoc,
      targetSeason: 'Kharif',
      boundary: {
        id: 'parcel-1',
        name: 'East Plot',
        areaHectares: 4.5,
        centroid: farmLoc,
      },
    });

    // Missing / invalid values remain null, never silently coerced to 0
    assert.equal(ctx.features.temperatureMeanC, null);
    assert.equal(ctx.features.observedRainfallMm, null);
    assert.equal(ctx.features.relativeHumidityPercent, null);
    assert.equal(ctx.features.solarRadiationMjM2Day, null);
    assert.equal(ctx.features.gpmPrecipitationRateMmHr, null);
    assert.equal(ctx.features.soilPh, null);

    // Invalid parameters & stale SMAP & distant SoilGrids flagged explicitly
    assert.ok(ctx.invalidParameters?.includes('relativeHumidityPercent'));
    assert.ok(ctx.invalidParameters?.includes('solarRadiationMjM2Day'));
    assert.ok(ctx.invalidParameters?.includes('soilPh'));
    assert.ok(ctx.staleParameters.includes('soilMoistureSurfaceM3M3'));
    assert.ok(ctx.staleParameters.includes('soilMoistureRootZoneM3M3'));

    const textureObs = ctx.observations.find((o) => o.parameterId === 'soilTexture');
    assert.equal(textureObs?.isRepresentative, false);
    assert.ok(ctx.coarseResolutionCaveats.some((c) => c.includes('NOT future weather forecasts')));
  });

  it('keeps datasets distinct and prioritizes verified laboratory soil tests over SoilGrids modelled estimates', async () => {
    const farmLoc = { latitude: 23.2599, longitude: 77.4126 };
    const weatherRepo = buildWeatherRepoForLocations(() => ({
      telemetry: makeTelemetry({
        location: farmLoc,
        endDate: daysAgoIso(4),
        meanTempC: 25.8,
        maxTempC: 31.2,
        minTempC: 20.4,
        totalPrecipitationMm: 620,
        dailyPrecipValues: [20, 15],
        humidity: 76,
        solar: 17.8,
        wind: 2.2,
        gpmRateMmHr: 1.9,
        gpmTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
      }),
      annualPrecipitationMm: 1050,
    }));

    const soilRepo = buildSoilRepoForLocations(() => ({
      profile: makeSoilProfile({
        location: farmLoc,
        ph: 5.9, // Modelled estimate differs from lab sample
        textureClass: 'Clay',
        organicCarbonGKg: 4.8,
      }),
      moisture: makeSoilMoisture({
        location: farmLoc,
        observationDate: daysAgoIso(2),
        surfaceMoistureM3M3: 0.24,
        rootZoneMoistureM3M3: 0.27,
      }),
    }));

    const contextService = new FarmEnvironmentalContextService({
      weatherRepository: weatherRepo,
      soilRepository: soilRepo,
    });

    const ctx = await contextService.assembleContext({
      location: farmLoc,
      targetSeason: 'Kharif',
      labSoilTest: makeLabSoilTest({
        sampleDate: daysAgoIso(60),
        labName: 'Bhopal District Soil Lab',
        ph: 6.9,
        textureClass: 'Clay Loam',
        organicCarbonGKg: 8.1,
      }),
    });

    assert.equal(ctx.features.soilPh, 6.9);
    assert.equal(ctx.features.soilPhSource, 'measured_lab');
    assert.equal(ctx.features.soilTexture, 'Clay Loam');
    assert.equal(ctx.features.soilTextureSource, 'measured_lab');
    assert.equal(ctx.features.organicCarbonGKg, 8.1);
    assert.equal(ctx.features.organicCarbonSource, 'measured_lab');

    // NASA POWER cumulative rainfall (mm) vs GPM IMERG rate (mm/hr) vs SMAP volumetric moisture (m³/m³) stay distinct
    assert.equal(ctx.features.observedRainfallMm, 620);
    assert.equal(ctx.features.gpmPrecipitationRateMmHr, 1.9);
    assert.equal(ctx.features.soilMoistureSurfaceM3M3, 0.24);
    assert.equal(ctx.features.soilMoistureRootZoneM3M3, 0.27);
    assert.equal(ctx.features.relativeHumidityPercent, 76);
    assert.equal(ctx.features.solarRadiationMjM2Day, 17.8);
    assert.equal(ctx.features.windSpeedMs, 2.2);

    assert.ok(ctx.dataSources.some((s) => s.id === 'nasa-power' && s.isFresh));
    assert.ok(ctx.dataSources.some((s) => s.id === 'nasa-gpm-imerg' && s.isFresh));
    assert.ok(ctx.dataSources.some((s) => s.id === 'nasa-smap' && s.isFresh));
    assert.ok(ctx.dataSources.some((s) => s.id === 'farm-lab-test' && s.isFresh));
  });

  it('changes environmental inputs, context, and crop recommendations across two distinct geographical locations', async () => {
    // Location 1: Arid Western Rajasthan (Jodhpur)
    const rajasthanLoc = { latitude: 26.2389, longitude: 73.0243 };
    // Location 2: Humid Central Plateau Madhya Pradesh (Bhopal)
    const mpLoc = { latitude: 23.2599, longitude: 77.4126 };

    const isRajasthan = (loc: GeoCoordinates) => Math.abs(loc.latitude - rajasthanLoc.latitude) < 1;

    const weatherRepo = buildWeatherRepoForLocations((loc) =>
      isRajasthan(loc)
        ? {
            telemetry: makeTelemetry({
              location: rajasthanLoc,
              endDate: daysAgoIso(4),
              availableDays: 95,
              meanTempC: 30.8,
              maxTempC: 39.2,
              minTempC: 24.1,
              totalPrecipitationMm: 270,
              dailyPrecipValues: [9, 6],
              humidity: 42,
              solar: 22.4,
              wind: 4.1,
              gpmRateMmHr: 0.25,
              gpmTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
            }),
            annualPrecipitationMm: 340,
          }
        : {
            telemetry: makeTelemetry({
              location: mpLoc,
              endDate: daysAgoIso(4),
              availableDays: 95,
              meanTempC: 25.5,
              maxTempC: 31.0,
              minTempC: 20.5,
              totalPrecipitationMm: 610,
              dailyPrecipValues: [22, 18],
              humidity: 79,
              solar: 16.9,
              wind: 2.1,
              gpmRateMmHr: 2.1,
              gpmTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
            }),
            annualPrecipitationMm: 1080,
          },
    );

    const soilRepo = buildSoilRepoForLocations((loc) =>
      isRajasthan(loc)
        ? {
            profile: makeSoilProfile({
              location: rajasthanLoc,
              ph: 7.7,
              textureClass: 'Sandy Loam',
              organicCarbonGKg: 3.1,
            }),
            moisture: makeSoilMoisture({
              location: rajasthanLoc,
              observationDate: daysAgoIso(2),
              surfaceMoistureM3M3: 0.11,
              rootZoneMoistureM3M3: 0.14,
            }),
          }
        : {
            profile: makeSoilProfile({
              location: mpLoc,
              ph: 6.8,
              textureClass: 'Clay Loam',
              organicCarbonGKg: 7.5,
            }),
            moisture: makeSoilMoisture({
              location: mpLoc,
              observationDate: daysAgoIso(2),
              surfaceMoistureM3M3: 0.25,
              rootZoneMoistureM3M3: 0.28,
            }),
          },
    );

    const repo = new CropIntelligenceRepository({
      cropKnowledgeRepository: knowledgeRepo,
      weatherRepository: weatherRepo,
      soilRepository: soilRepo,
    });

    const rajasthanResult = await repo.evaluateSuitability({
      location: rajasthanLoc,
      preferences: { growingSeason: 'Kharif', farmingSystem: 'rainfed' },
      inputs: {
        agroClimaticZoneId: 'acz-14-western-dry',
        state: 'Rajasthan',
      },
    });

    const mpResult = await repo.evaluateSuitability({
      location: mpLoc,
      preferences: { growingSeason: 'Kharif', farmingSystem: 'rainfed' },
      inputs: {
        agroClimaticZoneId: 'acz-08-central-plateau-hills',
        state: 'Madhya Pradesh',
      },
    });

    // Verify environmental inputs and context differ between locations
    assert.notEqual(
      rajasthanResult.evaluatedInputs.temperatureMeanC,
      mpResult.evaluatedInputs.temperatureMeanC,
    );
    assert.notEqual(
      rajasthanResult.evaluatedInputs.observedRainfallMm,
      mpResult.evaluatedInputs.observedRainfallMm,
    );
    assert.notEqual(
      rajasthanResult.evaluatedInputs.soilMoistureM3M3,
      mpResult.evaluatedInputs.soilMoistureM3M3,
    );
    assert.notEqual(
      rajasthanResult.evaluatedInputs.soilTexture,
      mpResult.evaluatedInputs.soilTexture,
    );
    assert.equal(rajasthanResult.environmentalContext?.location.latitude, rajasthanLoc.latitude);
    assert.equal(mpResult.environmentalContext?.location.latitude, mpLoc.latitude);

    // Top crop recommendations adapt deterministically to the two climates/soils
    const rjTop = rajasthanResult.recommendations[0];
    const mpTop = mpResult.recommendations[0];
    assert.equal(rjTop.cropId, 'pearl-millet');
    assert.equal(mpTop.cropId, 'soybean');

    // Verify all Step 6 output fields on each recommendation
    for (const rec of [rjTop, mpTop]) {
      assert.ok(rec.suitabilityScore > 0);
      assert.equal(rec.factorScores.length, 8);
      assert.ok(rec.supportingObservations.length >= 9);
      assert.ok(rec.supportingObservations.some((o) => o.parameter === 'relativeHumidityPercent'));
      assert.ok(rec.supportingObservations.some((o) => o.parameter === 'solarRadiationMjM2Day'));
      assert.ok(rec.supportingObservations.some((o) => o.parameter === 'windSpeedMs'));
      assert.ok(
        rec.supportingObservations.every(
          (o) => typeof o.spatialResolution === 'string' && o.spatialResolution.length > 0,
        ),
      );
      assert.ok((rec.dataSourcesUsed?.length ?? 0) >= 4);
      assert.ok((rec.missingOrUncertainInputs?.length ?? 0) >= 1);
      assert.ok(rec.limitations.some((l) => l.includes('NOT future seasonal weather forecasts')));
      assert.ok(rec.limitations.some((l) => l.includes('Coarse satellite/reanalysis grids')));
      assert.ok(rec.explanation.includes('Supporting observations driving suitability'));
    }
  });

  it('exposes complete Step 6 context & recommendation fields via POST /api/v1/crops/recommend', async () => {
    const app = createApp();
    const server = await startTestServer(app);
    try {
      const response = await fetch(`${server.baseUrl}/api/v1/crops/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 23.2599, longitude: 77.4126 },
          autoFetchMissingFarmData: false,
          preferences: { growingSeason: 'Kharif', farmingSystem: 'rainfed' },
          labSoilTest: {
            sampleDate: daysAgoIso(30),
            labName: 'KVK Bhopal',
            ph: 6.8,
            textureClass: 'Clay Loam',
            organicCarbonGKg: 7.4,
          },
          inputs: {
            agroClimaticZoneId: 'acz-08-central-plateau-hills',
            state: 'Madhya Pradesh',
            temperatureMeanC: 25.5,
            seasonalRainfallMm: 620,
            relativeHumidityPercent: 78,
            solarRadiationMjM2Day: 17.5,
            windSpeedMs: 2.0,
            gpmPrecipitationRateMmHr: 1.5,
            soilMoistureM3M3: 0.25,
          },
        }),
      });

      assert.equal(response.status, 200);
      const body = (await response.json()) as ApiSuccessResponse<CropIntelligenceResult>;
      assert.equal(body.success, true);
      assert.ok(body.data.environmentalContext);
      assert.ok(body.data.recommendations.length > 0);
      const top = body.data.recommendations[0];
      assert.ok(top.dataSourcesUsed && top.dataSourcesUsed.length >= 4);
      assert.ok(Array.isArray(top.missingOrUncertainInputs));
      assert.ok(top.limitations.length >= 2);
      assert.ok(top.explanation.includes('RH 78%'));
    } finally {
      await server.close();
    }
  });
});
