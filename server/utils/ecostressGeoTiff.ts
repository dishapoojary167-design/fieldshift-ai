import zlib from 'node:zlib';
import type {
  EcostressLayerId,
  EcostressPolygonStats,
  EcostressProductId,
  GeoJsonPolygon,
} from '../../shared/index.ts';
import { ECOSTRESS_PRODUCT_SPECS } from '../providers/ecostress/ecostressProducts.ts';

export interface ParsedGeoTiffGrid {
  width: number;
  height: number;
  values: Float64Array;
  nodata: number | null;
  scaleX: number;
  scaleY: number;
  tieX: number;
  tieY: number;
  tieI: number;
  tieJ: number;
}

export interface ParsedEcostressRasterFileMeta {
  productId: EcostressProductId;
  layer: EcostressLayerId;
  observationTimestamp: string;
}

const KNOWN_LAYER_NAMES = new Set<string>([
  'ETdaily',
  'ETinstUncertainty',
  'PTJPLSMinst',
  'STICinst',
  'MOD16inst',
  'BESSinst',
  'PTJPLSMcanopy',
  'PTJPLSMsoil',
  'PTJPLSMinterception',
  'STICcanopy',
  'ESI',
  'PET',
  'cloud',
  'water',
]);

function doyToIsoTimestamp(year: number, dayOfYear: number, hh = 0, mm = 0, ss = 0): string {
  const baseMs = Date.UTC(year, 0, 1, hh, mm, ss);
  const dt = new Date(baseMs + (dayOfYear - 1) * 86_400_000);
  return dt.toISOString();
}

/**
 * Extracts ECOSTRESS product ID, layer name, and UTC observation timestamp
 * from AppEEARS GeoTIFF filenames such as:
 *   ECO_L3T_JET.002_ETdaily_doy2026200103245_aid0001.tif
 *   ECO_L4T_ESI.002_ESI_doy2026200_aid0001.tif
 */
