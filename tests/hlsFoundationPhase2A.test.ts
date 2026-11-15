import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { createApp } from '../server/app.ts';
import { ConfigurationError } from '../server/errors/AppError.ts';
import { LandsatHlsAppEearsProvider } from '../server/providers/hls/LandsatHlsAppEearsProvider.ts';
import { HlsVegetationRepository } from '../server/repositories/implementations/HlsVegetationRepository.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { VegetationService } from '../server/services/implementations/VegetationService.ts';
import { createServiceContainer } from '../server/services/index.ts';
import type {
  ApiSuccessResponse,
  HlsJobRecord,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
  GeoJsonPolygon,
} from '../shared/index.ts';

interface SyntheticGeoTiffOptions {
  width: number;
  height: number;
  values: number[];
  dataType: 'int16' | 'float32' | 'uint16';
  scaleX: number;
  scaleY: number;
  tieLon: number;
  tieLat: number;
  compressDeflate?: boolean;
  nodata?: string;
}

function buildSyntheticGeoTiff(opts: SyntheticGeoTiffOptions): Buffer {
  const { width, height, values, dataType, scaleX, scaleY, tieLon, tieLat, compressDeflate, nodata } =
    opts;
  assert.equal(values.length, width * height);

  const bytesPerSample = dataType === 'float32' ? 4 : 2;
  const rawRaster = Buffer.alloc(width * height * bytesPerSample);
  for (let i = 0; i < values.length; i++) {
    if (dataType === 'float32') {
      rawRaster.writeFloatLE(values[i], i * 4);
    } else if (dataType === 'int16') {
      rawRaster.writeInt16LE(values[i], i * 2);
    } else {
      rawRaster.writeUInt16LE(values[i] & 0xffff, i * 2);
    }
  }

  const stripPayload = compressDeflate ? zlib.deflateSync(rawRaster) : rawRaster;
  const compressionCode = compressDeflate ? 8 : 1;

  interface TiffTagEntry {
    tag: number;
    type: number;
    count: number;
    inlineValue?: number;
    externalData?: Buffer;
  }

  const scaleBuf = Buffer.alloc(24);
  scaleBuf.writeDoubleLE(scaleX, 0);
  scaleBuf.writeDoubleLE(scaleY, 8);
  scaleBuf.writeDoubleLE(0, 16);

  const tieBuf = Buffer.alloc(48);
  tieBuf.writeDoubleLE(0, 0);
  tieBuf.writeDoubleLE(0, 8);
  tieBuf.writeDoubleLE(0, 16);
  tieBuf.writeDoubleLE(tieLon, 24);
  tieBuf.writeDoubleLE(tieLat, 32);
  tieBuf.writeDoubleLE(0, 40);

  const entries: TiffTagEntry[] = [
    { tag: 256, type: 4, count: 1, inlineValue: width },
    { tag: 257, type: 4, count: 1, inlineValue: height },
    { tag: 258, type: 3, count: 1, inlineValue: 16 },
    { tag: 259, type: 3, count: 1, inlineValue: compressionCode },
    { tag: 262, type: 3, count: 1, inlineValue: 1 },
    { tag: 273, type: 4, count: 1, inlineValue: 0 },
    { tag: 278, type: 4, count: 1, inlineValue: height },
    { tag: 279, type: 4, count: 1, inlineValue: stripPayload.length },
    { tag: 339, type: 3, count: 1, inlineValue: dataType === 'float32' ? 3 : dataType === 'int16' ? 2 : 1 },
    { tag: 33550, type: 12, count: 3, externalData: scaleBuf },
    { tag: 33922, type: 12, count: 6, externalData: tieBuf },
  ];

  if (nodata !== undefined) {
    const rawStr = `${nodata}\0`;
    const padded = rawStr.length >= 5 ? rawStr : rawStr.padEnd(5, '\0');
    entries.push({
      tag: 42113,
      type: 2,
      count: padded.length,
      externalData: Buffer.from(padded, 'ascii'),
    });
  }

  entries.sort((a, b) => a.tag - b.tag);

  const headerSize = 8;
  const ifdOffset = headerSize;
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataCursor = ifdOffset + ifdSize;

  for (const entry of entries) {
    if (entry.externalData) {
      entry.inlineValue = dataCursor;
      dataCursor += entry.externalData.length;
    }
  }

  const stripOffset = dataCursor;
  const stripTag = entries.find((e) => e.tag === 273);
  if (stripTag) stripTag.inlineValue = stripOffset;

  const totalSize = stripOffset + stripPayload.length;
  const out = Buffer.alloc(totalSize);

  out.write('II', 0, 'ascii');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(ifdOffset, 4);

  out.writeUInt16LE(entries.length, ifdOffset);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = ifdOffset + 2 + i * 12;
    out.writeUInt16LE(e.tag, off);
    out.writeUInt16LE(e.type, off + 2);
    out.writeUInt32LE(e.count, off + 4);
    if (e.type === 3 && e.count === 1) {
      out.writeUInt16LE(e.inlineValue ?? 0, off + 8);
    } else {
      out.writeUInt32LE(e.inlineValue ?? 0, off + 8);
    }
    if (e.externalData && e.inlineValue !== undefined) {
      e.externalData.copy(out, e.inlineValue);
    }
  }
  out.writeUInt32LE(0, ifdOffset + 2 + entries.length * 12);
  stripPayload.copy(out, stripOffset);

  return out;
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

