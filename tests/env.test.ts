import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadEnvConfig } from '../server/config/env.ts';
import { AppError, ValidationError } from '../server/errors/AppError.ts';

describe('Environment configuration and error hierarchy', () => {
  it('loads default values when environment variables are omitted', () => {
    const config = loadEnvConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.apiPrefix, '/api/v1');
    assert.equal(config.nodeEnv, 'development');
    assert.equal(config.isGeminiConfigured, false);
    assert.equal(config.geminiModel, 'gemini-4-hydrogen');
  });

  it('rejects invalid PORT values', () => {
    assert.throws(() => loadEnvConfig({ PORT: '99999' }), /Invalid PORT/);
    assert.throws(() => loadEnvConfig({ PORT: 'abc' }), /Invalid PORT/);
  });

  it('constructs operational ValidationError inheriting from AppError', () => {
    const err = new ValidationError('Invalid coordinates', { field: 'latitude' });
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.isOperational, true);
  });
});
