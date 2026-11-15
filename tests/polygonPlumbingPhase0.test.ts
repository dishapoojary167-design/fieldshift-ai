import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { PolygonProcessingUnsupportedError, ValidationError } from '../server/errors/AppError.ts';
import { CompositeSoilGridsProvider } from '../server/providers/CompositeSoilGridsProvider.ts';
import { GpmImergArcGisProvider } from '../server/providers/GpmImergArcGisProvider.ts';
import { NasaSmapMoistureProvider } from '../server/providers/NasaSmapMoistureProvider.ts';
import { SoilGridsRestProvider } from '../server/providers/SoilGridsRestProvider.ts';
import { SoilGridsWcsProvider } from '../server/providers/SoilGridsWcsProvider.ts';
import { CropIntelligenceRepository } from '../server/repositories/implementations/CropIntelligenceRepository.ts';
import { CropRotationRepository } from '../server/repositories/implementations/CropRotationRepository.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import { NasaWeatherRepository } from '../server/repositories/implementations/NasaWeatherRepository.ts';
import { SoilRepository } from '../server/repositories/implementations/SoilRepository.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { assembleGroundedFarmContext } from '../server/services/ai/FarmContextAssembler.ts';
import { FarmEnvironmentalContextService } from '../server/services/implementations/FarmEnvironmentalContextService.ts';
import { createServiceContainer } from '../server/services/index.ts';
import { resolveSpatialRequestContext } from '../server/utils/spatialRequest.ts';
import {
  aiAssistantBodySchema,
  cropIntelligenceBodySchema,
  rainfallQuerySchema,
  rotationCompareBodySchema,
  rotationGenerateBodySchema,
  soilBoundaryContextSchema,
  soilMoistureBodySchema,
  soilMoistureQuerySchema,
  soilProfileBodySchema,
  weatherQuerySchema,
  weatherTelemetryBodySchema,
} from '../server/validation/schemas.ts';
import {
  boundingBoxSchema,
  geoJsonPolygonSchema,
} from '../shared/schemas/index.ts';
import {
  calculateBoundingBox,
  createBoundaryPayload,
  createFarmBoundary,
  type ApiErrorResponse,
  type ApiSuccessResponse,
  type CropIntelligenceResult,
  type GeoCoordinates,
  type GeoJsonPolygon,
  type RotationPlannerResult,
  type SoilMoistureRequest,
  type SoilMoistureSnapshot,
  type SoilProfile,
  type SoilProfileRequest,
  type WeatherTelemetryRequest,
  type WeatherTelemetrySnapshot,
} from '../shared/index.ts';

const FIVE_VERTEX_FARM_COORDS: GeoCoordinates[] = [
  { latitude: 23.255, longitude: 77.405 },
  { latitude: 23.255, longitude: 77.418 },
  { latitude: 23.262, longitude: 77.422 },
  { latitude: 23.268, longitude: 77.412 },
  { latitude: 23.261, longitude: 77.402 },
];

const FIVE_VERTEX_BOUNDARY = createFarmBoundary(
  'farm-phase0-bhopal',
  'Bhopal 5-Vertex Polygon Parcel',
  FIVE_VERTEX_FARM_COORDS,
  new Date('2026-07-01T00:00:00Z'),
);

