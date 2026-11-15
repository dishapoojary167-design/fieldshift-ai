import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { loadEnvConfig, validateEnv } from '../server/config/env.ts';
import { ConfigurationError } from '../server/errors/AppError.ts';
import { EcostressAppEearsProvider } from '../server/providers/ecostress/EcostressAppEearsProvider.ts';
import { EcostressEvapotranspirationRepository } from '../server/repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { EvapotranspirationService } from '../server/services/implementations/EvapotranspirationService.ts';
import { createServiceContainer } from '../server/services/index.ts';
import {
  calculateBoundingBox,
  createBoundaryPayload,
  createFarmBoundary,
  type ApiErrorResponse,
  type ApiSuccessResponse,
  type EcostressJobRecord,
  type EcostressProviderCapabilitiesPayload,
  type EcostressResultPayload,
  type GeoCoordinates,
} from '../shared/index.ts';

const FIVE_VERTEX_FARM_COORDS: GeoCoordinates[] = [
  { latitude: 23.255, longitude: 77.405 },
  { latitude: 23.255, longitude: 77.418 },
  { latitude: 23.262, longitude: 77.422 },
  { latitude: 23.268, longitude: 77.412 },
  { latitude: 23.261, longitude: 77.402 },
];

const FARM_BOUNDARY = createFarmBoundary(
  'eco-parcel-01',
  'Bhopal Soybean Plot',
  FIVE_VERTEX_FARM_COORDS,
  new Date('2026-07-01T00:00:00Z'),
);
const FARM_BOUNDARY_PAYLOAD = createBoundaryPayload(FARM_BOUNDARY);
const EXPECTED_BBOX = calculateBoundingBox(FIVE_VERTEX_FARM_COORDS);

const SAMPLE_AREA_STATS_CSV = [
  'File Name,Dataset,Date,Mean,Minimum,Maximum,Standard Deviation,Count,Pixels Pass Quality',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_ETdaily,2026-07-19,142.5,118.2,165.4,12.1,24,24',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_ETinstUncertainty,2026-07-19,18.4,12.0,25.0,3.2,24,24',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_PTJPLSMinst,2026-07-19,215.0,190.0,240.0,14.5,24,24',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_PTJPLSMcanopy,2026-07-19,0.68,0.55,0.78,0.06,24,24',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_cloud,2026-07-19,0,0,0,0,24,24',
  'ECO_L3T_JET_002_2026200,ECO_L3T_JET_002_water,2026-07-19,0,0,0,0,24,24',
  // Second timestamp is cloud-masked & NaN ETdaily -> must be excluded from clear-sky summary and keep ETdaily as null
  'ECO_L3T_JET_002_2026203,ECO_L3T_JET_002_ETdaily,2026-07-22,NaN,NaN,NaN,NaN,24,0',
  'ECO_L3T_JET_002_2026203,ECO_L3T_JET_002_cloud,2026-07-22,1,1,1,0,24,0',
  'ECO_L3T_JET_002_2026203,ECO_L3T_JET_002_water,2026-07-22,0,0,0,0,24,0',
  // ECO_L4T_ESI stats
  'ECO_L4T_ESI_002_2026200,ECO_L4T_ESI_002_ESI,2026-07-19,0.74,0.61,0.85,0.07,24,24',
  'ECO_L4T_ESI_002_2026200,ECO_L4T_ESI_002_PET,2026-07-19,290.5,270.0,310.0,10.2,24,24',
  'ECO_L4T_ESI_002_2026200,ECO_L4T_ESI_002_cloud,2026-07-19,0,0,0,0,24,24',
  'ECO_L4T_ESI_002_2026200,ECO_L4T_ESI_002_water,2026-07-19,0,0,0,0,24,24',
].join('\n');

const SAMPLE_POINT_CSV = [
  'ID,Latitude,Longitude,Date,ECO_L3T_JET_002_ETdaily,ECO_L3T_JET_002_cloud,ECO_L3T_JET_002_water,ECO_L4T_ESI_002_ESI,ECO_L4T_ESI_002_PET',
  'farm-point,23.2602,77.4118,2026-07-19,138.2,0,0,0.71,280.4',
  'farm-point,23.2602,77.4118,2026-07-22,-9999,1,0,NaN,275.0',
].join('\n');

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

