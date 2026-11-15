import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import type { ApiErrorResponse } from '../shared/index.ts';

describe('Zod request validation across /api/v1 routes', () => {
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects out-of-range coordinates on POST /api/v1/soil/profile', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: 120, longitude: -200 } }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details);
  });

  it('rejects location resolve when both query and coordinates are missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/location/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects invalid dateRange on POST /api/v1/weather/telemetry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/weather/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 40, longitude: -90 },
        dateRange: { startDate: '2026-10-01', endDate: '2026-09-01' },
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects invalid query parameters on GET /api/v1/weather/trends', async () => {
    const res = await fetch(`${baseUrl}/api/v1/weather/trends?latitude=not-a-number&longitude=10`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects invalid soil depth interval on POST /api/v1/soil/profile', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 40, longitude: -90 },
        depthCm: '100-200',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects invalid rotationYears on POST /api/v1/rotations/plan', async () => {
    const res = await fetch(`${baseUrl}/api/v1/rotations/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: { latitude: 40, longitude: -90 },
        currentCrop: 'Wheat',
        rotationYears: 25,
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('rejects too-short prompt on POST /api/v1/ai/ask', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