const FIVE_VERTEX_PAYLOAD = createBoundaryPayload(FIVE_VERTEX_BOUNDARY);
const EXPECTED_POLYGON: GeoJsonPolygon = FIVE_VERTEX_PAYLOAD.geometry!;
const EXPECTED_BBOX = calculateBoundingBox(FIVE_VERTEX_FARM_COORDS);

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function makeMockTelemetry(
  location: GeoCoordinates,
  spatial: ReturnType<typeof resolveSpatialRequestContext>,
): WeatherTelemetrySnapshot {
  const endDate = daysAgoIso(4);
  const startDate = daysAgoIso(34);
  return {
    location,
    ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
    spatialProcessing: spatial.spatialProcessing,
    dateRange: { startDate, endDate },
    dataClassification: 'observed_historical',
    forecastDisclaimer: 'Historical NASA POWER observations only, not a future forecast.',
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
      meanTempC: 26.2,
      maxTempC: 31.8,
      minTempC: 21.0,
      totalPrecipitationMm: 580,
      meanSolarRadiationMjM2Day: 18.1,
      meanRelativeHumidityPercent: 74,
      meanWindSpeedMs: 2.3,
    },
    temperatureTrend: {
      slopeCPerDay: 0,
      totalChangeC: 0,
      direction: 'stable',
      firstHalfMeanC: 26.2,
      secondHalfMeanC: 26.2,
      sampleCount: 30,
    },
    dailySeries: [
      {
        date: endDate,
        temperatureMeanC: 26.2,
        temperatureMaxC: 31.8,
        temperatureMinC: 21.0,
        precipitationMmDay: 19.3,
        cumulativePrecipitationMm: 580,
        solarRadiationMjM2Day: 18.1,
        relativeHumidityPercent: 74,
        windSpeedMs: 2.3,
      },
    ],
    monthlySummaries: [],
    gpmImerg: {
      status: 'available',
      provider: 'NASA GPM IMERG',
      product: 'GPM_3IMERGDF',
      precipitationRateMmHr: 1.4,
      units: 'mm/hr',
      observationTimestamp: `${endDate}T06:00:00Z`,
    },
    sourceAttributions: [],
    sources: ['POWER', 'GPM'],
    retrievedAt: new Date().toISOString(),
  };
}

