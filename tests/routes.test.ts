import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import type { RequestLogEntry } from '../server/middleware/requestLogger.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { createServiceContainer } from '../server/services/index.ts';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  HealthCheckPayload,
  LocationContext,
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

describe('API v1 routes and request logging', () => {
  const logs: RequestLogEntry[] = [];
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const app = createApp({
      logWriter: (entry) => logs.push(entry),
    });
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  after(async () => {
    await closeServer();
  });

  it('GET /api/v1/health returns 200 with all 6 module service statuses and logs request', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('x-request-id'));

    const body = (await res.json()) as ApiSuccessResponse<HealthCheckPayload>;
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(body.data.appName, 'FieldShift AI');
    assert.equal(body.data.apiVersion, 'v1');
    assert.equal(body.meta.apiVersion, 'v1');
    assert.ok(body.meta.requestId);
    assert.equal(body.data.services.location, 'ready');
    assert.equal(body.data.services.weather, 'ready');
    assert.equal(body.data.services.soil, 'ready');
    assert.equal(body.data.services.cropIntelligence, 'ready');
    assert.equal(body.data.services.cropRotation, 'ready');
    assert.ok(['ready', 'unconfigured'].includes(body.data.services.aiAssistant));
    assert.deepEqual(Object.keys(body.data.services).sort(), [
      'aiAssistant',
      'cropIntelligence',
      'cropRotation',
      'location',
      'soil',
      'weather',
    ]);

    const lastLog = logs.at(-1);
    assert.ok(lastLog);
    assert.equal(lastLog.method, 'GET');
    assert.equal(lastLog.path, '/api/v1/health');
    assert.equal(lastLog.statusCode, 200);
    assert.ok(lastLog.durationMs >= 0);
  });

  it('returns 501 NOT_IMPLEMENTED for remaining unimplemented placeholder module requests', async () => {
    const cases: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/v1/location/regions' },
    ];

    for (const testCase of cases) {
      const res = await fetch(`${baseUrl}${testCase.path}`, {
        method: testCase.method,
        headers: testCase.body ? { 'Content-Type': 'application/json' } : undefined,
        body: testCase.body ? JSON.stringify(testCase.body) : undefined,
      });
      assert.equal(res.status, 501, `${testCase.method} ${testCase.path} should return 501`);
      const payload = (await res.json()) as ApiErrorResponse;
      assert.equal(payload.success, false);
      assert.equal(payload.error.code, 'NOT_IMPLEMENTED');
    }
  });

  it('returns 404 NOT_FOUND for unknown /api/v1 routes', async () => {
    const res = await fetch(`${baseUrl}/api/v1/unknown-endpoint`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  it('delegates controller -> service -> typed success envelope when service resolves', async () => {
    const repositories = createRepositoryContainer();
    const services = createServiceContainer(repositories);
    services.location = {
      getStatus: () => 'ready',
      resolveLocation: async (req) => ({
        coordinates: req.coordinates ?? { latitude: 42.0, longitude: -93.6 },
        regionName: 'Story County, IA',
        countryCode: 'US',
        source: 'test-double',
      }),
      listRegions: async () => [],
    };

    const app = createApp({ services });
    const started = await startTestServer(app);
    try {
      const res = await fetch(`${started.baseUrl}/api/v1/location/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates: { latitude: 42.0, longitude: -93.6 } }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as ApiSuccessResponse<LocationContext>;
      assert.equal(body.success, true);
      assert.equal(body.data.regionName, 'Story County, IA');
      assert.equal(body.meta.apiVersion, 'v1');
    } finally {
      await started.close();
    }
  });
});