describe('Phase 1 Part 1: NASA ECOSTRESS Data Provider Foundation', () => {
  it('loads AppEEARS & ECOSTRESS env configuration defaults and sanitizes placeholder secrets', () => {
    const config = loadEnvConfig({
      NASA_EARTHDATA_TOKEN: '   ',
      NASA_APPEEARS_TOKEN: 'MY_PLACEHOLDER_TOKEN',
      ECOSTRESS_CACHE_TTL_MS: '120000',
      ECOSTRESS_HTTP_TIMEOUT_MS: '8000',
      ECOSTRESS_JOB_TTL_MS: '3600000',
    });

    assert.equal(config.nasaAppeearsBaseUrl, 'https://appeears.earthdatacloud.nasa.gov/api');
    assert.equal(config.nasaEarthdataToken, undefined);
    assert.equal(config.nasaAppeearsToken, undefined);
    assert.equal(config.ecostressCacheTtlMs, 120000);
    assert.equal(config.ecostressHttpTimeoutMs, 8000);
    assert.equal(config.ecostressJobTtlMs, 3600000);
    assert.doesNotThrow(() => validateEnv(config));
  });

  it('refuses simulated ECOSTRESS submissions and throws ConfigurationError when credentials are absent', async () => {
    let networkCalls = 0;
    const provider = new EcostressAppEearsProvider({
      appeearsToken: '',
      earthdataToken: '',
      earthdataUsername: '',
      earthdataPassword: '',
      fetchFn: async () => {
        networkCalls += 1;
        throw new Error('Should not execute HTTP request without credentials');
      },
    });

    assert.equal(provider.getAuthStatus().configured, false);
    assert.equal(provider.getAuthStatus().authMode, 'unconfigured');

    await assert.rejects(
      () =>
        provider.submitJob({
          taskName: 'NoAuthTest',
          taskType: 'point',
          location: { latitude: 23.26, longitude: 77.41 },
          spatialProcessing: {
            requestedMode: 'auto',
            appliedMode: 'point',
            hasPolygonGeometry: false,
            hasBoundingBox: false,
            note: 'point',
          },
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
          products: ['ECO_L3T_JET.002'],
          layers: [{ product: 'ECO_L3T_JET.002', layer: 'ETdaily' }],
          outputFormat: 'csv',
        }),
      (err) => err instanceof ConfigurationError && err.statusCode === 500,
    );
    assert.equal(networkCalls, 0);
  });

  it('exposes verified ECO_L3T_JET.002 & ECO_L4T_ESI.002 metadata on GET /api/v1/evapotranspiration/products without leaking secrets', async () => {
    const provider = new EcostressAppEearsProvider({
      earthdataToken: 'secret-edl-token-do-not-expose',
      appeearsToken: '',
      earthdataUsername: '',
      earthdataPassword: '',
    });
    const repo = new EcostressEvapotranspirationRepository({ provider });
    const repositories = createRepositoryContainer();
    repositories.evapotranspiration = repo;
    const services = createServiceContainer(repositories);
    services.evapotranspiration = new EvapotranspirationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      const res = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/products`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.equal(text.includes('secret-edl-token-do-not-expose'), false);

      const body = JSON.parse(text) as ApiSuccessResponse<EcostressProviderCapabilitiesPayload>;
      assert.equal(body.success, true);
      assert.equal(body.data.accessMethod, 'NASA AppEEARS API');
      assert.equal(body.data.authentication.configured, true);
      assert.equal(body.data.authentication.hasEarthdataToken, true);
      assert.equal(body.data.products.length, 2);

      const jet = body.data.products.find((p) => p.productId === 'ECO_L3T_JET.002');
      const esi = body.data.products.find((p) => p.productId === 'ECO_L4T_ESI.002');
      assert.ok(jet);
      assert.ok(esi);
      assert.equal(jet.spatialResolutionMeters, 70);
      assert.equal(jet.temporalExtentStart, '2018-07-10');
      assert.equal(jet.layers.find((l) => l.layer === 'ETdaily')?.units, 'W/m²');
      assert.equal(esi.layers.find((l) => l.layer === 'ESI')?.units, 'Ratio');
      assert.equal(esi.layers.find((l) => l.layer === 'PET')?.units, 'W/m²');
    } finally {
      await started.close();
    }
  });

  it('executes full AppEEARS async area workflow: /login -> submit polygon -> poll status -> retrieve cached CSV stats bundle', async () => {
    let loginCalls = 0;
    let pollCount = 0;
    let bundleDownloadCalls = 0;
    let capturedTaskPayload: Record<string, unknown> | null = null;

    const mockFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/login')) {
        loginCalls += 1;
        assert.ok(
          String((init?.headers as Record<string, string>)?.Authorization).startsWith('Basic '),
        );
        return new Response(
          JSON.stringify({
            token_type: 'Bearer',
            token: 'appeears-session-token-123',
            expiration: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      assert.equal(authHeader, 'Bearer appeears-session-token-123');

      if (url.endsWith('/task') && init?.method === 'POST') {
        capturedTaskPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            task_id: 'appeears-task-uuid-999',
            status: 'pending',
            created: '2026-07-26T00:00:00Z',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/task/appeears-task-uuid-999')) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({
              task_id: 'appeears-task-uuid-999',
              status: 'processing',
              progress: { summary: 45 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            task_id: 'appeears-task-uuid-999',
            status: 'done',
            progress: { summary: 100 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/bundle/appeears-task-uuid-999')) {
        return new Response(
          JSON.stringify({
            task_id: 'appeears-task-uuid-999',
            files: [
              {
                file_id: 'file-csv-stats',
                file_name: 'ECO_L3T_JET-002-Statistics.csv',
                file_size: SAMPLE_AREA_STATS_CSV.length,
                file_type: 'csv',
              },
              {
                file_id: 'file-tif-et',
                file_name: 'ECO_L3T_JET.002_ETdaily_2026200.tif',
                file_size: 4096,
                file_type: 'tif',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/bundle/appeears-task-uuid-999/file-csv-stats')) {
        bundleDownloadCalls += 1;
        // Simulate one transient 503 retry before succeeding
        if (bundleDownloadCalls === 1) {
          return new Response('Service temporarily unavailable', { status: 503 });
        }
        return new Response(SAMPLE_AREA_STATS_CSV, {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new EcostressAppEearsProvider({
      fetchFn: mockFetch,
      earthdataUsername: 'farmer-user',
      earthdataPassword: 'farmer-password',
      appeearsToken: '',
      earthdataToken: '',
      retryDelayMs: 5,
    });
    const repo = new EcostressEvapotranspirationRepository({ provider });
    const repositories = createRepositoryContainer();
    repositories.evapotranspiration = repo;
    const services = createServiceContainer(repositories);
    services.evapotranspiration = new EvapotranspirationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      // 1. Submit polygon job -> 202 Accepted
      const submitRes = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boundary: FARM_BOUNDARY_PAYLOAD,
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
        }),
      });
      assert.equal(submitRes.status, 202);
      const submitBody = (await submitRes.json()) as ApiSuccessResponse<EcostressJobRecord>;
      assert.equal(submitBody.success, true);
      const jobId = submitBody.data.jobId;
      assert.equal(submitBody.data.upstreamTaskId, 'appeears-task-uuid-999');
      assert.equal(submitBody.data.taskType, 'area');
      assert.equal(submitBody.data.spatialProcessing.appliedMode, 'polygon');
      assert.equal(submitBody.data.spatialProcessing.vertexCount, 5);
      assert.deepEqual(
        submitBody.data.boundaryContext?.geometry,
        FARM_BOUNDARY_PAYLOAD.geometry,
      );
      assert.deepEqual(submitBody.data.boundaryContext?.bbox, EXPECTED_BBOX);

      // Check AppEEARS area task JSON preserved all vertices + MM-DD-YYYY dates
      const taskPayload = capturedTaskPayload as Record<string, unknown> | null;
      assert.ok(taskPayload);
      assert.equal(taskPayload.task_type, 'area');
      const params = taskPayload.params as {
        dates: Array<{ startDate: string; endDate: string }>;
        geo: { features: Array<{ geometry: unknown }> };
      };
      assert.deepEqual(params.dates, [{ startDate: '07-15-2026', endDate: '07-25-2026' }]);
      assert.deepEqual(params.geo.features[0].geometry, FARM_BOUNDARY_PAYLOAD.geometry);

      // 2. Poll job while processing -> 200 status=processing
      const poll1Res = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs/${jobId}`);
      assert.equal(poll1Res.status, 200);
      const poll1Body = (await poll1Res.json()) as ApiSuccessResponse<EcostressJobRecord>;
      assert.equal(poll1Body.data.status, 'processing');
      assert.equal(poll1Body.data.progressPercent, 45);

      // Attempting GET /results while still processing triggers poll -> sees done on pollCount===2 -> fetches results!
      // Test explicit premature 409 JOB_NOT_READY separately below; here poll 2 completes cleanly
      const resultsRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${jobId}/results`,
      );
      assert.equal(resultsRes.status, 200);
      const resultsBody = (await resultsRes.json()) as ApiSuccessResponse<EcostressResultPayload>;
      assert.equal(resultsBody.data.status, 'completed');
      assert.equal(resultsBody.data.spatialResolution.value, 70);
      assert.deepEqual(
        resultsBody.data.boundaryContext?.geometry,
        FARM_BOUNDARY_PAYLOAD.geometry,
      );
      assert.equal(resultsBody.data.summary.totalObservations, 3);
      assert.equal(resultsBody.data.summary.clearSkyObservations, 2);
      assert.equal(resultsBody.data.summary.cloudMaskedObservations, 1);
      assert.equal(resultsBody.data.summary.meanEtDailyWm2, 142.5);
      assert.equal(resultsBody.data.summary.meanEsiRatio, 0.74);
      assert.equal(resultsBody.data.summary.meanPetWm2, 290.5);
      assert.equal(resultsBody.data.sourceAttribution.cached, false);

      const cloudyObs = resultsBody.data.observations.find(
        (o) => o.observationTimestamp === '2026-07-22',
      );
      assert.equal(cloudyObs?.cloudMaskFlag, 1);
      assert.equal(cloudyObs?.qualityFiltered, false);
      assert.equal(cloudyObs?.etDailyWm2, null); // NaN preserved as null, never 0

      // 3. Second GET /results hits cache without re-downloading CSV or re-logging in
      const cachedRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${jobId}/results`,
      );
      assert.equal(cachedRes.status, 200);
      const cachedBody = (await cachedRes.json()) as ApiSuccessResponse<EcostressResultPayload>;
      assert.equal(cachedBody.data.sourceAttribution.cached, true);
      assert.equal(loginCalls, 1); // Session token cached across submit/poll/bundle
      assert.equal(bundleDownloadCalls, 2); // 1 failed 503 + 1 retry success; 0 calls on cache hit
    } finally {
      await started.close();
    }
  });

  it('supports AppEEARS point CSV extraction and explicit pending (409), failed (502), and expired (410) states', async () => {
    let nowMs = Date.parse('2026-07-26T00:00:00Z');
    let upstreamMode: 'pending' | 'failed' | 'point_done' = 'pending';

    const mockFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/task') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { task_name?: string };
        const taskId = body.task_name?.includes('fail')
          ? 'task-fail'
          : body.task_name?.includes('expire')
            ? 'task-expire'
            : 'task-point';
        return new Response(JSON.stringify({ task_id: taskId, status: 'pending' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/task/task-fail')) {
        return new Response(
          JSON.stringify({
            task_id: 'task-fail',
            status: 'error',
            error: 'No granules matched spatial extent.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/task/task-expire') || url.endsWith('/task/task-point')) {
        if (upstreamMode === 'pending') {
          return new Response(
            JSON.stringify({ task_id: 'task-point', status: 'pending', progress: { summary: 10 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ task_id: 'task-point', status: 'done', progress: { summary: 100 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/bundle/task-point')) {
        return new Response(
          JSON.stringify({
            files: [{ file_id: 'pt-csv', file_name: 'point-results.csv', file_type: 'csv' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/bundle/task-point/pt-csv')) {
        return new Response(SAMPLE_POINT_CSV, {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new EcostressAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'direct-appeears-token',
    });
    const repo = new EcostressEvapotranspirationRepository({
      provider,
      jobTtlMs: 60_000,
      nowFn: () => nowMs,
    });
    const repositories = createRepositoryContainer();
    repositories.evapotranspiration = repo;
    const services = createServiceContainer(repositories);
    services.evapotranspiration = new EvapotranspirationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      // Unknown job -> 404 NOT_FOUND
      const unknownRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/eco-unknown-id`,
      );
      assert.equal(unknownRes.status, 404);

      // Submit point job while still pending -> GET /results returns 409 JOB_NOT_READY
      const ptSubmit = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 23.2602, longitude: 77.4118 },
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
        }),
      });
      assert.equal(ptSubmit.status, 202);
      const ptJob = (await ptSubmit.json()) as ApiSuccessResponse<EcostressJobRecord>;
      assert.equal(ptJob.data.taskType, 'point');

      const pendingResultRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${ptJob.data.jobId}/results`,
      );
      assert.equal(pendingResultRes.status, 409);
      const pendingResultErr = (await pendingResultRes.json()) as ApiErrorResponse;
      assert.equal(pendingResultErr.error.code, 'JOB_NOT_READY');

      // Transition point task to done -> parses point CSV
      upstreamMode = 'point_done';
      const ptResultRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${ptJob.data.jobId}/results`,
      );
      assert.equal(ptResultRes.status, 200);
      const ptResult = (await ptResultRes.json()) as ApiSuccessResponse<EcostressResultPayload>;
      assert.equal(ptResult.data.summary.clearSkyObservations, 1);
      assert.equal(ptResult.data.summary.cloudMaskedObservations, 1);
      assert.equal(ptResult.data.summary.meanEtDailyWm2, 138.2);

      // Failed job -> 502 EXTERNAL_SERVICE_ERROR
      const failSubmit = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName: 'fail-task',
          location: { latitude: 23.26, longitude: 77.41 },
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
        }),
      });
      const failJob = (await failSubmit.json()) as ApiSuccessResponse<EcostressJobRecord>;
      const failResultRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${failJob.data.jobId}/results`,
      );
      assert.equal(failResultRes.status, 502);

      // Expired job -> 410 JOB_EXPIRED
      const expSubmit = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskName: 'expire-task',
          location: { latitude: 23.26, longitude: 77.41 },
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
        }),
      });
      const expJob = (await expSubmit.json()) as ApiSuccessResponse<EcostressJobRecord>;
      nowMs += 120_000; // Advance clock past 60s jobTtlMs
      const expStatusRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${expJob.data.jobId}`,
      );
      assert.equal(expStatusRes.status, 200);
      const expStatusBody = (await expStatusRes.json()) as ApiSuccessResponse<EcostressJobRecord>;
      assert.equal(expStatusBody.data.status, 'expired');

      const expResultRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${expJob.data.jobId}/results`,
      );
      assert.equal(expResultRes.status, 410);
      const expErr = (await expResultRes.json()) as ApiErrorResponse;
      assert.equal(expErr.error.code, 'JOB_EXPIRED');
    } finally {
      await started.close();
    }
  });

  it('validates ECOSTRESS date bounds (>= 2018-07-10) and ISS orbital latitude bounds ([-52, 52])', async () => {
    const app = createApp();
    const started = await startTestServer(app);
    try {
      // Pre-launch date rejected -> 400
      const earlyDateRes = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 23.26, longitude: 77.41 },
          dateRange: { startDate: '2018-06-01', endDate: '2018-06-15' },
        }),
      });
      assert.equal(earlyDateRes.status, 400);

      // Latitude > 52° outside ISS orbit -> 400
      const highLatRes = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: { latitude: 61.5, longitude: 10.0 },
          dateRange: { startDate: '2026-07-15', endDate: '2026-07-25' },
        }),
      });
      assert.equal(highLatRes.status, 400);
    } finally {
      await started.close();
    }
  });
});
