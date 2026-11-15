import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import {
  AppError,
  ConfigurationError,
  ExternalServiceError,
  NotFoundError,
  ServiceNotImplementedError,
  ValidationError,
} from '../server/errors/AppError.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { createServiceContainer } from '../server/services/index.ts';
import type { ApiErrorResponse } from '../shared/index.ts';

describe('Centralized error handling', () => {
  let server: Server;
  let baseUrl = '';

  before(async () => {
    const repositories = createRepositoryContainer();
    const services = createServiceContainer(repositories);
    services.location = {
      getStatus: () => 'stub',
      resolveLocation: async () => {
        throw new ExternalServiceError('Upstream geocoder failed', { upstreamStatus: 503 });
      },
      listRegions: async () => {
        throw new Error('Unexpected unhandled boom');
      },
    };

    const app = createApp({ services });
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

  it('preserves AppError subclass status codes and operational flags', () => {
    assert.equal(new ValidationError('bad').statusCode, 400);
    assert.equal(new NotFoundError('missing').statusCode, 404);
    assert.equal(new ServiceNotImplementedError('Weather', 'fetch').statusCode, 501);
    assert.equal(new ExternalServiceError('upstream').statusCode, 502);
    assert.equal(new ConfigurationError('missing env').isOperational, false);
    assert.ok(new ValidationError('bad') instanceof AppError);
  });

  it('returns 400 VALIDATION_ERROR on malformed JSON payload', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"location": ',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('maps ExternalServiceError thrown in service to 502 EXTERNAL_SERVICE_ERROR', async () => {
    const res = await fetch(`${baseUrl}/api/v1/location/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Ames, Iowa' }),
    });
    assert.equal(res.status, 502);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'EXTERNAL_SERVICE_ERROR');
    assert.deepEqual(body.error.details, { upstreamStatus: 503 });
  });

  it('maps unexpected errors to 500 INTERNAL_ERROR without crashing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/location/regions`);
    assert.equal(res.status, 500);
    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(body.meta.apiVersion, 'v1');
    assert.ok(body.meta.requestId);
  });
});
