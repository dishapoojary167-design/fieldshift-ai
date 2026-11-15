import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExternalServiceError } from '../server/errors/AppError.ts';
import { GpmImergArcGisProvider } from '../server/providers/GpmImergArcGisProvider.ts';
import type { ISatelliteRainfallProvider } from '../server/providers/ISatelliteRainfallProvider.ts';
import { NasaWeatherRepository } from '../server/repositories/implementations/NasaWeatherRepository.ts';
import { fetchJsonWithRetry, type FetchLike } from '../server/utils/resilientHttp.ts';

describe('NasaWeatherRepository, GPM IMERG provider, caching, and retries', () => {
  const samplePowerDailyPayload = {
    header: {
      fill_value: -999,
      start: '20260929',
      end: '20261002',
    },
    parameters: {
      T2M: { units: 'C' },
      T2M_MAX: { units: 'C' },
      T2M_MIN: { units: 'C' },
      PRECTOTCORR: { units: 'mm/day' },
      ALLSKY_SFC_SW_DWN: { units: 'MJ/m^2/day' },
      RH2M: { units: '%' },
      WS2M: { units: 'm/s' },
    },
    properties: {
      parameter: {
        T2M: { '20260929': 14.0, '20260930': 15.0, '20261001': 17.5, '20261002': -999 },
        T2M_MAX: { '20260929': 20.0, '20260930': 21.0, '20261001': 23.0, '20261002': -999 },
        T2M_MIN: { '20260929': 8.0, '20260930': 9.0, '20261001': 11.0, '20261002': -999 },
        PRECTOTCORR: { '20260929': 2.5, '20260930': 0.0, '20261001': 12.5, '20261002': -999 },
        ALLSKY_SFC_SW_DWN: { '20260929': 16.0, '20260930': 18.0, '20261001': 9.0, '20261002': -999 },
        RH2M: { '20260929': 65.0, '20260930': 60.0, '20261001': 85.0, '20261002': -999 },
        WS2M: { '20260929': 3.1, '20260930': 2.5, '20261001': 4.4, '20261002': -999 },
      },
    },
  };

  it('parses NASA POWER daily observations, filters -999 fill values, accumulates rainfall, and aggregates monthly summaries', async () => {
    let fetchCount = 0;
    const mockFetch: FetchLike = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(samplePowerDailyPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const mockGpm: ISatelliteRainfallProvider = {
      providerId: 'mock-gpm',
      getPointRainfall: async () => ({
        status: 'available',
        provider: 'NASA GES DISC GPM IMERG',
        product: 'GPM_3IMERGHHE V07',
        precipitationRateMmHr: 1.45,
        units: 'mm/hr',
        observationTimestamp: '2026-10-02T12:00:00.000Z',
      }),
    };

    const repo = new NasaWeatherRepository({
      fetchFn: mockFetch,
      gpmProvider: mockGpm,
      cacheTtlMs: 60_000,
    });

    const first = await repo.fetchWeatherTelemetry({
      location: { latitude: 42.0308, longitude: -93.6319 },
      dateRange: { startDate: '2026-09-29', endDate: '2026-10-02' },
    });

    assert.equal(fetchCount, 1);
    assert.equal(first.dataClassification, 'observed_historical');
    assert.match(first.forecastDisclaimer, /not manufactured/i);
    assert.deepEqual(first.units, {
      temperature: '°C',
      precipitation: 'mm/day',
      cumulativePrecipitation: 'mm',
      solarRadiation: 'MJ/m²/day',
      relativeHumidity: '%',
      windSpeed: 'm/s',
      gpmRate: 'mm/hr',
    });

    assert.equal(first.summary.totalDays, 4);
    assert.equal(first.summary.availableDays, 3);
    assert.equal(first.summary.missingDays, 1);
    assert.equal(first.summary.totalPrecipitationMm, 15.0);
    assert.equal(first.dailySeries[3].temperatureMeanC, null);
    assert.equal(first.dailySeries[3].cumulativePrecipitationMm, 15.0);
    assert.equal(first.monthlySummaries.length, 2);
    assert.equal(first.monthlySummaries[0].month, '2026-09');
    assert.equal(first.monthlySummaries[0].totalPrecipitationMm, 2.5);
    assert.equal(first.monthlySummaries[1].month, '2026-10');
    assert.equal(first.monthlySummaries[1].totalPrecipitationMm, 12.5);
    assert.equal(first.temperatureTrend.direction, 'warming');
    assert.equal(first.gpmImerg?.precipitationRateMmHr, 1.45);

    // Second identical query uses TTL cache without invoking fetch again
    const second = await repo.fetchWeatherTelemetry({
      location: { latitude: 42.0308, longitude: -93.6319 },
      dateRange: { startDate: '2026-09-29', endDate: '2026-10-02' },
    });
    assert.equal(fetchCount, 1);
    assert.equal(second.sourceAttributions[0].cached, true);
  });

  it('handles GpmImergArcGisProvider numeric values and NoData unavailable states honestly', async () => {
    const noDataFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/identify')) {
        return new Response(JSON.stringify({ value: 'NoData' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ timeInfo: { timeExtent: [1700000000000, 1794612600000] } }),
        { status: 200 },
      );
    };

    const providerNoData = new GpmImergArcGisProvider({ fetchFn: noDataFetch });
    const noDataRes = await providerNoData.getPointRainfall({ latitude: 42.0, longitude: -93.6 });
    assert.equal(noDataRes.status, 'unavailable');
    assert.equal(noDataRes.precipitationRateMmHr, null);
    assert.equal(noDataRes.units, 'mm/hr');

    const numericFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/identify')) {
        return new Response(
          JSON.stringify({
            value: '2.375',
            catalogItems: { features: [{ attributes: { stdtime: 1794612600000 } }] },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ timeInfo: { timeExtent: [1700000000000, 1794612600000] } }),
        { status: 200 },
      );
    };

    const providerValue = new GpmImergArcGisProvider({ fetchFn: numericFetch });
    const valueRes = await providerValue.getPointRainfall({ latitude: 42.0, longitude: -93.6 });
    assert.equal(valueRes.status, 'available');
    assert.equal(valueRes.precipitationRateMmHr, 2.375);
  });

  it('retries transient HTTP 503 errors and times out slow requests cleanly', async () => {
    let attempts = 0;
    const flakyFetch: FetchLike = async () => {
      attempts += 1;
      if (attempts < 2) {
        return new Response('Busy', { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const res = await fetchJsonWithRetry<{ ok: boolean }>('https://example.test/api', {
      fetchFn: flakyFetch,
      maxRetries: 2,
      retryDelayMs: 5,
    });
    assert.equal(res.ok, true);
    assert.equal(attempts, 2);

    const slowFetch: FetchLike = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    await assert.rejects(
      () =>
        fetchJsonWithRetry('https://example.test/slow', {
          fetchFn: slowFetch,
          timeoutMs: 15,
          maxRetries: 0,
          serviceName: 'Slow NASA Mock',
        }),
      ExternalServiceError,
    );
  });
});