export function parseAppeearsEcostressFilename(
  fileName: string,
): ParsedEcostressRasterFileMeta | null {
  const base = fileName.split('/').pop() ?? fileName;

  let productId: EcostressProductId | null = null;
  if (/ECO_L4T_ESI(?:[._]002)?/i.test(base)) {
    productId = 'ECO_L4T_ESI.002';
  } else if (/ECO_L3T_JET(?:[._]002)?/i.test(base)) {
    productId = 'ECO_L3T_JET.002';
  }
  if (!productId) {
    return null;
  }

  let matchedLayer: EcostressLayerId | null = null;
  for (const candidate of KNOWN_LAYER_NAMES) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:_|\\.)${escaped}(?:_|\\.)`, 'i').test(base)) {
      matchedLayer = candidate as EcostressLayerId;
      break;
    }
  }
  if (!matchedLayer) {
    return null;
  }

  // Match AppEEARS doyYYYYDDDHHMMSS or doyYYYYDDD
  const doyFull = base.match(/doy(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/i);
  if (doyFull) {
    const year = Number(doyFull[1]);
    const doy = Number(doyFull[2]);
    const hh = Number(doyFull[3]);
    const mm = Number(doyFull[4]);
    const ss = Number(doyFull[5]);
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: doyToIsoTimestamp(year, doy, hh, mm, ss),
    };
  }

  const doyShort = base.match(/doy(\d{4})(\d{3})/i);
  if (doyShort) {
    const year = Number(doyShort[1]);
    const doy = Number(doyShort[2]);
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: doyToIsoTimestamp(year, doy),
    };
  }

  const isoMatch = base.match(/(\d{4}-\d{2}-\d{2})(?:T(\d{2})[:-]?(\d{2})[:-]?(\d{2})Z?)?/);
  if (isoMatch) {
    const datePart = isoMatch[1];
    if (isoMatch[2]) {
      return {
        productId,
        layer: matchedLayer,
        observationTimestamp: `${datePart}T${isoMatch[2]}:${isoMatch[3]}:${isoMatch[4]}.000Z`,
      };
    }
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: `${datePart}T00:00:00.000Z`,
    };
  }

  return null;
}

function uncompressTiffSegment(raw: Buffer, compression: number): Buffer {
  if (compression === 1) {
    return raw;
  }
  if (compression === 8 || compression === 32946) {
    return zlib.inflateSync(raw);
  }
  throw new Error(`Unsupported GeoTIFF compression code: ${compression}.`);
}

/**
 * Pure-Node Classic GeoTIFF grid parser supporting uint8, int16/uint16, float32, and float64
 * rasters (stripped or tiled, uncompressed or Deflate/Zlib, optional predictor=2) with WGS84
 * ModelPixelScaleTag (33550) & ModelTiepointTag (33922).
 */
export function parseGeoTiffGrid(buf: Buffer): ParsedGeoTiffGrid {
  if (buf.length < 16) {
    throw new Error('GeoTIFF buffer too short.');
  }

  const endian = buf.toString('ascii', 0, 2);
  if (endian !== 'II' && endian !== 'MM') {
    throw new Error(`Invalid TIFF endian header: "${endian}".`);
  }
  const le = endian === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o: number) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));

  const version = u16(2);
  if (version !== 42) {
    throw new Error(`Unsupported TIFF magic version ${version}; expected Classic TIFF (42).`);
  }

  const ifdOffset = u32(4);
  if (ifdOffset + 2 > buf.length) {
    throw new Error('GeoTIFF IFD offset out of range.');
  }

  const entryCount = u16(ifdOffset);
  const tags = new Map<
    number,
    { type: number; count: number; valueOrOffset: number; inlineU16: number }
  >();

  for (let i = 0; i < entryCount; i++) {
    const off = ifdOffset + 2 + i * 12;
    if (off + 12 > buf.length) break;
    tags.set(u16(off), {
      type: u16(off + 2),
      count: u32(off + 4),
      inlineU16: u16(off + 8),
      valueOrOffset: u32(off + 8),
    });
  }

  const readScalar = (tagId: number, fallback: number): number => {
    const t = tags.get(tagId);
    if (!t) return fallback;
    if (t.count === 1 && t.type === 3) return t.inlineU16;
    if (t.count === 1 && t.type === 4) return t.valueOrOffset;
    return t.valueOrOffset;
  };

  const readNumberArray = (tagId: number): number[] => {
    const t = tags.get(tagId);
    if (!t) return [];
    if (t.count === 1 && t.type !== 12) {
      return [t.type === 3 ? t.inlineU16 : t.valueOrOffset];
    }
    const elemSize = t.type === 3 ? 2 : t.type === 12 ? 8 : 4;
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const pos = t.valueOrOffset + i * elemSize;
      if (pos + elemSize > buf.length) break;
      if (t.type === 3) out.push(u16(pos));
      else if (t.type === 12) out.push(f64(pos));
      else out.push(u32(pos));
    }
    return out;
  };

  const width = readScalar(256, 0);
  const height = readScalar(257, 0);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid GeoTIFF dimensions ${width}x${height}.`);
  }

  const bitsPerSample = readScalar(258, 8);
  const compression = readScalar(259, 1);
  const predictor = readScalar(317, 1);
  const sampleFormat = readScalar(339, 1); // 1=uint, 2=int, 3=ieee float

  if (![8, 16, 32, 64].includes(bitsPerSample)) {
    throw new Error(`Unsupported GeoTIFF BitsPerSample=${bitsPerSample}.`);
  }

  let nodata: number | null = null;
  const nodataTag = tags.get(42113);
  if (
    nodataTag &&
    nodataTag.count > 0 &&
    nodataTag.valueOrOffset + nodataTag.count <= buf.length
  ) {
    const rawStr = buf
      .toString('ascii', nodataTag.valueOrOffset, nodataTag.valueOrOffset + nodataTag.count)
      .replace(/\0+$/, '')
      .trim();
    if (rawStr.toLowerCase() === 'nan') {
      nodata = Number.NaN;
    } else {
      const parsed = Number.parseFloat(rawStr);
      if (Number.isFinite(parsed)) {
        nodata = parsed;
      }
    }
  }

  const pixelScale = readNumberArray(33550);
  const tiepoints = readNumberArray(33922);
  if (pixelScale.length < 2 || tiepoints.length < 6) {
    throw new Error('GeoTIFF missing required ModelPixelScaleTag (33550) or ModelTiepointTag (33922).');
  }

  const scaleX = pixelScale[0];
  const scaleY = pixelScale[1];
  const tieI = tiepoints[0];
  const tieJ = tiepoints[1];
  const tieX = tiepoints[3];
  const tieY = tiepoints[4];

  const isTiled = tags.has(324);
  const offsets = isTiled ? readNumberArray(324) : readNumberArray(273);
  const byteCounts = isTiled ? readNumberArray(325) : readNumberArray(279);
  if (offsets.length === 0 || byteCounts.length === 0) {
    throw new Error('GeoTIFF missing strip/tile offsets.');
  }

  const bytesPerSample = bitsPerSample / 8;
  const readSample = (seg: Buffer, pos: number): number => {
    if (bitsPerSample === 8) {
      return sampleFormat === 2 ? seg.readInt8(pos) : seg.readUInt8(pos);
    }
    if (bitsPerSample === 16) {
      if (sampleFormat === 2) return le ? seg.readInt16LE(pos) : seg.readInt16BE(pos);
      return le ? seg.readUInt16LE(pos) : seg.readUInt16BE(pos);
    }
    if (bitsPerSample === 32) {
      if (sampleFormat === 3) return le ? seg.readFloatLE(pos) : seg.readFloatBE(pos);
      if (sampleFormat === 2) return le ? seg.readInt32LE(pos) : seg.readInt32BE(pos);
      return le ? seg.readUInt32LE(pos) : seg.readUInt32BE(pos);
    }
    if (sampleFormat === 3) return le ? seg.readDoubleLE(pos) : seg.readDoubleBE(pos);
    throw new Error(`Unsupported 64-bit integer sampleFormat=${sampleFormat}`);
  };

  const applyHorizontalDifferencing = (seg: Buffer, rowWidth: number, rows: number) => {
    if (predictor !== 2) return;
    if (bitsPerSample === 8) {
      for (let r = 0; r < rows; r++) {
        const base = r * rowWidth;
        for (let c = 1; c < rowWidth && base + c < seg.length; c++) {
          seg[base + c] = (seg[base + c - 1] + seg[base + c]) & 0xff;
        }
      }
    } else if (bitsPerSample === 16) {
      for (let r = 0; r < rows; r++) {
        const base = r * rowWidth * 2;
        for (let c = 1; c < rowWidth && base + c * 2 + 1 < seg.length; c++) {
          const prev = le ? seg.readUInt16LE(base + (c - 1) * 2) : seg.readUInt16BE(base + (c - 1) * 2);
          const curr = le ? seg.readUInt16LE(base + c * 2) : seg.readUInt16BE(base + c * 2);
          const sum = (prev + curr) & 0xffff;
          if (le) seg.writeUInt16LE(sum, base + c * 2);
          else seg.writeUInt16BE(sum, base + c * 2);
        }
      }
    }
  };

  const values = new Float64Array(width * height);
  values.fill(Number.NaN);

  if (isTiled) {
    const tileWidth = readScalar(322, width);
    const tileHeight = readScalar(323, height);
    const tilesAcross = Math.ceil(width / tileWidth);

    for (let tIdx = 0; tIdx < offsets.length; tIdx++) {
      const off = offsets[tIdx];
      const count = byteCounts[tIdx] ?? 0;
      if (count <= 0 || off + count > buf.length) continue;

      const raw = Buffer.from(uncompressTiffSegment(buf.subarray(off, off + count), compression));
      applyHorizontalDifferencing(raw, tileWidth, tileHeight);

      const tileRow = Math.floor(tIdx / tilesAcross);
      const tileCol = tIdx % tilesAcross;
      const startY = tileRow * tileHeight;
      const startX = tileCol * tileWidth;

      for (let ty = 0; ty < tileHeight; ty++) {
        const imgY = startY + ty;
        if (imgY >= height) break;
        for (let tx = 0; tx < tileWidth; tx++) {
          const imgX = startX + tx;
          if (imgX >= width) break;
          const pos = (ty * tileWidth + tx) * bytesPerSample;
          if (pos + bytesPerSample <= raw.length) {
            values[imgY * width + imgX] = readSample(raw, pos);
          }
        }
      }
    }
  } else {
    const rowsPerStrip = readScalar(278, height);
    for (let sIdx = 0; sIdx < offsets.length; sIdx++) {
      const off = offsets[sIdx];
      const count = byteCounts[sIdx] ?? 0;
      if (count <= 0 || off + count > buf.length) continue;

      const startY = sIdx * rowsPerStrip;
      const stripRows = Math.min(rowsPerStrip, height - startY);
      const raw = Buffer.from(uncompressTiffSegment(buf.subarray(off, off + count), compression));
      applyHorizontalDifferencing(raw, width, stripRows);

      for (let sy = 0; sy < stripRows; sy++) {
        const imgY = startY + sy;
        for (let x = 0; x < width; x++) {
          const pos = (sy * width + x) * bytesPerSample;
          if (pos + bytesPerSample <= raw.length) {
            values[imgY * width + x] = readSample(raw, pos);
          }
        }
      }
    }
  }

  return {
    width,
    height,
    values,
    nodata,
    scaleX,
    scaleY,
    tieX,
    tieY,
    tieI,
    tieJ,
  };
}

