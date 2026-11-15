import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExternalServiceError, NotFoundError } from '../server/errors/AppError.ts';
import {
  NominatimLocationRepository,
  type FetchLike,
} from '../server/repositories/implementations/NominatimLocationRepository.ts';

describe('NominatimLocationRepository', () => {
  it('resolves text location queries and maps candidates', async () => {
    const mockFetch: FetchLike = async () =>
      new Response(
        JSON.stringify([
          {
            display_name: 'Ames, Story County, Iowa, United States',
            lat: '42.0267567',
            lon: '-93.6170448',
            type: 'administrative',
            address: {
              city: 'Ames',
              state: 'Iowa',
              country_code: 'us',
            },
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const repo = new NominatimLocationRepository(mockFetch);
    const result = await repo.resolveLocation({ query: 'Ames, Iowa' });

    assert.equal(result.regionName, 'Ames, Iowa');
    assert.equal(result.countryCode, 'US');
    assert.equal(result.source, 'OpenStreetMap Nominatim');
    assert.equal(result.candidates?.length, 1);
    assert.ok(Math.abs(result.coordinates.latitude - 42.0267567) < 0.0001);
  });

  it('parses direct coordinate string queries via reverse lookup with graceful fallback', async () => {
    const failingFetch: FetchLike = async () => {
      throw new Error('Offline');
    };

    const repo = new NominatimLocationRepository(failingFetch);
    const result = await repo.resolveLocation({ query: '42.0308, -93.6319' });

    assert.equal(result.coordinates.latitude, 42.0308);
    assert.equal(result.coordinates.longitude, -93.6319);
    assert.equal(result.source, 'Coordinate Input');
  });

  it('throws NotFoundError when geocoder returns empty results', async () => {
    const mockFetch: FetchLike = async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const repo = new NominatimLocationRepository(mockFetch);
    await assert.rejects(() => repo.resolveLocation({ query: 'NonexistentPlaceXYZ' }), NotFoundError);
  });

  it('throws ExternalServiceError when geocoder returns HTTP 503', async () => {
    const mockFetch: FetchLike = async () => new Response('Unavailable', { status: 503 });

    const repo = new NominatimLocationRepository(mockFetch);
    await assert.rejects(() => repo.resolveLocation({ query: 'Ames' }), ExternalServiceError);
  });
});
