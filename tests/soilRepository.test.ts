import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { CompositeSoilGridsProvider } from '../server/providers/CompositeSoilGridsProvider.ts';
import type { ISoilGridsProvider } from '../server/providers/ISoilGridsProvider.ts';
import { NasaSmapMoistureProvider } from '../server/providers/NasaSmapMoistureProvider.ts';
import { SoilGridsRestProvider } from '../server/providers/SoilGridsRestProvider.ts';
import { SoilGridsWcsProvider } from '../server/providers/SoilGridsWcsProvider.ts';
import { SoilRepository } from '../server/repositories/implementations/SoilRepository.ts';
import { parseSingleBandInt16Tiff } from '../server/utils/binaryImageDecoders.ts';
import type { FetchLike } from '../server/utils/resilientHttp.ts';
import { classifyUsdaSoilTexture } from '../server/utils/soilTexture.ts';

/**
 * Helper to synthesize a valid minimal 1x1 uncompressed little-endian signed Int16 GeoTIFF
 * for unit testing WCS fallback without hitting external endpoints.
 */
function buildTestInt16Tiff(value: number): Buffer {
  // Header (8) + IFD count (2) + 7 tags * 12 (84) + nextIFD (4) = 98; pixel at offset 98
  const buf = Buffer.alloc(100);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);

  const tags: Array<[number, number, number, number]> = [
    [256, 3, 1, 1], // ImageWidth = 1
    [257, 3, 1, 1], // ImageLength = 1
    [258, 3, 1, 16], // BitsPerSample = 16
    [259, 3, 1, 1], // Compression = 1 (None)
    [273, 4, 1, 98], // StripOffsets = 98
    [279, 4, 1, 2], // StripByteCounts = 2
    [339, 3, 1, 2], // SampleFormat = 2 (Signed Int)
  ];

  buf.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, count, val], idx) => {
    const off = 10 + idx * 12;
    buf.writeUInt16LE(tag, off);
    buf.writeUInt16LE(type, off + 2);
    buf.writeUInt32LE(count, off + 4);
    if (type === 3) {
      buf.writeUInt16LE(val, off + 8);
    } else {
      buf.writeUInt32LE(val, off + 8);
    }
  });
  buf.writeUInt32LE(0, 10 + tags.length * 12);
  buf.writeInt16LE(value, 98);
  return buf;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildSolidRgbaPng256(r: number, g: number, b: number, a: number): Buffer {
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const rowLen = 1 + 256 * 4;
  const raw = Buffer.alloc(256 * rowLen);
  for (let y = 0; y < 256; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < 256; x++) {
      const p = rowStart + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Module 4 Soil Intelligence: SoilGrids REST, WCS fallback, SMAP moisture, and USDA texture', () => {
  it('classifies USDA soil textures accurately and returns null for missing fractions', () => {
    assert.equal(classifyUsdaSoilTexture(32, 42, 26), 'Loam');
    assert.equal(classifyUsdaSoilTexture(24, 42, 34), 'Clay Loam');
    assert.equal(classifyUsdaSoilTexture(15, 65, 20), 'Silt Loam');
    assert.equal(classifyUsdaSoilTexture(92, 5, 3), 'Sand');
    assert.equal(classifyUsdaSoilTexture(null, 40, 20), null);
    assert.equal(classifyUsdaSoilTexture(0, 0, 0), null);
  });

  it('scales SoilGrids REST v2.0 properties, captures Q0.05/Q0.95 bounds, and caches responses', async () => {
    let calls = 0;
    const mockFetch: FetchLike = async (input) => {
      calls += 1;
      const url = String(input);
      const isBatchA = url.includes('property=phh2o');
      const layers = isBatchA
        ? [
            {
              name: 'phh2o',
              unit_measure: { d_factor: 10 },
              depths: [
                { label: '0-5cm', values: { mean: 66, 'Q0.05': 58, 'Q0.95': 74, uncertainty: 24 } },
                { label: '5-15cm', values: { mean: 65, 'Q0.05': 57, 'Q0.95': 73, uncertainty: 25 } },
                { label: '15-30cm', values: { mean: 67, 'Q0.05': 59, 'Q0.95': 75, uncertainty: 24 } },
                { label: '30-60cm', values: { mean: 70, 'Q0.05': 61, 'Q0.95': 78, uncertainty: 24 } },
              ],
            },
            {
              name: 'soc',
              unit_measure: { d_factor: 10 },
              depths: [
                { label: '0-5cm', values: { mean: 245, 'Q0.05': 140, 'Q0.95': 380, uncertainty: 98 } },
              ],
            },
            {
              name: 'nitrogen',
              unit_measure: { d_factor: 100 },
              depths: [
                { label: '0-5cm', values: { mean: 225, 'Q0.05': 150, 'Q0.95': 320, uncertainty: 75 } },
              ],
            },
            {
              name: 'bdod',
              unit_measure: { d_factor: 100 },
              depths: [
                { label: '0-5cm', values: { mean: 131, 'Q0.05': 90, 'Q0.95': 167, uncertainty: 59 } },
              ],
            },
          ]
        : [
            {
              name: 'sand',
              unit_measure: { d_factor: 10 },
              depths: [{ label: '0-5cm', values: { mean: 280, 'Q0.05': 180, 'Q0.95': 390, uncertainty: 75 } }],
            },
            {
              name: 'silt',
              unit_measure: { d_factor: 10 },
              depths: [{ label: '0-5cm', values: { mean: 430, 'Q0.05': 330, 'Q0.95': 540, uncertainty: 49 } }],
            },
            {
              name: 'clay',
              unit_measure: { d_factor: 10 },
              depths: [{ label: '0-5cm', values: { mean: 290, 'Q0.05': 210, 'Q0.95': 380, uncertainty: 59 } }],
            },
            {
              name: 'cec',
              unit_measure: { d_factor: 10 },
              depths: [{ label: '0-5cm', values: { mean: 220, 'Q0.05': 160, 'Q0.95': 310, uncertainty: 68 } }],
            },
          ];

      return new Response(JSON.stringify({ properties: { layers } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const provider = new SoilGridsRestProvider({ fetchFn: mockFetch, cacheTtlMs: 60_000 });
    const first = await provider.fetchDepthProfile({ latitude: 42.0308, longitude: -93.6319 });

    assert.equal(calls, 2);
    assert.equal(first.providerUsed, 'soilgrids-rest-v2');
    assert.equal(first.fallbackUsed, false);
    assert.equal(first.status, 'partial');
    assert.equal(first.depthLayers[0].ph.mean, 6.6);
    assert.equal(first.depthLayers[0].ph.q05, 5.8);
    assert.equal(first.depthLayers[0].ph.q95, 7.4);
    assert.equal(first.depthLayers[0].organicCarbonGKg.mean, 24.5);
    assert.equal(first.depthLayers[0].nitrogenGKg.mean, 2.25);
    assert.equal(first.depthLayers[0].bulkDensityKgDm3.mean, 1.31);
    assert.equal(first.depthLayers[0].cecCmolKg.mean, 22.0);
    assert.equal(first.depthLayers[0].textureClass, 'Clay Loam');

    const second = await provider.fetchDepthProfile({ latitude: 42.0308, longitude: -93.6319 });
    assert.equal(calls, 2);
    assert.equal(second.sourceAttribution.cached, true);
  });

  it('falls back to SoilGrids WCS GeoTIFF provider when REST v2.0 is unavailable and marks fallbackUsed', async () => {
    const tiffSample = parseSingleBandInt16Tiff(buildTestInt16Tiff(66));
    assert.equal(tiffSample.value, 66);

    const failingPrimary: ISoilGridsProvider = {
      providerId: 'mock-failing-rest',
      fetchDepthProfile: async () => {
        throw new Error('ISRIC REST v2.0 timed out after 6000ms');
      },
    };

    const mockWcsFetch: FetchLike = async (input) => {
      const url = String(input);
      let raw = 100;
      if (url.includes('phh2o')) raw = 66;
      else if (url.includes('bdod')) raw = 131;
      else if (url.includes('soc')) raw = 210;
      else if (url.includes('nitrogen')) raw = 185;
      else if (url.includes('sand')) raw = 300;
      else if (url.includes('silt')) raw = 450;
      else if (url.includes('clay')) raw = 250;
      else if (url.includes('cec')) raw = 195;

      return new Response(new Uint8Array(buildTestInt16Tiff(raw)), {
        status: 200,
        headers: { 'Content-Type': 'image/tiff' },
      });
    };

    const wcsFallback = new SoilGridsWcsProvider({ fetchFn: mockWcsFetch, concurrency: 8 });
    const composite = new CompositeSoilGridsProvider({
      primaryProvider: failingPrimary,
      fallbackProvider: wcsFallback,
    });

    const repo = new SoilRepository({ soilGridsProvider: composite });
    const profile = await repo.fetchSoilProfile({
      location: { latitude: 42.0, longitude: -93.6 },
      boundary: {
        id: 'parcel-1',
        name: 'North Quarter',
        areaHectares: 64.2,
        centroid: { latitude: 42.0308, longitude: -93.6319 },
      },
      depthCm: '5-15',
    });

    assert.equal(profile.dataClassification, 'modelled_estimate');
    assert.equal(profile.providerUsed, 'soilgrids-wcs-fallback');
    assert.equal(profile.fallbackUsed, true);
    assert.match(profile.fallbackReason ?? '', /timed out/i);
    assert.equal(profile.location.latitude, 42.0308);
    assert.equal(profile.surfaceSummary.depthIntervalCm, '5-15');
    assert.equal(profile.surfaceSummary.ph.mean, 6.6);
    assert.equal(profile.surfaceSummary.textureClass, 'Loam');
  });

  it('returns honest unavailable state when both SoilGrids REST and WCS fail without fabricating data', async () => {
    const failingProvider: ISoilGridsProvider = {
      providerId: 'mock-offline',
      fetchDepthProfile: async () => {
        throw new Error('Upstream offline');
      },
    };

    const composite = new CompositeSoilGridsProvider({
      primaryProvider: failingProvider,
      fallbackProvider: failingProvider,
    });

    const result = await composite.fetchDepthProfile({ latitude: 42.0, longitude: -93.6 });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.providerUsed, 'none');
    assert.equal(result.depthLayers[0].ph.mean, null);
    assert.equal(result.depthLayers[0].textureClass, null);
  });

  it('decodes NASA SMAP L4 GIBS PNG tiles against official colormap XML and handles transparent NoData pixels', async () => {
    const sampleColormap = `<?xml version="1.0" encoding="UTF-8"?>
<ColorMaps>
  <ColorMap title="No Data"><Entries><ColorMapEntry rgb="0,0,0" transparent="true" nodata="true"/></Entries></ColorMap>
  <ColorMap title="Soil Moisture" units="m³/m³">
    <Entries>
      <ColorMapEntry rgb="0,243,255" transparent="false" value="[0.358,0.361)" ref="100"/>
      <ColorMapEntry rgb="0,253,255" transparent="false" value="[0.353,0.356)" ref="101"/>
    </Entries>
  </ColorMap>
</ColorMaps>`;

    const surfacePng = buildSolidRgbaPng256(0, 243, 255, 255);
    const rootZonePng = buildSolidRgbaPng256(0, 253, 255, 255);
    const emptyPng = buildSolidRgbaPng256(0, 0, 0, 0);

    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('SMAP_Analyzed_Soil_Moisture.xml')) {
        return new Response(sampleColormap, { status: 200 });
      }
      if (url.includes('SMAP_L4_Analyzed_Surface_Soil_Moisture')) {
        return new Response(new Uint8Array(surfacePng), { status: 200 });
      }
      if (url.includes('SMAP_L4_Analyzed_Root_Zone_Soil_Moisture')) {
        return new Response(new Uint8Array(rootZonePng), { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const smap = new NasaSmapMoistureProvider({ fetchFn: mockFetch });
    const snapshot = await smap.fetchSoilMoisture(
      { latitude: 42.0308, longitude: -93.6319 },
      { dateRange: { startDate: '2026-11-08', endDate: '2026-11-10' } },
    );

    assert.equal(snapshot.dataClassification, 'satellite_derived');
    assert.equal(snapshot.status, 'available');
    assert.equal(snapshot.units, 'm³/m³');
    assert.equal(snapshot.surfaceMoistureM3M3, 0.359);
    assert.equal(snapshot.rootZoneMoistureM3M3, 0.354);
    assert.equal(snapshot.moistureSeries.length, 3);

    const noDataFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('SMAP_Analyzed_Soil_Moisture.xml')) {
        return new Response(sampleColormap, { status: 200 });
      }
      return new Response(new Uint8Array(emptyPng), { status: 200 });
    };

    const smapNoData = new NasaSmapMoistureProvider({ fetchFn: noDataFetch });
    const unavailable = await smapNoData.fetchSoilMoisture(
      { latitude: 0, longitude: -30 },
      { dateRange: { startDate: '2026-11-10', endDate: '2026-11-10' } },
    );

    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.surfaceMoistureM3M3, null);
    assert.equal(unavailable.rootZoneMoistureM3M3, null);
  });
});