function pointInRing(lon: number, lat: number, ring: Array<readonly number[]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    // Treat boundary points as inside
    const onSegment =
      ((yi <= lat && lat <= yj) || (yj <= lat && lat <= yi)) &&
      Math.abs((xj - xi) * (lat - yi) - (lon - xi) * (yj - yi)) < 1e-12 &&
      lon >= Math.min(xi, xj) - 1e-12 &&
      lon <= Math.max(xi, xj) + 1e-12;
    if (onSegment) return true;

    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInGeoJsonPolygon(
  lon: number,
  lat: number,
  polygon: GeoJsonPolygon,
): boolean {
  const rings = polygon.coordinates;
  if (rings.length === 0 || !pointInRing(lon, lat, rings[0])) {
    return false;
  }
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lon, lat, rings[h])) {
      return false;
    }
  }
  return true;
}

export function getIntersectingPixelIndices(
  grid: ParsedGeoTiffGrid,
  polygon?: GeoJsonPolygon,
): number[] {
  const total = grid.width * grid.height;
  if (!polygon) {
    const all: number[] = [];
    for (let i = 0; i < total; i++) all.push(i);
    return all;
  }

  const indices: number[] = [];
  for (let row = 0; row < grid.height; row++) {
    const lat = grid.tieY - (row + 0.5 - grid.tieJ) * grid.scaleY;
    for (let col = 0; col < grid.width; col++) {
      const lon = grid.tieX + (col + 0.5 - grid.tieI) * grid.scaleX;
      if (isPointInGeoJsonPolygon(lon, lat, polygon)) {
        indices.push(row * grid.width + col);
      }
    }
  }

  // Sub-pixel farm parcel fallback: if parcel polygon is smaller than 1 pixel center spacing,
  // intersect pixel bounding boxes against the polygon bounding box/vertices.
  if (indices.length === 0 && polygon.coordinates[0]?.length > 0) {
    const outer = polygon.coordinates[0];
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [lon, lat] of outer) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    const halfX = grid.scaleX / 2;
    const halfY = grid.scaleY / 2;
    for (let row = 0; row < grid.height; row++) {
      const lat = grid.tieY - (row + 0.5 - grid.tieJ) * grid.scaleY;
      if (lat + halfY < south || lat - halfY > north) continue;
      for (let col = 0; col < grid.width; col++) {
        const lon = grid.tieX + (col + 0.5 - grid.tieI) * grid.scaleX;
        if (lon + halfX < west || lon - halfX > east) continue;
        indices.push(row * grid.width + col);
      }
    }
  }

  return indices;
}

