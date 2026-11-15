import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { NasaSmapSoilMoistureProvider } from '../server/providers/nasa/smap.provider.ts';
import type { ApiErrorResponse, ApiSuccessResponse } from '../shared/index.ts';

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

describe('NASA SMAP Soil Moisture Integration (SPL3SMP_E & SPL4SMGP)', () => {
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

  it('GET /api/v1/soil-moisture returns 200 with complete SMAP metadata, units, and restrictions', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil-moisture?latitude=19.0760&longitude=72.8777`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as ApiSuccessResponse<{
      location: { latitude: number; longitude: number };
      surfaceSoilMoisture: number | null;
      rootZoneSoilMoisture: number | null;
      surfaceMoistureDepth: string;
      rootZoneMoistureDepth: string;
      unit: string;
      productIdentifier: string;
      spatialResolution: { value: number; unit: string; label: string };
      qualityInformation: {
        retrievalQualityFlag: number | null;
        missingValueIndicator: number;
        sensorTechnology: string;
        retrievalMethodology: string;
      };
      dataSource: {
        providerId: string;
        datasetName: string;
        productVersion: string;
        doiOrUrl: string;
      };
      moistureSeries: Array<{
        date: string;
        surfaceMoistureM3M3: number | null;
        rootZoneMoistureM3M3: number | null;
      }>;
      restrictions: string[];
    }>;

    assert.equal(body.success, true);
    assert.equal(body.data.location.latitude, 19.076);
    assert.equal(body.data.location.longitude, 72.8777);
    assert.equal(body.data.unit, 'm³/m³');
    assert.equal(body.data.productIdentifier, 'SPL3SMP_E V006 / SPL4SMGP V007');
    assert.equal(body.data.spatialResolution.value, 9);
    assert.equal(body.data.spatialResolution.unit, 'km');
    assert.ok(body.data.surfaceMoistureDepth.includes('0–5 cm'));
    assert.ok(body.data.rootZoneMoistureDepth.includes('0–100 cm'));

    // Quality metadata checks
    assert.equal(body.data.qualityInformation.missingValueIndicator, -9999.0);
    assert.ok(body.data.qualityInformation.sensorTechnology.includes('SMAP'));

    // Data source checks
    assert.equal(body.data.dataSource.providerId, 'nasa-smap-nsidc');
    assert.equal(body.data.dataSource.doiOrUrl, 'https://nsidc.org/data/spl3smp_e');

    // Restrictions check: must clearly forbid N/P/K/pH/SOC inference and mandate 9km resolution caveat
    assert.ok(Array.isArray(body.data.restrictions));
    assert.ok(body.data.restrictions.some((r) => r.includes('NOT a complete soil chemistry analysis')));
    assert.ok(body.data.restrictions.some((r) => r.includes('Nitrogen')));
    assert.ok(body.data.restrictions.some((r) => r.includes('0–5 cm') && r.includes('0–100 cm')));
    assert.ok(body.data.restrictions.some((r) => r.includes('9 km')));
  });

  it('GET /api/v1/soil-moisture rejects invalid latitude with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil-moisture?latitude=95&longitude=72.8777`);
    assert.equal(res.status, 400);

    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  it('GET /api/v1/soil-moisture rejects missing coordinates with 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/v1/soil-moisture`);
    assert.equal(res.status, 400);

    const body = (await res.json()) as ApiErrorResponse;
    assert.equal(body.success, false);
  });

  it('NasaSmapSoilMoistureProvider unit: returns typed observations conforming to FieldShift schema', async () => {
    const provider = new NasaSmapSoilMoistureProvider();
    assert.equal(provider.descriptor.id, 'nasa-smap-nsidc');
    assert.ok(provider.descriptor.spatialResolutionLabel.includes('9 km'));

    const observations = await provider.fetchSoilMoistureTimeSeries({
      location: { latitude: 19.076, longitude: 72.8777 },
      dateRange: { startDate: '2025-01-01', endDate: '2025-01-03' },
      parameters: ['soil_moisture_surface', 'soil_moisture_root_zone'],
      temporalAggregation: 'daily',
    });

    assert.ok(Array.isArray(observations));
    assert.ok(observations.length > 0);
    const first = observations[0];
    assert.equal(first.unit, 'm³/m³');
    assert.ok(first.spatialResolution);
    assert.equal(first.spatialResolution.value, 9);
    assert.equal(first.spatialResolution.unit, 'km');
    assert.equal(first.location.latitude, 19.076);
    assert.equal(first.location.longitude, 72.8777);
    assert.ok(['soil_moisture_surface', 'soil_moisture_root_zone'].includes(first.parameter));
  });
});
