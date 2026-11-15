import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { createApp } from '../server/app.ts';
import { LandsatHlsAppEearsProvider } from '../server/providers/hls/LandsatHlsAppEearsProvider.ts';
import { HlsVegetationRepository } from '../server/repositories/implementations/HlsVegetationRepository.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { VegetationService } from '../server/services/implementations/VegetationService.ts';
import { createServiceContainer } from '../server/services/index.ts';
import type {
  ApiSuccessResponse,
  HlsJobRecord,
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

describe('Phase 2B: Real NASA HLS Vegetation Data Retrieval, NDVI/NDWI Indices & Fmask Masking', () => {
  it('calculates accurate NDVI and NDWI, applies scale factor 0.0001, masks cloudy pixels via Fmask, and computes polygon stats', async () => {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.399, 23.259],
          [77.403, 23.259],
          [77.403, 23.263],
          [77.399, 23.263],
          [77.399, 23.259],
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

    // Pixel 0: Red=1000 (0.10), NIR=4000 (0.40) -> NDVI = (0.40 - 0.10) / (0.40 + 0.10) = 0.30 / 0.50 = 0.60
    // Pixel 1: Red=2000 (0.20), NIR=4000 (0.40) -> NDVI = (0.40 - 0.20) / (0.40 + 0.20) = 0.20 / 0.60 = 0.3333
    // Pixel 2: Cloud-masked via Fmask (bit 1) -> excluded
    // Pixel 3: -9999 fill -> excluded
    const b03Tif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [2000, 2500, 2000, 2000], // Green = 0.20, 0.25
      dataType: 'int16',
      nodata: '-9999',
    });
    const b04Tif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [1000, 2000, 1500, -9999], // Red = 0.10, 0.20
      dataType: 'int16',
      nodata: '-9999',
    });
    const b05Tif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [4000, 4000, 4000, 4000], // NIR = 0.40
      dataType: 'int16',
      nodata: '-9999',
    });
    const fmaskTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [0, 0, 2, 0], // Pixel 2 has cloud bit (0x02)
      dataType: 'uint16',
      nodata: '255',
    });

    const buffers: Record<string, Buffer> = {
      'h-b03': b03Tif,
      'h-b04': b04Tif,
      'h-b05': b05Tif,
      'h-fmask': fmaskTif,
    };

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/task')) {
        return new Response(JSON.stringify({ task_id: 'hls-b-task', status: 'done' }), { status: 202 });
      }
      if (url.endsWith('/task/hls-b-task')) {
        return new Response(JSON.stringify({ task_id: 'hls-b-task', status: 'done' }), { status: 200 });
      }
      if (url.endsWith('/bundle/hls-b-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'h-b03', file_name: 'HLSL30.002_B03_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'h-b04', file_name: 'HLSL30.002_B04_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'h-b05', file_name: 'HLSL30.002_B05_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'h-fmask', file_name: 'HLSL30.002_Fmask_doy2026300120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      const id = url.split('/').pop() ?? '';
      if (buffers[id]) {
        return new Response(new Uint8Array(buffers[id]), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new LandsatHlsAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-token',
    });
    const repo = new HlsVegetationRepository({ provider });

    const job = await repo.submitJob({
      geometry: polygon,
      dateRange: { startDate: '2026-10-20', endDate: '2026-10-30' },
      products: ['HLSL30.002'],
    });

    const results = await repo.getJobResults(job.jobId);
    assert.equal(results.summary.totalObservations, 1);
    assert.equal(results.summary.clearSkyObservations, 1);
    assert.equal(results.summary.cloudMaskedObservations, 0);
    assert.ok(results.summary.meanNdvi !== null);
    // Expected mean NDVI of pixel 0 (0.60) and pixel 1 (~0.3333) = ~0.4667
    assert.ok(results.summary.meanNdvi > 0.45 && results.summary.meanNdvi < 0.48);
    assert.ok(results.summary.meanNdwi !== null);

    const obs = results.observations[0];
    assert.equal(obs.cloudMaskFlag, 0);
    assert.equal(obs.qualityStatus, 'valid');
    assert.ok(obs.qualityNotes?.some((n) => n.includes('Fmask: 1 cloudy')));
    assert.ok(obs.ndvi !== null);
    assert.ok(obs.layerStats?.NDVI);
    assert.equal(obs.layerStats.NDVI.validPixelCount, 2); // pixels 0 and 1
  });

  it('handles empty scenes and zero-division protection gracefully without failing', async () => {
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

    // Red and NIR both 0 -> denominator = 0 (zero division)
    const b04Zero = buildSyntheticGeoTiff({ ...gridOpts, values: [0, 0, 0, 0], dataType: 'int16' });
    const b05Zero = buildSyntheticGeoTiff({ ...gridOpts, values: [0, 0, 0, 0], dataType: 'int16' });

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/task')) {
        return new Response(JSON.stringify({ task_id: 'zero-task', status: 'done' }), { status: 200 });
      }
      if (url.includes('/bundle/zero-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'z-b04', file_name: 'HLSL30.002_B04_doy2026301120000.tif', file_type: 'tif' },
              { file_id: 'z-b05', file_name: 'HLSL30.002_B05_doy2026301120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/z-b04')) return new Response(new Uint8Array(b04Zero), { status: 200 });
      if (url.endsWith('/z-b05')) return new Response(new Uint8Array(b05Zero), { status: 200 });
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new LandsatHlsAppEearsProvider({ fetchFn: mockFetch, appeearsToken: 'test-token' });
    const repo = new HlsVegetationRepository({ provider });

    const job = await repo.submitJob({
      geometry: polygon,
      dateRange: { startDate: '2026-10-20', endDate: '2026-10-30' },
      products: ['HLSL30.002'],
    });

    const results = await repo.getJobResults(job.jobId);
    assert.equal(results.summary.totalObservations, 1);
    assert.equal(results.summary.meanNdvi, null);
  });

  it('retrieves and processes NASA HLS Sentinel-2 (HLSS30.002) with B03, B04, B8A, and B11 calculating NDVI and NDWI', async () => {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.399, 23.259],
          [77.403, 23.259],
          [77.403, 23.263],
          [77.399, 23.263],
          [77.399, 23.259],
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

    // Sentinel-2 bands: B03 (Green), B04 (Red), B8A (NIR Narrow), B11 (SWIR1)
    // Pixel 0: B03=1500 (0.15), B04=1000 (0.10), B8A=5000 (0.50), B11=2000 (0.20)
    // NDVI = (0.50 - 0.10) / (0.50 + 0.10) = 0.40 / 0.60 = 0.6667
    // NDWI (Green-NIR) = (0.15 - 0.50) / (0.15 + 0.50) = -0.35 / 0.65 = -0.5385
    const b03Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [1500, 1600, 1700, 1800], dataType: 'int16' });
    const b04Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [1000, 1200, 1100, 1300], dataType: 'int16' });
    const b8aTif = buildSyntheticGeoTiff({ ...gridOpts, values: [5000, 5200, 5100, 5300], dataType: 'int16' });
    const b11Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [2000, 2100, 2200, 2300], dataType: 'int16' });
    const fmaskTif = buildSyntheticGeoTiff({ ...gridOpts, values: [0, 0, 0, 0], dataType: 'uint16' });

    const buffers: Record<string, Buffer> = {
      's-b03': b03Tif,
      's-b04': b04Tif,
      's-b8a': b8aTif,
      's-b11': b11Tif,
      's-fmask': fmaskTif,
    };

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/bundle/s2-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 's-b03', file_name: 'HLSS30.002_B03_doy2026305120000.tif', file_type: 'tif' },
              { file_id: 's-b04', file_name: 'HLSS30.002_B04_doy2026305120000.tif', file_type: 'tif' },
              { file_id: 's-b8a', file_name: 'HLSS30.002_B8A_doy2026305120000.tif', file_type: 'tif' },
              { file_id: 's-b11', file_name: 'HLSS30.002_B11_doy2026305120000.tif', file_type: 'tif' },
              { file_id: 's-fmask', file_name: 'HLSS30.002_Fmask_doy2026305120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/task') || url.includes('/task/s2-task')) {
        return new Response(JSON.stringify({ task_id: 's2-task', status: 'done' }), { status: 200 });
      }
      const id = url.split('/').pop() ?? '';
      if (buffers[id]) {
        return new Response(new Uint8Array(buffers[id]), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new LandsatHlsAppEearsProvider({ fetchFn: mockFetch, appeearsToken: 'test-token' });
    const repo = new HlsVegetationRepository({ provider });

    const job = await repo.submitJob({
      geometry: polygon,
      dateRange: { startDate: '2026-10-25', endDate: '2026-11-05' },
      products: ['HLSS30.002'],
    });

    const results = await repo.getJobResults(job.jobId);
    assert.equal(results.summary.totalObservations, 1);
    assert.equal(results.summary.clearSkyObservations, 1);
    assert.ok(results.summary.meanNdvi !== null);
    assert.ok(results.summary.meanNdvi > 0.60 && results.summary.meanNdvi < 0.70);
    assert.ok(results.summary.meanNdwi !== null);
    assert.ok(results.summary.meanNdwi < 0); // NDWI is negative for vegetation green-nir

    const obs = results.observations[0];
    assert.equal(obs.productId, 'HLSS30.002');
    assert.equal(obs.productVersion, '002');
    assert.equal(obs.spatialResolutionMeters, 30);
    assert.equal(obs.qualityStatus, 'valid');
    assert.equal(obs.validPixelCount, 4);
    assert.equal(obs.coveragePercent, 100);
    assert.ok(obs.layerStats?.NDVI);
    assert.ok(obs.layerStats.NDVI.min !== null);
    assert.ok(obs.layerStats.NDVI.max !== null);
  });

  it('handles complete cloud contamination without fabricating measurements and marks qualityStatus cloud_masked', async () => {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.399, 23.259],
          [77.403, 23.259],
          [77.403, 23.263],
          [77.399, 23.263],
          [77.399, 23.259],
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

    const b04Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [2000, 2000, 2000, 2000], dataType: 'int16' });
    const b05Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [4000, 4000, 4000, 4000], dataType: 'int16' });
    // Fmask: all 4 pixels have cloud bit (bit 1 = 0x02)
    const fmaskCloud = buildSyntheticGeoTiff({ ...gridOpts, values: [2, 2, 2, 2], dataType: 'uint16' });

    const buffers: Record<string, Buffer> = {
      'c-b04': b04Tif,
      'c-b05': b05Tif,
      'c-fmask': fmaskCloud,
    };

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/bundle/cloud-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'c-b04', file_name: 'HLSL30.002_B04_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'c-b05', file_name: 'HLSL30.002_B05_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'c-fmask', file_name: 'HLSL30.002_Fmask_doy2026300120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/task') || url.includes('/task/cloud-task')) {
        return new Response(JSON.stringify({ task_id: 'cloud-task', status: 'done' }), { status: 200 });
      }
      const id = url.split('/').pop() ?? '';
      if (buffers[id]) {
        return new Response(new Uint8Array(buffers[id]), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const provider = new LandsatHlsAppEearsProvider({ fetchFn: mockFetch, appeearsToken: 'test-token' });
    const repo = new HlsVegetationRepository({ provider });

    const job = await repo.submitJob({
      geometry: polygon,
      dateRange: { startDate: '2026-10-20', endDate: '2026-10-30' },
      products: ['HLSL30.002'],
    });

    const results = await repo.getJobResults(job.jobId);
    assert.equal(results.summary.totalObservations, 1);
    assert.equal(results.summary.clearSkyObservations, 0);
    assert.equal(results.summary.cloudMaskedObservations, 1);
    assert.equal(results.summary.meanNdvi, null);
    assert.equal(results.summary.meanNdwi, null);

    const obs = results.observations[0];
    assert.equal(obs.cloudMaskFlag, 1);
    assert.equal(obs.qualityStatus, 'cloud_masked');
    assert.equal(obs.qualityFiltered, false);
    assert.equal(obs.validPixelCount, 0);
    assert.equal(obs.coveragePercent, 0);
  });

  it('serves GET /api/v1/vegetation with validated polygon query and rejects invalid inputs', async () => {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.399, 23.259],
          [77.403, 23.259],
          [77.403, 23.263],
          [77.399, 23.263],
          [77.399, 23.259],
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

    const b04Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [1000, 1000, 1000, 1000], dataType: 'int16' });
    const b05Tif = buildSyntheticGeoTiff({ ...gridOpts, values: [4000, 4000, 4000, 4000], dataType: 'int16' });
    const fmaskTif = buildSyntheticGeoTiff({ ...gridOpts, values: [0, 0, 0, 0], dataType: 'uint16' });

    const buffers: Record<string, Buffer> = {
      'api-b04': b04Tif,
      'api-b05': b05Tif,
      'api-fmask': fmaskTif,
    };

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/bundle/api-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'api-b04', file_name: 'HLSL30.002_B04_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'api-b05', file_name: 'HLSL30.002_B05_doy2026300120000.tif', file_type: 'tif' },
              { file_id: 'api-fmask', file_name: 'HLSL30.002_Fmask_doy2026300120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/task') || url.includes('/task/api-task')) {
        return new Response(JSON.stringify({ task_id: 'api-task', status: 'done' }), { status: 200 });
      }
      const id = url.split('/').pop() ?? '';
      if (buffers[id]) {
        return new Response(new Uint8Array(buffers[id]), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const fixedNowMs = Date.parse('2026-11-10T12:00:00Z');
    const provider = new LandsatHlsAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-token',
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
      // 1. Success with polygon query
      const polyEncoded = encodeURIComponent(JSON.stringify(polygon));
      const resOk = await fetch(
        `${started.baseUrl}/api/v1/vegetation?polygon=${polyEncoded}&startDate=2026-10-20&endDate=2026-10-30`,
      );
      assert.equal(resOk.status, 200);
      const jsonOk = (await resOk.json()) as ApiSuccessResponse<HlsResultPayload>;
      assert.equal(jsonOk.success, true);
      assert.equal(jsonOk.data.summary.totalObservations, 1);
      assert.equal(jsonOk.data.summary.clearSkyObservations, 1);
      assert.ok(jsonOk.data.summary.meanNdvi !== null);

      // 2. Reject missing location and polygon
      const resMissing = await fetch(
        `${started.baseUrl}/api/v1/vegetation?startDate=2026-10-20&endDate=2026-10-30`,
      );
      assert.equal(resMissing.status, 400);

      // 3. Reject invalid date format
      const resBadDate = await fetch(
        `${started.baseUrl}/api/v1/vegetation?polygon=${polyEncoded}&startDate=invalid-date`,
      );
      assert.equal(resBadDate.status, 400);
    } finally {
      await started.close();
    }
  });
});

