import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { createApp } from '../server/app.ts';
import { EcostressAppEearsProvider } from '../server/providers/ecostress/EcostressAppEearsProvider.ts';
import { EcostressEvapotranspirationRepository } from '../server/repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { createRepositoryContainer } from '../server/repositories/index.ts';
import { EvapotranspirationService } from '../server/services/implementations/EvapotranspirationService.ts';
import { createServiceContainer } from '../server/services/index.ts';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  EcostressJobRecord,
  EcostressResultPayload,
  GeoJsonPolygon,
} from '../shared/index.ts';

interface SyntheticGeoTiffOptions {
  width: number;
  height: number;
  values: number[];
  dataType: 'float32' | 'uint8';
  scaleX: number;
  scaleY: number;
  tieLon: number;
  tieLat: number;
  compressDeflate?: boolean;
  nodata?: string;
}

/**
 * Generates a valid Classic little-endian GeoTIFF buffer with WGS84
 * ModelPixelScaleTag (33550), ModelTiepointTag (33922), and optional GDAL_NODATA (42113).
 */
function buildSyntheticGeoTiff(opts: SyntheticGeoTiffOptions): Buffer {
  const { width, height, values, dataType, scaleX, scaleY, tieLon, tieLat, compressDeflate, nodata } =
    opts;
  assert.equal(values.length, width * height, 'Raster values length must match width * height');

  const bytesPerSample = dataType === 'float32' ? 4 : 1;
  const rawRaster = Buffer.alloc(width * height * bytesPerSample);
  for (let i = 0; i < values.length; i++) {
    if (dataType === 'float32') {
      rawRaster.writeFloatLE(values[i], i * 4);
    } else {
      rawRaster.writeUInt8(values[i] & 0xff, i);
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
    { tag: 256, type: 4, count: 1, inlineValue: width }, // ImageWidth
    { tag: 257, type: 4, count: 1, inlineValue: height }, // ImageLength
    { tag: 258, type: 3, count: 1, inlineValue: dataType === 'float32' ? 32 : 8 }, // BitsPerSample
    { tag: 259, type: 3, count: 1, inlineValue: compressionCode }, // Compression
    { tag: 262, type: 3, count: 1, inlineValue: 1 }, // PhotometricInterpretation
    { tag: 273, type: 4, count: 1, inlineValue: 0 }, // StripOffsets (filled below)
    { tag: 278, type: 4, count: 1, inlineValue: height }, // RowsPerStrip
    { tag: 279, type: 4, count: 1, inlineValue: stripPayload.length }, // StripByteCounts
    { tag: 339, type: 3, count: 1, inlineValue: dataType === 'float32' ? 3 : 1 }, // SampleFormat
    { tag: 33550, type: 12, count: 3, externalData: scaleBuf }, // ModelPixelScaleTag
    { tag: 33922, type: 12, count: 6, externalData: tieBuf }, // ModelTiepointTag
  ];

  if (nodata !== undefined) {
    // Pad at least 5 bytes so GDAL_NODATA is safely stored out-of-line
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

describe('Phase 1 Part 2: Real NASA ECOSTRESS GeoTIFF Retrieval, QA Filtering & Polygon Extraction', () => {
  it('extracts GeoTIFF polygon pixel statistics excluding outside pixels, cloud/water masks, NaN, and out-of-range values', async () => {
    // Grid: 5 cols x 5 rows, 0.001 deg (~70-110 m) spacing
    // Upper-left corner: lon = 77.400, lat = 23.265
    // Pixel (col, row) center: lon = 77.400 + (col + 0.5) * 0.001, lat = 23.265 - (row + 0.5) * 0.001
    // Row 0 lat = 23.2645 .. Row 4 lat = 23.2605
    // Col 0 lon = 77.4005 .. Col 4 lon = 77.4045
    //
    // Polygon covers rows 1..2 and cols 1..4 (8 intersecting pixel centers):
    //   lon in [77.4010, 77.4050], lat in [23.2620, 23.2640]
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [77.401, 23.262],
          [77.405, 23.262],
          [77.405, 23.264],
          [77.401, 23.264],
          [77.401, 23.262],
        ],
      ],
    };

    // Build 5x5 grids where outside-polygon pixels hold extreme bogus values (999 or 0)
    // Inside 8 intersecting pixels (rows 1 & 2, cols 1..4):
    //   (r=1,c=1): cloud=1 (ET=400 -> excluded)
    //   (r=1,c=2): water=1 (ET=50  -> excluded)
    //   (r=1,c=3): clear, ET=NaN   (-> excluded as invalid)
    //   (r=1,c=4): clear, ET=100   (VALID #1)
    //   (r=2,c=1): clear, ET=120   (VALID #2)
    //   (r=2,c=2): clear, ET=140   (VALID #3)
    //   (r=2,c=3): clear, ET=160   (VALID #4)
    //   (r=2,c=4): clear, ET=180   (VALID #5)
    // Valid values = [100, 120, 140, 160, 180] -> mean=140, min=100, max=180, stdDev=sqrt(800)=28.2843
    const etDailyValues = [
      999, 999, 999, 999, 999,
      999, 400, 50, Number.NaN, 100,
      999, 120, 140, 160, 180,
      0, 0, 999, 999, 999,
      999, 999, 999, 999, 999,
    ];
    // For ESI: (r=1,c=3) has physically invalid ESI=1.45 (> 1.0 -> must be excluded!)
    // Valid ESI values = [0.60, 0.65, 0.70, 0.75, 0.80] -> mean=0.70
    const esiValues = [
      0.99, 0.99, 0.99, 0.99, 0.99,
      0.99, 0.10, 0.95, 1.45, 0.60,
      0.99, 0.65, 0.70, 0.75, 0.80,
      0.01, 0.01, 0.01, 0.01, 0.01,
      0.99, 0.99, 0.99, 0.99, 0.99,
    ];
    const cloudMaskValues = [
      0, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ];
    const waterMaskValues = [
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ];

    const gridOpts = {
      width: 5,
      height: 5,
      scaleX: 0.001,
      scaleY: 0.001,
      tieLon: 77.4,
      tieLat: 23.265,
    };

    const etTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: etDailyValues,
      dataType: 'float32',
      compressDeflate: true,
      nodata: 'NaN',
    });
    const esiTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: esiValues,
      dataType: 'float32',
      compressDeflate: false,
      nodata: 'NaN',
    });
    const cloudTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: cloudMaskValues,
      dataType: 'uint8',
      compressDeflate: true,
      nodata: '255',
    });
    const waterTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: waterMaskValues,
      dataType: 'uint8',
      compressDeflate: false,
      nodata: '255',
    });

    let rasterDownloadCount = 0;
    const files: Record<string, Buffer> = {
      'f-et': etTif,
      'f-cloud': cloudTif,
      'f-water': waterTif,
      'f-esi': esiTif,
    };

    const mockFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/task') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            task_id: 'appeears-geotiff-task-1',
            status: 'pending',
            created: '2026-11-08T00:00:00Z',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/task/appeears-geotiff-task-1')) {
        return new Response(
          JSON.stringify({
            task_id: 'appeears-geotiff-task-1',
            status: 'done',
            progress: { summary: 100 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/bundle/appeears-geotiff-task-1')) {
        return new Response(
          JSON.stringify({
            task_id: 'appeears-geotiff-task-1',
            files: [
              {
                file_id: 'f-et',
                file_name: 'ECO_L3T_JET.002_ETdaily_doy2026310113000_aid0001.tif',
                file_size: etTif.length,
                file_type: 'tif',
              },
              {
                file_id: 'f-cloud',
                file_name: 'ECO_L3T_JET.002_cloud_doy2026310113000_aid0001.tif',
                file_size: cloudTif.length,
                file_type: 'tif',
              },
              {
                file_id: 'f-water',
                file_name: 'ECO_L3T_JET.002_water_doy2026310113000_aid0001.tif',
                file_size: waterTif.length,
                file_type: 'tif',
              },
              {
                file_id: 'f-esi',
                file_name: 'ECO_L4T_ESI.002_ESI_doy2026310113000_aid0001.tif',
                file_size: esiTif.length,
                file_type: 'tif',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      for (const [id, buf] of Object.entries(files)) {
        if (url.endsWith(`/bundle/appeears-geotiff-task-1/${id}`)) {
          rasterDownloadCount += 1;
          return new Response(new Uint8Array(buf), {
            status: 200,
            headers: { 'Content-Type': 'image/tiff' },
          });
        }
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const fixedNowMs = Date.parse('2026-11-10T12:00:00Z');
    const provider = new EcostressAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-token',
      nowFn: () => fixedNowMs,
      staleMaxAgeDays: 30,
    });
    const repo = new EcostressEvapotranspirationRepository({
      provider,
      nowFn: () => fixedNowMs,
    });
    const repositories = createRepositoryContainer();
    repositories.evapotranspiration = repo;
    const services = createServiceContainer(repositories);
    services.evapotranspiration = new EvapotranspirationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      const submitRes = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: polygon,
          dateRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
        }),
      });
      assert.equal(submitRes.status, 202);
      const job = (await submitRes.json()) as ApiSuccessResponse<EcostressJobRecord>;
      assert.equal(job.data.taskType, 'area');

      const resultRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${job.data.jobId}/results`,
      );
      assert.equal(resultRes.status, 200);
      const payload = (await resultRes.json()) as ApiSuccessResponse<EcostressResultPayload>;

      assert.equal(payload.data.summary.totalObservations, 2);
      assert.equal(payload.data.summary.clearSkyObservations, 2);
      assert.equal(payload.data.summary.cloudMaskedObservations, 0);
      assert.equal(payload.data.summary.staleObservations, 0);
      assert.equal(payload.data.summary.meanEtDailyWm2, 140);
      assert.equal(payload.data.summary.meanEsiRatio, 0.7);
      assert.equal(payload.data.summary.meanCoveragePercent, 62.5);
      assert.deepEqual(payload.data.sourceAttribution.productVersions, ['002']);

      const jetObs = payload.data.observations.find((o) => o.productId === 'ECO_L3T_JET.002');
      const esiObs = payload.data.observations.find((o) => o.productId === 'ECO_L4T_ESI.002');
      assert.ok(jetObs);
      assert.ok(esiObs);

      // Day 310 of 2026 is Nov 6 (1=Jan 1 -> 310 = Nov 6 in non-leap year 2026)
      assert.equal(jetObs.observationTimestamp, '2026-11-06T11:30:00.000Z');
      assert.equal(jetObs.retrievalTimestamp, '2026-11-10T12:00:00.000Z');
      assert.equal(jetObs.productVersion, '002');
      assert.equal(jetObs.spatialResolutionMeters, 70);
      assert.equal(jetObs.spatialAggregation, 'polygon_raster_pixels');
      assert.equal(jetObs.intersectingPixelCount, 8);
      assert.equal(jetObs.validPixelCount, 5);
      assert.equal(jetObs.coveragePercent, 62.5);
      assert.equal(jetObs.qualityStatus, 'valid');
      assert.equal(jetObs.isStale, false);
      assert.equal(jetObs.cloudMaskFlag, 0);
      assert.equal(jetObs.waterMaskFlag, 0);
      assert.equal(jetObs.parameterUnits.ETdaily, 'W/m²');
      assert.equal(jetObs.provenance.daac, 'LP DAAC');

      const etStats = jetObs.layerStats?.ETdaily;
      assert.ok(etStats);
      assert.equal(etStats.mean, 140);
      assert.equal(etStats.min, 100);
      assert.equal(etStats.max, 180);
      assert.equal(etStats.stdDev, 28.2843);
      assert.equal(etStats.validPixelCount, 5);
      assert.equal(etStats.intersectingPixelCount, 8);
      assert.equal(etStats.coveragePercent, 62.5);
      assert.equal(etStats.cloudMaskedPixelCount, 1);
      assert.equal(etStats.waterMaskedPixelCount, 1);
      assert.equal(etStats.invalidPixelCount, 1);
      assert.equal(etStats.unit, 'W/m²');

      // Verify ESI out-of-range pixel (1.45) was rejected and only 5 valid pixels counted
      assert.equal(esiObs.esiRatio, 0.7);
      assert.equal(esiObs.validPixelCount, 5);
      assert.equal(esiObs.layerStats?.ESI?.invalidPixelCount, 1);
      assert.equal(esiObs.parameterUnits.ESI, 'Ratio');

      // Verify result cache returns cached=true without re-downloading rasters
      assert.equal(rasterDownloadCount, 4);
      const cachedRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${job.data.jobId}/results`,
      );
      const cachedPayload = (await cachedRes.json()) as ApiSuccessResponse<EcostressResultPayload>;
      assert.equal(cachedPayload.data.sourceAttribution.cached, true);
      assert.equal(rasterDownloadCount, 4);
    } finally {
      await started.close();
    }
  });

  it('never substitutes zeros when all intersecting pixels are cloud-masked, water-masked, or NaN/invalid', async () => {
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

    const buffers: Record<string, Buffer> = {
      // Day 305: 100% cloud masked
      'd1-et': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [200, 200, 200, 200],
        dataType: 'float32',
        nodata: 'NaN',
      }),
      'd1-cloud': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [1, 1, 1, 1],
        dataType: 'uint8',
        nodata: '255',
      }),
      // Day 306: 100% water masked
      'd2-et': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [150, 150, 150, 150],
        dataType: 'float32',
        nodata: 'NaN',
      }),
      'd2-water': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [1, 1, 1, 1],
        dataType: 'uint8',
        nodata: '255',
      }),
      // Day 307: clear sky, all pixels NaN or -9999 fill
      'd3-et': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [Number.NaN, -9999, Number.NaN, -999],
        dataType: 'float32',
        nodata: '-9999',
      }),
      'd3-cloud': buildSyntheticGeoTiff({
        ...gridOpts,
        values: [0, 0, 0, 0],
        dataType: 'uint8',
        nodata: '255',
      }),
    };

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/task')) {
        return new Response(JSON.stringify({ task_id: 'masked-task', status: 'done' }), {
          status: 202,
        });
      }
      if (url.endsWith('/task/masked-task')) {
        return new Response(JSON.stringify({ task_id: 'masked-task', status: 'done' }), {
          status: 200,
        });
      }
      if (url.endsWith('/bundle/masked-task')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'd1-et', file_name: 'ECO_L3T_JET.002_ETdaily_doy2026305100000.tif', file_type: 'tif' },
              { file_id: 'd1-cloud', file_name: 'ECO_L3T_JET.002_cloud_doy2026305100000.tif', file_type: 'tif' },
              { file_id: 'd2-et', file_name: 'ECO_L3T_JET.002_ETdaily_doy2026306100000.tif', file_type: 'tif' },
              { file_id: 'd2-water', file_name: 'ECO_L3T_JET.002_water_doy2026306100000.tif', file_type: 'tif' },
              { file_id: 'd3-et', file_name: 'ECO_L3T_JET.002_ETdaily_doy2026307100000.tif', file_type: 'tif' },
              { file_id: 'd3-cloud', file_name: 'ECO_L3T_JET.002_cloud_doy2026307100000.tif', file_type: 'tif' },
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

    const nowMs = Date.parse('2026-11-10T12:00:00Z');
    const provider = new EcostressAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-token',
      nowFn: () => nowMs,
    });
    const repo = new EcostressEvapotranspirationRepository({ provider, nowFn: () => nowMs });

    const job = await repo.submitJob({
      geometry: polygon,
      dateRange: { startDate: '2026-10-30', endDate: '2026-11-08' },
      products: ['ECO_L3T_JET.002'],
    });
    const result = await repo.getJobResults(job.jobId);

    assert.equal(result.summary.totalObservations, 3);
    assert.equal(result.summary.clearSkyObservations, 0);
    assert.equal(result.summary.cloudMaskedObservations, 1);
    assert.equal(result.summary.waterMaskedObservations, 1);
    assert.equal(result.summary.invalidOrMissingObservations, 1);
    assert.equal(result.summary.meanEtDailyWm2, null);
    assert.equal(result.summary.latestEtDailyWm2, null);
    assert.equal(result.summary.meanCoveragePercent, 0);

    const [cloudObs, waterObs, invalidObs] = result.observations;
    assert.equal(cloudObs.qualityStatus, 'cloud_masked');
    assert.equal(cloudObs.cloudMaskFlag, 1);
    assert.equal(cloudObs.etDailyWm2, null);
    assert.equal(cloudObs.validPixelCount, 0);
    assert.equal(cloudObs.coveragePercent, 0);

    assert.equal(waterObs.qualityStatus, 'water_masked');
    assert.equal(waterObs.waterMaskFlag, 1);
    assert.equal(waterObs.etDailyWm2, null);

    assert.equal(invalidObs.qualityStatus, 'invalid_data');
    assert.equal(invalidObs.etDailyWm2, null);
    assert.equal(invalidObs.validPixelCount, 0);
    assert.equal(invalidObs.coveragePercent, 0);
  });

  it('enforces scientific safeguards: does not convert instantaneous ET to daily ET, flags stale data, and handles corrupt/missing/non-intersecting data safely', async () => {
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

    // Valid instantaneous PTJPLSMinst = 255 W/m² on 2026-09-01 (doy2026244) — > 30 days stale on 2026-11-10
    const instTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [255, 255, 255, 255],
      dataType: 'float32',
      nodata: 'NaN',
    });
    const clearCloudTif = buildSyntheticGeoTiff({
      ...gridOpts,
      values: [0, 0, 0, 0],
      dataType: 'uint8',
      nodata: '255',
    });
    // Non-intersecting raster grid located far away (lon=80.0, lat=20.0)
    const outsideTif = buildSyntheticGeoTiff({
      width: 2,
      height: 2,
      scaleX: 0.001,
      scaleY: 0.001,
      tieLon: 80.0,
      tieLat: 20.0,
      values: [110, 120, 130, 140],
      dataType: 'float32',
      nodata: 'NaN',
    });

    let mode: 'stale_inst' | 'corrupt_tif' | 'outside_polygon' | 'empty_bundle' | 'failed_job' =
      'stale_inst';

    const mockFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/task')) {
        return new Response(JSON.stringify({ task_id: `task-${mode}`, status: 'pending' }), {
          status: 202,
        });
      }
      if (url.includes('/task/task-failed_job')) {
        return new Response(
          JSON.stringify({
            task_id: 'task-failed_job',
            status: 'error',
            error: 'AppEEARS granule subsetting failed upstream.',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/task/')) {
        const taskId = url.split('/').pop()!;
        return new Response(JSON.stringify({ task_id: taskId, status: 'done' }), { status: 200 });
      }
      if (url.endsWith('/bundle/task-stale_inst')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'inst', file_name: 'ECO_L3T_JET.002_PTJPLSMinst_doy2026244120000.tif', file_type: 'tif' },
              { file_id: 'cld', file_name: 'ECO_L3T_JET.002_cloud_doy2026244120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/bundle/task-corrupt_tif')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'bad', file_name: 'ECO_L3T_JET.002_ETdaily_doy2026310120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/bundle/task-outside_polygon')) {
        return new Response(
          JSON.stringify({
            files: [
              { file_id: 'out', file_name: 'ECO_L3T_JET.002_ETdaily_doy2026310120000.tif', file_type: 'tif' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/bundle/task-empty_bundle')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.endsWith('/inst')) return new Response(new Uint8Array(instTif), { status: 200 });
      if (url.endsWith('/cld')) return new Response(new Uint8Array(clearCloudTif), { status: 200 });
      if (url.endsWith('/bad')) return new Response(new Uint8Array([0x00, 0x01, 0x02]), { status: 200 });
      if (url.endsWith('/out')) return new Response(new Uint8Array(outsideTif), { status: 200 });
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const nowMs = Date.parse('2026-11-10T12:00:00Z');
    const provider = new EcostressAppEearsProvider({
      fetchFn: mockFetch,
      appeearsToken: 'test-token',
      nowFn: () => nowMs,
      staleMaxAgeDays: 30,
    });
    const repo = new EcostressEvapotranspirationRepository({ provider, nowFn: () => nowMs });
    const repositories = createRepositoryContainer();
    repositories.evapotranspiration = repo;
    const services = createServiceContainer(repositories);
    services.evapotranspiration = new EvapotranspirationService(repo);
    const app = createApp({ repositories, services });
    const started = await startTestServer(app);

    try {
      // 1. Instantaneous ET must NEVER be converted to ETdaily, and >30d data is flagged stale
      mode = 'stale_inst';
      const job1 = await repo.submitJob({
        geometry: polygon,
        dateRange: { startDate: '2026-08-25', endDate: '2026-09-05' },
        products: ['ECO_L3T_JET.002'],
      });
      const res1 = await repo.getJobResults(job1.jobId);
      assert.equal(res1.observations.length, 1);
      assert.equal(res1.observations[0].ptjplsmInstWm2, 255);
      assert.equal(res1.observations[0].etDailyWm2, null);
      assert.equal(res1.summary.meanInstantaneousEtWm2, 255);
      assert.equal(res1.summary.meanEtDailyWm2, null);
      assert.equal(res1.observations[0].isStale, true);
      assert.equal(res1.observations[0].qualityStatus, 'stale');
      assert.equal(res1.summary.staleObservations, 1);

      const allCaveats = res1.caveats.join(' ').toLowerCase();
      assert.ok(allCaveats.includes('never converted into daily et'));
      assert.ok(allCaveats.includes('selected crop'));
      assert.ok(allCaveats.includes('crop water requirements'));
      assert.ok(allCaveats.includes('soil nutrients'));

      // 2. Corrupt GeoTIFF yields invalid_data with null metrics (never 0)
      mode = 'corrupt_tif';
      const job2 = await repo.submitJob({
        geometry: polygon,
        dateRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
        products: ['ECO_L3T_JET.002'],
      });
      const res2 = await repo.getJobResults(job2.jobId);
      assert.equal(res2.observations[0].qualityStatus, 'invalid_data');
      assert.equal(res2.observations[0].etDailyWm2, null);
      assert.equal(res2.summary.meanEtDailyWm2, null);

      // 3. Non-intersecting polygon yields missing_data with 0 coverage and null metrics
      mode = 'outside_polygon';
      const job3 = await repo.submitJob({
        geometry: polygon,
        dateRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
        products: ['ECO_L3T_JET.002'],
      });
      const res3 = await repo.getJobResults(job3.jobId);
      assert.equal(res3.observations[0].intersectingPixelCount, 0);
      assert.equal(res3.observations[0].validPixelCount, 0);
      assert.equal(res3.observations[0].coveragePercent, 0);
      assert.equal(res3.observations[0].qualityStatus, 'missing_data');
      assert.equal(res3.observations[0].etDailyWm2, null);

      // 4. Empty bundle yields 0 observations and null summaries
      mode = 'empty_bundle';
      const job4 = await repo.submitJob({
        geometry: polygon,
        dateRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
        products: ['ECO_L3T_JET.002'],
      });
      const res4 = await repo.getJobResults(job4.jobId);
      assert.equal(res4.summary.totalObservations, 0);
      assert.equal(res4.summary.meanEtDailyWm2, null);

      // 5. Failed upstream job returns HTTP 502 without fabricated data
      mode = 'failed_job';
      const submitFail = await fetch(`${started.baseUrl}/api/v1/evapotranspiration/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: polygon,
          dateRange: { startDate: '2026-11-01', endDate: '2026-11-10' },
        }),
      });
      const failJob = (await submitFail.json()) as ApiSuccessResponse<EcostressJobRecord>;
      const failRes = await fetch(
        `${started.baseUrl}/api/v1/evapotranspiration/jobs/${failJob.data.jobId}/results`,
      );
      assert.equal(failRes.status, 502);
      const failErr = (await failRes.json()) as ApiErrorResponse;
      assert.equal(failErr.success, false);
    } finally {
      await started.close();
    }
  });
});