export function isValidPhysicalLayerValue(layer: EcostressLayerId, value: number): boolean {
  if (!Number.isFinite(value) || value === -9999 || value === -999) {
    return false;
  }
  switch (layer) {
    case 'ESI':
    case 'PTJPLSMcanopy':
    case 'PTJPLSMsoil':
    case 'PTJPLSMinterception':
    case 'STICcanopy':
      return value >= 0 && value <= 1;
    case 'ETinstUncertainty':
      return value >= 0 && value <= 1000;
    case 'ETdaily':
    case 'PTJPLSMinst':
    case 'STICinst':
    case 'MOD16inst':
    case 'BESSinst':
    case 'PET':
      return value >= -200 && value <= 1500;
    case 'cloud':
    case 'water':
      return value === 0 || value === 1;
    default:
      return true;
  }
}

export function getEcostressLayerUnit(
  productId: EcostressProductId,
  layer: EcostressLayerId,
): string {
  const spec = ECOSTRESS_PRODUCT_SPECS[productId];
  return spec.layers.find((l) => l.layer === layer)?.units ?? 'unknown';
}

export function computePolygonLayerStatistics(params: {
  grid: ParsedGeoTiffGrid;
  intersectingIndices: number[];
  productId: EcostressProductId;
  layer: EcostressLayerId;
  cloudGrid?: ParsedGeoTiffGrid;
  waterGrid?: ParsedGeoTiffGrid;
}): EcostressPolygonStats {
  const { grid, intersectingIndices, productId, layer, cloudGrid, waterGrid } = params;
  const unit = getEcostressLayerUnit(productId, layer);
  const intersectingCount = intersectingIndices.length;

  if (intersectingCount === 0) {
    return {
      mean: null,
      min: null,
      max: null,
      stdDev: null,
      pixelCount: 0,
      validPixelCount: 0,
      intersectingPixelCount: 0,
      coveragePercent: 0,
      cloudMaskedPixelCount: 0,
      waterMaskedPixelCount: 0,
      invalidPixelCount: 0,
      unit,
    };
  }

  const sameCloudDims =
    cloudGrid && cloudGrid.width === grid.width && cloudGrid.height === grid.height;
  const sameWaterDims =
    waterGrid && waterGrid.width === grid.width && waterGrid.height === grid.height;

  const validSamples: number[] = [];
  let cloudMaskedPixelCount = 0;
  let waterMaskedPixelCount = 0;
  let invalidPixelCount = 0;

  for (const idx of intersectingIndices) {
    const cloudVal = sameCloudDims ? cloudGrid.values[idx] : undefined;
    if (cloudVal !== undefined) {
      if (!Number.isFinite(cloudVal) || cloudVal === 255) {
        invalidPixelCount += 1;
        continue;
      }
      if (cloudVal === 1) {
        cloudMaskedPixelCount += 1;
        continue;
      }
    }

    const waterVal = sameWaterDims ? waterGrid.values[idx] : undefined;
    if (waterVal !== undefined) {
      if (!Number.isFinite(waterVal) || waterVal === 255) {
        invalidPixelCount += 1;
        continue;
      }
      if (waterVal === 1) {
        waterMaskedPixelCount += 1;
        continue;
      }
    }

    const raw = grid.values[idx];
    if (
      !Number.isFinite(raw) ||
      (grid.nodata !== null && !Number.isNaN(grid.nodata) && raw === grid.nodata) ||
      !isValidPhysicalLayerValue(layer, raw)
    ) {
      invalidPixelCount += 1;
      continue;
    }

    validSamples.push(raw);
  }

  const validCount = validSamples.length;
  const coveragePercent = Number(((validCount / intersectingCount) * 100).toFixed(2));

  if (validCount === 0) {
    return {
      mean: null,
      min: null,
      max: null,
      stdDev: null,
      pixelCount: 0,
      validPixelCount: 0,
      intersectingPixelCount: intersectingCount,
      coveragePercent: 0,
      cloudMaskedPixelCount,
      waterMaskedPixelCount,
      invalidPixelCount,
      unit,
    };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of validSamples) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / validCount;

  let sqDiffSum = 0;
  for (const v of validSamples) {
    const d = v - mean;
    sqDiffSum += d * d;
  }
  const stdDev = Math.sqrt(sqDiffSum / validCount);

  return {
    mean: Number(mean.toFixed(4)),
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    stdDev: Number(stdDev.toFixed(4)),
    pixelCount: validCount,
    validPixelCount: validCount,
    intersectingPixelCount: intersectingCount,
    coveragePercent,
    cloudMaskedPixelCount,
    waterMaskedPixelCount,
    invalidPixelCount,
    unit,
  };
}