describe('Phase 2A: NASA Landsat/HLS Provider Foundation & Surface Reflectance Retrieval', () => {
  it('refuses unconfigured HLS submissions without credentials', async () => {
    const provider = new LandsatHlsAppEearsProvider({
      appeearsToken: '',
      earthdataToken: '',
      earthdataUsername: '',
      earthdataPassword: '',
      fetchFn: async () => {
        throw new Error('Should not execute HTTP request');
      },
    });

    assert.equal(provider.getAuthStatus().configured, false);
    assert.equal(provider.getAuthStatus().authMode, 'unconfigured');

    await assert.rejects(
      () =>
        provider.submitJob({
          taskName: 'HLSUnconfigured',
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
          products: ['HLSL30.002'],
          layers: [{ product: 'HLSL30.002', layer: 'B04' }],
          outputFormat: 'csv',
        }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('exposes verified HLSL30.002 & HLSS30.002 metadata on GET /api/v1/vegetation/products', async () => {
    const provider = new LandsatHlsAppEearsProvider({
      appeearsToken: 'test-hls-token',
    });
    const repo = new HlsVegetationRepository({ provider });
    const repositories = createRepositoryContainer();
    repositories.vegetation = repo;
    const services = createServiceContainer(repositories);
    services.vegetation = new VegetationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      const res = await fetch(`${started.baseUrl}/api/v1/vegetation/products`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as ApiSuccessResponse<HlsProviderCapabilitiesPayload>;
      assert.equal(body.success, true);
      assert.equal(body.data.products.length, 2);

      const l30 = body.data.products.find((p) => p.productId === 'HLSL30.002');
      const s30 = body.data.products.find((p) => p.productId === 'HLSS30.002');
      assert.ok(l30);
      assert.ok(s30);
      assert.equal(l30.spatialResolutionMeters, 30);
      assert.equal(l30.temporalExtentStart, '2013-04-11');
      assert.equal(l30.layers.find((l) => l.layer === 'B04')?.scaleFactor, 0.0001);
      assert.equal(s30.layers.find((l) => l.layer === 'B8A')?.scaleFactor, 0.0001);
    } finally {
      await started.close();
    }
  });

  it('executes full AppEEARS HLS async area workflow: submit polygon -> poll status -> retrieve GeoTIFF raster surface reflectance and Fmask QA', async () => {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.400, 23.260],
          [77.402, 23.260],
          [77.402, 23.262],
          [77.400, 23.262],
          [77.400, 23.260],
        ],
      ],
    };

    const gridOpts = {
      width: 2,
      height: 2,
      scaleX: 0.001,
      scaleY: 0.001,
      tieLon: 77.4,
      tieLat: 23.262,
    };

    // Raw surface reflectance values (e.g. 1500 -> scaled 0.15)
    const b04Tif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [1200, 1300, 1400, 1500],
      dataType: 'int16',
      nodata: '-9999',
    });
    const b05Tif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [3500, 3600, 3700, 3800],
      dataType: 'int16',
      nodata: '-9999',
    });
    // Fmask: 0 = clear
    const fmaskTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [0, 0, 0, 0],
      dataType: 'uint16',
      nodata: '255',
    });

    const mockFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/task') && init?.method === 'POST') {
        return new Response(JSON.stringify({ task_id: 'hls-task-uuid-1', status: 'done' }), {
          status: 202,
        });
      }
      if (url.endsWith('/task/hls-task-uuid-1')) {
        return new Response(JSON.stringify({ task_id: 'hls-task-uuid-1', status: 'done' }), {
          status: 200,
        });
      }
      if (url.endsWith('/bundle/hls-task-uuid-1')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'f-b04', file_name: 'HLSL30.002_B04_doy2026300120000.tif', file_size: 2048, file_type: 'tif' },
              { file_id: 'f-b05', file_name: 'HLSL30.002_B05_doy2026300120000.tif', file_size: 2048, file_type: 'tif' },
              { file_id: 'f-fmask', file_name: 'HLSL30.002_Fmask_doy2026300120000.tif', file_size: 2048, file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/f-b04')) return new Response(new Uint8Array(b04Tif), { status: 200 });
      if (url.endsWith('/f-b05')) return new Response(new Uint8Array(b05Tif), { status: 200 });
      if (url.endsWith('/f-fmask')) return new Response(new Uint8Array(fmaskTif), { status: 200 });

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const fixedNowMs = Date.parse('2026-11-10T12:00:00Z');
    const provider = new LandsatHlsAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-hls-token',
      nowFn: () => fixedNowMs,
    });
    const repo = new HlsVegetationRepository({ provider, nowFn: () => fixedNowMs });
    const repositories = createRepositoryContainer();
    repositories.vegetation = repo;
    const services = createServiceContainer(repositories);
    services.vegetation = new VegetationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      const submitRes = await fetch(`${started.baseUrl}/api/v1/vegetation/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: polygon,
          dateRange: { startDate: '2026-10-20', endDate: '2026-10-30' },
          products: ['HLSL30.002'],
        }),
      });
      assert.equal(submitRes.status, 202);
      const job = (await submitRes.json()) as ApiSuccessResponse<HlsJobRecord>;

      const resultRes = await fetch(
        `${started.baseUrl}/api/v1/vegetation/jobs/${job.data.jobId}/results`,
      );
      assert.equal(resultRes.status, 200);
      const payload = (await resultRes.json()) as ApiSuccessResponse<HlsResultPayload>;

      assert.equal(payload.data.summary.totalObservations, 1);
      assert.equal(payload.data.summary.clearSkyObservations, 1);
      assert.equal(payload.data.summary.meanRedReflectance, 0.135); // average of [0.12, 0.13, 0.14, 0.15] = 0.135
      assert.equal(payload.data.summary.meanNirReflectance, 0.365); // average of [0.35, 0.36, 0.37, 0.38] = 0.365

      const obs = payload.data.observations[0];
      assert.equal(obs.productId, 'HLSL30.002');
      assert.equal(obs.spatialResolutionMeters, 30);
      assert.equal(obs.redReflectance, 0.135);
      assert.equal(obs.nirReflectance, 0.365);
      assert.equal(obs.cloudMaskFlag, 0);
      assert.equal(obs.qualityStatus, 'valid');
    } finally {
      await started.close();
    }
  });
});