function makeMockSoilProfile(
  location: GeoCoordinates,
  spatial: ReturnType<typeof resolveSpatialRequestContext>,
): SoilProfile {
  return {
    location,
    ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
    spatialProcessing: spatial.spatialProcessing,
    selectedDepthCm: '0-5',
    dataClassification: 'modelled_estimate',
    status: 'available',
    providerUsed: 'soilgrids-rest-v2',
    fallbackUsed: false,
    depthLayers: [],
    surfaceSummary: {
      depthIntervalCm: '0-5',
      textureClass: 'Clay Loam',
      ph: { mean: 6.8, q05: 6.4, q95: 7.2, uncertainty: 0.4, unit: 'pH' },
      organicCarbonGKg: { mean: 7.4, q05: 6.0, q95: 8.8, uncertainty: 1.4, unit: 'g/kg' },
      nitrogenGKg: { mean: 0.9, q05: 0.7, q95: 1.1, uncertainty: 0.2, unit: 'g/kg' },
      sandPercent: { mean: 30, q05: 25, q95: 35, uncertainty: 5, unit: '%' },
      siltPercent: { mean: 35, q05: 30, q95: 40, uncertainty: 5, unit: '%' },
      clayPercent: { mean: 35, q05: 30, q95: 40, uncertainty: 5, unit: '%' },
      bulkDensityKgDm3: { mean: 1.35, q05: 1.25, q95: 1.45, uncertainty: 0.1, unit: 'kg/dm³' },
      cecCmolKg: { mean: 22, q05: 18, q95: 26, uncertainty: 4, unit: 'cmol(c)/kg' },
      waterRetentionSummary: 'Clay loam water retention profile',
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

function makeMockSoilMoisture(
  location: GeoCoordinates,
  spatial: ReturnType<typeof resolveSpatialRequestContext>,
): SoilMoistureSnapshot {
  const obsDate = daysAgoIso(3);
  return {
    location,
    ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
    spatialProcessing: spatial.spatialProcessing,
    dataClassification: 'satellite_derived',
    status: 'available',
    product: 'SPL4SMGP V007',
    units: 'm³/m³',
    observationDate: obsDate,
    surfaceMoistureM3M3: 0.24,
    rootZoneMoistureM3M3: 0.27,
    surfaceMoistureBinM3M3: null,
    rootZoneMoistureBinM3M3: null,
    moistureSeries: [
      {
        date: obsDate,
        surfaceMoistureM3M3: 0.24,
        surfaceMoistureRangeM3M3: null,
        rootZoneMoistureM3M3: 0.27,
        rootZoneMoistureRangeM3M3: null,
      },
    ],
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

describe('Phase 0: Polygon and Bounding Box Plumbing', () => {
  describe('Geometry & Zod Schema Validation', () => {
    it('accepts valid 5-vertex closed GeoJSON Polygon and BoundingBox across all shared & API schemas', () => {
      assert.equal(geoJsonPolygonSchema.safeParse(EXPECTED_POLYGON).success, true);
      assert.equal(boundingBoxSchema.safeParse(EXPECTED_BBOX).success, true);

      const boundaryParsed = soilBoundaryContextSchema.safeParse(FIVE_VERTEX_PAYLOAD);
      assert.equal(boundaryParsed.success, true);
      if (boundaryParsed.success) {
        assert.deepEqual(boundaryParsed.data.geometry, EXPECTED_POLYGON);
        assert.deepEqual(boundaryParsed.data.bbox, EXPECTED_BBOX);
      }

      assert.equal(
        weatherTelemetryBodySchema.safeParse({
          boundary: FIVE_VERTEX_PAYLOAD,
        }).success,
        true,
      );
      assert.equal(
        soilProfileBodySchema.safeParse({
          geometry: EXPECTED_POLYGON,
          bbox: EXPECTED_BBOX,
        }).success,
        true,
      );
      assert.equal(
        soilMoistureBodySchema.safeParse({
          bbox: EXPECTED_BBOX,
        }).success,
        true,
      );
      assert.equal(
        cropIntelligenceBodySchema.safeParse({
          boundary: FIVE_VERTEX_PAYLOAD,
        }).success,
        true,
      );
      assert.equal(
        rotationGenerateBodySchema.safeParse({
          boundary: FIVE_VERTEX_PAYLOAD,
        }).success,
        true,
      );
      assert.equal(
        rotationCompareBodySchema.safeParse({
          boundary: FIVE_VERTEX_PAYLOAD,
          strategies: [
            {
              id: 'existing',
              label: 'Current',
              sequence: [
                { year: 1, season: 'Kharif', cropId: 'soybean' },
                { year: 1, season: 'Rabi', cropId: 'wheat' },
                { year: 2, season: 'Kharif', cropId: 'maize' },
              ],
            },
          ],
        }).success,
        true,
      );
      assert.equal(
        aiAssistantBodySchema.safeParse({
          prompt: 'Which Kharif crops fit this parcel?',
          farmContext: {
            boundary: FIVE_VERTEX_PAYLOAD,
          },
        }).success,
        true,
      );
    });

    it('rejects unclosed rings, < 4 coordinates, degenerate zero-area rings, swapped [lat,lon] coordinates, and invalid bounding boxes', () => {
      // Unclosed ring
      const unclosed = geoJsonPolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [77.4, 23.25],
            [77.41, 23.25],
            [77.41, 23.26],
            [77.4, 23.26],
          ],
        ],
      });
      assert.equal(unclosed.success, false);

      // < 4 positions
      const tooFew = geoJsonPolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [77.4, 23.25],
            [77.41, 23.25],
            [77.4, 23.25],
          ],
        ],
      });
      assert.equal(tooFew.success, false);

      // Collinear / zero-area ring (closed, 4 coords, but zero area)
      const collinear = geoJsonPolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [77.4, 23.25],
            [77.41, 23.25],
            [77.42, 23.25],
            [77.4, 23.25],
          ],
        ],
      });
      assert.equal(collinear.success, false);

      // Swapped [lat, lon] where latitude > 90 in position[1]
      const swappedCoords = geoJsonPolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [23.25, 95.4],
            [23.25, 95.41],
            [23.26, 95.41],
            [23.25, 95.4],
          ],
        ],
      });
      assert.equal(swappedCoords.success, false);

      // Out-of-bounds longitude > 180
      const outOfBoundsLon = geoJsonPolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [185.0, 23.25],
            [185.1, 23.25],
            [185.1, 23.26],
            [185.0, 23.25],
          ],
        ],
      });
      assert.equal(outOfBoundsLon.success, false);

      // Invalid BoundingBoxes (north < south, east < west, out-of-range latitude)
      assert.equal(
        boundingBoxSchema.safeParse({ west: 77.4, south: 23.3, east: 77.5, north: 23.2 }).success,
        false,
      );
      assert.equal(
        boundingBoxSchema.safeParse({ west: 77.5, south: 23.2, east: 77.4, north: 23.3 }).success,
        false,
      );
      assert.equal(
        boundingBoxSchema.safeParse({ west: 77.4, south: -95, east: 77.5, north: 23.3 }).success,
        false,
      );

      // GET query string validation: invalid polygon JSON, bad CSV bbox, polygon mode without geometry/bbox
      assert.equal(
        weatherQuerySchema.safeParse({
          startDate: '2026-07-01',
          endDate: '2026-07-10',
          polygon: '{not-valid-json',
        }).success,
        false,
      );
      assert.equal(
        rainfallQuerySchema.safeParse({
          bbox: '77.5,23.2,77.4,23.3', // east < west
        }).success,
        false,
      );
      assert.equal(
        soilMoistureQuerySchema.safeParse({
          latitude: 23.26,
          longitude: 77.41,
          spatialProcessingMode: 'polygon', // missing polygon & bbox
        }).success,
        false,
      );
      assert.equal(
        weatherTelemetryBodySchema.safeParse({
          location: { latitude: 23.26, longitude: 77.41 },
          spatialProcessingMode: 'polygon',
        }).success,
        false,
      );
    });

    it('derives missing bbox and centroid from polygon while preserving all vertices', () => {
      const parsed = soilBoundaryContextSchema.parse({
        geometry: EXPECTED_POLYGON,
      });
      assert.equal(parsed.geometry?.coordinates[0].length, 6);
      assert.deepEqual(parsed.bbox, EXPECTED_BBOX);
      assert.ok(Math.abs(parsed.centroid.latitude - FIVE_VERTEX_BOUNDARY.centroid.latitude) < 1e-4);
      assert.ok(Math.abs(parsed.centroid.longitude - FIVE_VERTEX_BOUNDARY.centroid.longitude) < 1e-4);
      assert.ok(parsed.areaHectares > 100);
    });
  });

  describe('End-to-End Vertex & BBox Preservation + Backward Compatibility', () => {
    const capturedWeatherReqs: WeatherTelemetryRequest[] = [];
    const capturedSoilProfileReqs: SoilProfileRequest[] = [];
    const capturedSoilMoistureReqs: SoilMoistureRequest[] = [];
    let baseUrl = '';
    let closeServer: () => Promise<void>;

    before(async () => {
      const repositories = createRepositoryContainer();
      repositories.weather = {
        fetchWeatherTelemetry: async (req) => {
          capturedWeatherReqs.push(req);
          const spatial = resolveSpatialRequestContext(req, 'Mock weather');
          return makeMockTelemetry(spatial.targetLocation, spatial);
        },
        fetchClimateTrends: async (query) => ({
          location: { latitude: query.latitude, longitude: query.longitude },
          baselineYears: 5,
          dataClassification: 'observed_historical',
          forecastDisclaimer: 'Historical NASA POWER observations only.',
          temperatureAnomalyC: 0.2,
          annualMeanTempC: 26.2,
          annualPrecipitationMm: 1020,
          precipitationAnomalyPercent: 1,
          heatStressDaysTrend: 'stable',
          yearlySummaries: [],
          sources: ['POWER'],
          sourceAttributions: [],
        }),
      };
      repositories.soil = {
        fetchSoilProfile: async (req) => {
          capturedSoilProfileReqs.push(req);
          const spatial = resolveSpatialRequestContext(req, 'Mock soil profile');
          return makeMockSoilProfile(spatial.targetLocation, spatial);
        },
        fetchSoilMoisture: async (req) => {
          capturedSoilMoistureReqs.push(req);
          const spatial = resolveSpatialRequestContext(req, 'Mock soil moisture');
          return makeMockSoilMoisture(spatial.targetLocation, spatial);
        },
      };

      const knowledgeRepo = new JsonCropKnowledgeRepository();
      repositories.cropKnowledge = knowledgeRepo;
      repositories.crop = new CropIntelligenceRepository({
        cropKnowledgeRepository: knowledgeRepo,
        weatherRepository: repositories.weather,
        soilRepository: repositories.soil,
      });
      repositories.rotation = new CropRotationRepository({
        cropKnowledgeRepository: knowledgeRepo,
        weatherRepository: repositories.weather,
        soilRepository: repositories.soil,
      });

      const services = createServiceContainer(repositories);
      const app = createApp({ repositories, services });
      const started = await startTestServer(app);
      baseUrl = started.baseUrl;
      closeServer = started.close;
    });

    after(async () => {
      await closeServer();
    });

    it('preserves every polygon vertex and bbox across weather, soil profile, soil moisture, crop recommendation, and rotation routes', async () => {
      capturedWeatherReqs.length = 0;
      capturedSoilProfileReqs.length = 0;
      capturedSoilMoistureReqs.length = 0;

      // 1. Weather telemetry
      const weatherRes = await fetch(`${baseUrl}/api/v1/weather/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: FIVE_VERTEX_BOUNDARY.centroid,
          boundary: FIVE_VERTEX_PAYLOAD,
        }),
      });
      assert.equal(weatherRes.status, 200);
      const weatherBody = (await weatherRes.json()) as ApiSuccessResponse<WeatherTelemetrySnapshot>;
      assert.deepEqual(weatherBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(weatherBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(weatherBody.data.spatialProcessing?.appliedMode, 'centroid');
      assert.equal(weatherBody.data.spatialProcessing?.hasPolygonGeometry, true);
      assert.equal(weatherBody.data.spatialProcessing?.hasBoundingBox, true);
      assert.equal(weatherBody.data.spatialProcessing?.vertexCount, 5);

      // 2. Soil profile
      const profileRes = await fetch(`${baseUrl}/api/v1/soil/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: FIVE_VERTEX_BOUNDARY.centroid,
          boundary: FIVE_VERTEX_PAYLOAD,
          depthCm: '0-5',
        }),
      });
      assert.equal(profileRes.status, 200);
      const profileBody = (await profileRes.json()) as ApiSuccessResponse<SoilProfile>;
      assert.deepEqual(profileBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(profileBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(profileBody.data.spatialProcessing?.vertexCount, 5);

      // 3. Soil moisture
      const moistureRes = await fetch(`${baseUrl}/api/v1/soil/moisture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boundary: FIVE_VERTEX_PAYLOAD,
        }),
      });
      assert.equal(moistureRes.status, 200);
      const moistureBody = (await moistureRes.json()) as ApiSuccessResponse<SoilMoistureSnapshot>;
      assert.deepEqual(moistureBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(moistureBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(moistureBody.data.spatialProcessing?.vertexCount, 5);

      // 4. Crop recommendation (traces through FarmEnvironmentalContextService -> Weather/Soil Repos -> CropSuitabilityEngine)
      const cropRes = await fetch(`${baseUrl}/api/v1/crops/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boundary: FIVE_VERTEX_PAYLOAD,
          preferences: { growingSeason: 'Kharif', farmingSystem: 'rainfed' },
          inputs: {
            agroClimaticZoneId: 'acz-08-central-plateau-hills',
            state: 'Madhya Pradesh',
          },
        }),
      });
      assert.equal(cropRes.status, 200);
      const cropBody = (await cropRes.json()) as ApiSuccessResponse<CropIntelligenceResult>;
      assert.deepEqual(cropBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(cropBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(cropBody.data.spatialProcessing?.vertexCount, 5);
      assert.deepEqual(cropBody.data.environmentalContext?.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(cropBody.data.environmentalContext?.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(cropBody.data.environmentalContext?.spatialProcessing?.vertexCount, 5);
      assert.ok(cropBody.data.recommendations.length > 0);

      // Verify repositories themselves received all 5 vertices + bbox from FarmEnvironmentalContextService
      const lastCropWeatherReq = capturedWeatherReqs.at(-1);
      assert.deepEqual(lastCropWeatherReq?.boundary?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(lastCropWeatherReq?.bbox, EXPECTED_BBOX);
      const lastCropSoilReq = capturedSoilProfileReqs.at(-1);
      assert.deepEqual(lastCropSoilReq?.boundary?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(lastCropSoilReq?.bbox, EXPECTED_BBOX);
      const lastCropMoistureReq = capturedSoilMoistureReqs.at(-1);
      assert.deepEqual(lastCropMoistureReq?.boundary?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(lastCropMoistureReq?.bbox, EXPECTED_BBOX);

      // 5. Rotation generation
      const rotRes = await fetch(`${baseUrl}/api/v1/rotation/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boundary: FIVE_VERTEX_PAYLOAD,
          currentCrop: 'soybean',
          preferences: { startingSeason: 'Kharif', seasonsCount: 4 },
          inputs: {
            agroClimaticZoneId: 'acz-08-central-plateau-hills',
            state: 'Madhya Pradesh',
          },
        }),
      });
      assert.equal(rotRes.status, 200);
      const rotBody = (await rotRes.json()) as ApiSuccessResponse<RotationPlannerResult>;
      assert.deepEqual(rotBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(rotBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(rotBody.data.spatialProcessing?.vertexCount, 5);
    });

    it('supports polygon & bbox query parameters on GET /api/v1/weather and GET /api/v1/soil-moisture', async () => {
      const polygonParam = encodeURIComponent(JSON.stringify(EXPECTED_POLYGON));
      const bboxCsv = `${EXPECTED_BBOX.west},${EXPECTED_BBOX.south},${EXPECTED_BBOX.east},${EXPECTED_BBOX.north}`;
      const startDate = daysAgoIso(14);
      const endDate = daysAgoIso(4);

      const getWeatherRes = await fetch(
        `${baseUrl}/api/v1/weather?polygon=${polygonParam}&bbox=${encodeURIComponent(bboxCsv)}&startDate=${startDate}&endDate=${endDate}`,
      );
      assert.equal(getWeatherRes.status, 200);
      const getWeatherBody = (await getWeatherRes.json()) as ApiSuccessResponse<WeatherTelemetrySnapshot>;
      assert.deepEqual(getWeatherBody.data.boundaryContext?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(getWeatherBody.data.boundaryContext?.bbox, EXPECTED_BBOX);
      assert.equal(getWeatherBody.data.spatialProcessing?.vertexCount, 5);

      const getMoistureRes = await fetch(
        `${baseUrl}/api/v1/soil-moisture?polygon=${polygonParam}&bbox=${encodeURIComponent(JSON.stringify(EXPECTED_BBOX))}`,
      );
      assert.equal(getMoistureRes.status, 200);
      const getMoistureBody = (await getMoistureRes.json()) as ApiSuccessResponse<Record<string, unknown>>;
      const boundaryCtx = getMoistureBody.data.boundaryContext as { geometry?: GeoJsonPolygon; bbox?: unknown } | undefined;
      assert.deepEqual(boundaryCtx?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(boundaryCtx?.bbox, EXPECTED_BBOX);
    });

    it('preserves full backward compatibility for centroid-only and legacy boundary requests', async () => {
      // Legacy point-only request
      const pointRes = await fetch(`${baseUrl}/api/v1/crops/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 23.2599, longitude: 77.4126 },
          preferences: { growingSeason: 'Kharif', farmingSystem: 'rainfed' },
          inputs: {
            agroClimaticZoneId: 'acz-08-central-plateau-hills',
            state: 'Madhya Pradesh',
          },
        }),
      });
      assert.equal(pointRes.status, 200);
      const pointBody = (await pointRes.json()) as ApiSuccessResponse<CropIntelligenceResult>;
      assert.equal(pointBody.data.spatialProcessing?.appliedMode, 'point');
      assert.equal(pointBody.data.spatialProcessing?.hasPolygonGeometry, false);
      assert.ok(pointBody.data.recommendations.length > 0);

      // Legacy boundary without geometry/bbox
      const legacyBoundaryRes = await fetch(`${baseUrl}/api/v1/soil/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 23.2599, longitude: 77.4126 },
          boundary: {
            id: 'legacy-parcel',
            name: 'Legacy Centroid Parcel',
            areaHectares: 12.5,
            centroid: { latitude: 23.2599, longitude: 77.4126 },
          },
        }),
      });
      assert.equal(legacyBoundaryRes.status, 200);
      const legacyBoundaryBody = (await legacyBoundaryRes.json()) as ApiSuccessResponse<SoilProfile>;
      assert.equal(legacyBoundaryBody.data.boundaryContext?.id, 'legacy-parcel');
      assert.equal(legacyBoundaryBody.data.boundaryContext?.geometry, undefined);
      assert.equal(legacyBoundaryBody.data.spatialProcessing?.appliedMode, 'centroid');
      assert.equal(legacyBoundaryBody.data.spatialProcessing?.hasPolygonGeometry, false);
    });

    it('passes polygon and bbox into AI FarmContextAssembler and downstream repositories', async () => {
      const seenTelemetryReqs: WeatherTelemetryRequest[] = [];
      const seenSoilReqs: SoilProfileRequest[] = [];
      const knowledgeRepo = new JsonCropKnowledgeRepository();
      const weatherRepo = {
        fetchWeatherTelemetry: async (req: WeatherTelemetryRequest) => {
          seenTelemetryReqs.push(req);
          return makeMockTelemetry(
            req.location ?? FIVE_VERTEX_BOUNDARY.centroid,
            resolveSpatialRequestContext(req),
          );
        },
        fetchClimateTrends: async (query: { latitude: number; longitude: number }) => ({
          location: { latitude: query.latitude, longitude: query.longitude },
          baselineYears: 5,
          dataClassification: 'observed_historical' as const,
          forecastDisclaimer: 'Historical NASA POWER observations only.',
          temperatureAnomalyC: 0.1,
          annualMeanTempC: 26.0,
          annualPrecipitationMm: 1000,
          precipitationAnomalyPercent: 0,
          heatStressDaysTrend: 'stable' as const,
          yearlySummaries: [],
          sources: ['POWER' as const],
          sourceAttributions: [],
        }),
      };
      const soilRepo = {
        fetchSoilProfile: async (req: SoilProfileRequest) => {
          seenSoilReqs.push(req);
          return makeMockSoilProfile(
            req.location ?? FIVE_VERTEX_BOUNDARY.centroid,
            resolveSpatialRequestContext(req),
          );
        },
        fetchSoilMoisture: async (req: SoilMoistureRequest) =>
          makeMockSoilMoisture(
            req.location ?? FIVE_VERTEX_BOUNDARY.centroid,
            resolveSpatialRequestContext(req),
          ),
      };

      const assembled = await assembleGroundedFarmContext(
        {
          prompt: 'Evaluate soybean for my parcel.',
          farmContext: {
            farmName: 'Bhopal Parcel',
            boundary: FIVE_VERTEX_PAYLOAD,
            growingSeason: 'Kharif',
            farmingSystem: 'rainfed',
            state: 'Madhya Pradesh',
          },
        },
        {
          weatherRepository: weatherRepo,
          soilRepository: soilRepo,
          cropKnowledgeRepository: knowledgeRepo,
          cropRepository: new CropIntelligenceRepository({
            cropKnowledgeRepository: knowledgeRepo,
            weatherRepository: weatherRepo,
            soilRepository: soilRepo,
          }),
          rotationRepository: new CropRotationRepository({
            cropKnowledgeRepository: knowledgeRepo,
            weatherRepository: weatherRepo,
            soilRepository: soilRepo,
          }),
        },
      );

      assert.equal(assembled.groundedContextSummary.hasWeather, true);
      assert.deepEqual(seenTelemetryReqs[0]?.boundary?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(seenTelemetryReqs[0]?.bbox, EXPECTED_BBOX);
      assert.deepEqual(seenSoilReqs[0]?.boundary?.geometry, EXPECTED_POLYGON);
      assert.deepEqual(seenSoilReqs[0]?.bbox, EXPECTED_BBOX);
    });

    it('rejects HTTP 400 on invalid polygon geometry submitted to API routes', async () => {
      const badRes = await fetch(`${baseUrl}/api/v1/crops/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.4, 23.25],
                [77.41, 23.25],
                [77.41, 23.26],
                [77.4, 23.26],
              ],
            ],
          },
        }),
      });
      assert.equal(badRes.status, 400);
      const badBody = (await badRes.json()) as ApiErrorResponse;
      assert.equal(badBody.success, false);
      assert.equal(badBody.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('No Silent Centroid Substitution When Polygon Processing Is Requested', () => {
    it('returns HTTP 501 NOT_IMPLEMENTED across all routes when spatialProcessingMode is "polygon"', async () => {
      const app = createApp();
      const started = await startTestServer(app);
      try {
        const postEndpoints: Array<{ path: string; body: Record<string, unknown> }> = [
          {
            path: '/api/v1/weather/telemetry',
            body: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
          },
          {
            path: '/api/v1/soil/profile',
            body: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
          },
          {
            path: '/api/v1/soil/moisture',
            body: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
          },
          {
            path: '/api/v1/crops/recommend',
            body: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
          },
          {
            path: '/api/v1/rotation/generate',
            body: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
          },
          {
            path: '/api/v1/ai/ask',
            body: {
              prompt: 'Check polygon processing behavior',
              farmContext: { boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' },
            },
          },
        ];

        for (const ep of postEndpoints) {
          const res = await fetch(`${started.baseUrl}${ep.path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ep.body),
          });
          assert.equal(res.status, 501, `${ep.path} must return 501 instead of substituting centroid`);
          const payload = (await res.json()) as ApiErrorResponse;
          assert.equal(payload.success, false);
          assert.equal(payload.error.code, 'NOT_IMPLEMENTED');
        }

        const polygonParam = encodeURIComponent(JSON.stringify(EXPECTED_POLYGON));
        const getRes = await fetch(
          `${started.baseUrl}/api/v1/soil-moisture?polygon=${polygonParam}&spatialProcessingMode=polygon`,
        );
        assert.equal(getRes.status, 501);
        const getBody = (await getRes.json()) as ApiErrorResponse;
        assert.equal(getBody.error.code, 'NOT_IMPLEMENTED');
      } finally {
        await started.close();
      }
    });

    it('throws PolygonProcessingUnsupportedError directly in providers, repositories, and FarmEnvironmentalContextService without issuing upstream fetch calls', async () => {
      let fetchCalls = 0;
      const failIfCalledFetch = async () => {
        fetchCalls += 1;
        throw new Error('Upstream network call must NOT run when polygon processing is requested');
      };

      const centroid = FIVE_VERTEX_BOUNDARY.centroid;
      const spatialOpts = {
        boundary: FIVE_VERTEX_PAYLOAD,
        geometry: EXPECTED_POLYGON,
        bbox: EXPECTED_BBOX,
        spatialProcessingMode: 'polygon' as const,
      };

      const gpmProvider = new GpmImergArcGisProvider({ fetchFn: failIfCalledFetch });
      await assert.rejects(
        () => gpmProvider.getPointRainfall(centroid, undefined, spatialOpts),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      const smapProvider = new NasaSmapMoistureProvider({ fetchFn: failIfCalledFetch });
      await assert.rejects(
        () => smapProvider.fetchSoilMoisture(centroid, spatialOpts),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      const restSoil = new SoilGridsRestProvider({ fetchFn: failIfCalledFetch });
      await assert.rejects(
        () => restSoil.fetchDepthProfile(centroid, spatialOpts),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      const wcsSoil = new SoilGridsWcsProvider({ fetchFn: failIfCalledFetch });
      await assert.rejects(
        () => wcsSoil.fetchDepthProfile(centroid, spatialOpts),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      // CompositeSoilGridsProvider must NOT fail over to WCS when polygon mode is requested
      let wcsCalls = 0;
      const compositeSoil = new CompositeSoilGridsProvider({
        primaryProvider: restSoil,
        fallbackProvider: {
          providerId: 'mock-wcs',
          fetchDepthProfile: async () => {
            wcsCalls += 1;
            throw new Error('Should not be reached');
          },
        },
      });
      await assert.rejects(
        () => compositeSoil.fetchDepthProfile(centroid, spatialOpts),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );
      assert.equal(wcsCalls, 0);

      const weatherRepo = new NasaWeatherRepository({
        fetchFn: failIfCalledFetch,
        gpmProvider,
      });
      await assert.rejects(
        () => weatherRepo.fetchWeatherTelemetry({ boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' }),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      const soilRepo = new SoilRepository({
        soilGridsProvider: compositeSoil,
        soilMoistureProvider: smapProvider,
      });
      await assert.rejects(
        () => soilRepo.fetchSoilProfile({ boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' }),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );
      await assert.rejects(
        () => soilRepo.fetchSoilMoisture({ boundary: FIVE_VERTEX_PAYLOAD, spatialProcessingMode: 'polygon' }),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      const contextService = new FarmEnvironmentalContextService({
        weatherRepository: weatherRepo,
        soilRepository: soilRepo,
      });
      await assert.rejects(
        () =>
          contextService.assembleContext({
            boundary: FIVE_VERTEX_PAYLOAD,
            geometry: EXPECTED_POLYGON,
            bbox: EXPECTED_BBOX,
            spatialProcessingMode: 'polygon',
          }),
        (err) => err instanceof PolygonProcessingUnsupportedError && err.statusCode === 501,
      );

      assert.throws(
        () =>
          resolveSpatialRequestContext({
            location: centroid,
            spatialProcessingMode: 'polygon',
          }),
        (err) => err instanceof ValidationError && err.statusCode === 400,
      );

      assert.equal(fetchCalls, 0);
    });
  });
});
