import zlib from 'node:zlib';

export interface TiffRasterSample {
  width: number;
  height: number;
  value: number | null;
  nodata: number | null;
}

export interface PngRgbaPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TilePixelCoords {
  z: number;
  x: number;
  y: number;
  px: number;
  py: number;
}

/**
 * Converts WGS84 latitude/longitude into Slippy/WebMercator (EPSG:3857) tile indices
 * and 256x256 pixel offsets for WMTS raster lookup.
 */
export function latLonToWebMercatorTilePixel(
  latitude: number,
  longitude: number,
  zoom: number,
): TilePixelCoords {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, latitude));
  const clampedLon = Math.max(-180, Math.min(180, longitude));
  const n = Math.pow(2, zoom);
  const xTileFloat = ((clampedLon + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const yTileFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const maxTile = n - 1;
  const x = Math.min(maxTile, Math.max(0, Math.floor(xTileFloat)));
  const y = Math.min(maxTile, Math.max(0, Math.floor(yTileFloat)));
  const px = Math.min(255, Math.max(0, Math.floor((xTileFloat - x) * 256)));
  const py = Math.min(255, Math.max(0, Math.floor((yTileFloat - y) * 256)));

  return { z: zoom, x, y, px, py };
}

/**
 * Minimal pure-Node GeoTIFF scalar reader supporting 16-bit signed/unsigned TIFF rasters
 * returned by ISRIC SoilGrids WCS (stripped or tiled, Deflate or uncompressed, optional predictor=2).
 */
export function parseSingleBandInt16Tiff(buf: Buffer): TiffRasterSample {
  if (buf.length < 16) {
    throw new Error('GeoTIFF buffer too short.');
  }

  const endianMarker = buf.toString('ascii', 0, 2);
  if (endianMarker !== 'II' && endianMarker !== 'MM') {
    throw new Error(`Invalid TIFF endian header: "${endianMarker}".`);
  }
  const le = endianMarker === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const i16 = (o: number) => (le ? buf.readInt16LE(o) : buf.readInt16BE(o));

  const ifdOffset = u32(4);
  if (ifdOffset + 2 > buf.length) {
    throw new Error('GeoTIFF IFD offset out of range.');
  }

  const entryCount = u16(ifdOffset);
  const tags = new Map<number, { type: number; count: number; valueOrOffset: number; inlineU16: number }>();

  for (let i = 0; i < entryCount; i++) {
    const off = ifdOffset + 2 + i * 12;
    if (off + 12 > buf.length) {
      break;
    }
    const tag = u16(off);
    const type = u16(off + 2);
    const count = u32(off + 4);
    const inlineU16 = u16(off + 8);
    const valueOrOffset = u32(off + 8);
    tags.set(tag, { type, count, valueOrOffset, inlineU16 });
  }

  const readScalarTag = (tagId: number, fallback: number): number => {
    const t = tags.get(tagId);
    if (!t) {
      return fallback;
    }
    if (t.count === 1 && t.type === 3) {
      return t.inlineU16;
    }
    if (t.count === 1 && t.type === 4) {
      return t.valueOrOffset;
    }
    return t.valueOrOffset;
  };

  const width = readScalarTag(256, 1);
  const height = readScalarTag(257, 1);
  const bitsPerSample = readScalarTag(258, 16);
  const compression = readScalarTag(259, 1);
  const predictor = readScalarTag(317, 1);
  const sampleFormat = readScalarTag(339, 1);

  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported GeoTIFF BitsPerSample=${bitsPerSample}. Expected 16-bit.`);
  }

  const readOffsetArray = (tagId: number): number[] => {
    const t = tags.get(tagId);
    if (!t) {
      return [];
    }
    if (t.count === 1) {
      return [t.type === 3 ? t.inlineU16 : t.valueOrOffset];
    }
    const elemSize = t.type === 3 ? 2 : 4;
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      const pos = t.valueOrOffset + i * elemSize;
      if (pos + elemSize <= buf.length) {
        out.push(t.type === 3 ? u16(pos) : u32(pos));
      }
    }
    return out;
  };

  let nodata: number | null = null;
  const nodataTag = tags.get(42113);
  if (nodataTag && nodataTag.count > 0 && nodataTag.valueOrOffset + nodataTag.count <= buf.length) {
    const rawStr = buf
      .toString('ascii', nodataTag.valueOrOffset, nodataTag.valueOrOffset + nodataTag.count)
      .replace(/\0+$/, '');
    const parsedNodata = Number.parseFloat(rawStr);
    if (Number.isFinite(parsedNodata)) {
      nodata = parsedNodata;
    }
  }

  const offsets = tags.has(324) ? readOffsetArray(324) : readOffsetArray(273);
  const byteCounts = tags.has(325) ? readOffsetArray(325) : readOffsetArray(279);
  if (offsets.length === 0 || byteCounts.length === 0) {
    throw new Error('GeoTIFF missing image strip/tile offsets.');
  }

  const firstOffset = offsets[0];
  const firstCount = byteCounts[0];
  if (firstOffset + firstCount > buf.length) {
    throw new Error('GeoTIFF data segment truncated.');
  }

  let raw = buf.subarray(firstOffset, firstOffset + firstCount);
  if (compression === 8 || compression === 32946) {
    raw = zlib.inflateSync(raw);
  } else if (compression !== 1) {
    throw new Error(`Unsupported GeoTIFF compression code: ${compression}.`);
  }

  const readRawSample = (pos: number): number => {
    if (sampleFormat === 2) {
      return le ? raw.readInt16LE(pos) : raw.readInt16BE(pos);
    }
    return le ? raw.readUInt16LE(pos) : raw.readUInt16BE(pos);
  };

  if (raw.length < 2) {
    return { width, height, value: null, nodata };
  }

  const tileWidth = tags.has(322) ? readScalarTag(322, width) : width;
  const targetCol = Math.min(Math.max(0, Math.floor(width / 2)), tileWidth - 1);
  const targetRow = Math.min(Math.max(0, Math.floor(height / 2)), height - 1);

  const rowStartByte = targetRow * tileWidth * 2;
  let value: number;

  if (predictor === 2 && rowStartByte + (targetCol + 1) * 2 <= raw.length) {
    let acc = 0;
    for (let col = 0; col <= targetCol; col++) {
      const sample = readRawSample(rowStartByte + col * 2);
      acc = sampleFormat === 2 ? ((acc + sample) << 16) >> 16 : (acc + sample) & 0xffff;
    }
    value = acc;
  } else {
    const bytePos =
      rowStartByte + targetCol * 2 + 2 <= raw.length ? rowStartByte + targetCol * 2 : 0;
    value = readRawSample(bytePos);
  }

  if (nodata !== null && value === nodata) {
    return { width, height, value: null, nodata };
  }

  return { width, height, value, nodata };
}

/**
 * Pure-Node PNG pixel reader supporting Indexed (colorType 3 + PLTE/tRNS), RGB (2),
 * and RGBA (6) 8-bit images with all 5 standard PNG scanline filters.
 */
export function extractPngPixelRgba(buf: Buffer, px: number, py: number): PngRgbaPixel {
  const PNG_SIG = '89504e470d0a1a0a';
  if (buf.length < 33 || buf.subarray(0, 8).toString('hex') !== PNG_SIG) {
    throw new Error('Invalid PNG signature.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) {
      break;
    }
    const data = buf.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || width === 0 || height === 0 || idatChunks.length === 0) {
    throw new Error(`Unsupported PNG geometry/depth: ${width}x${height} bitDepth=${bitDepth}.`);
  }

  const targetX = Math.min(width - 1, Math.max(0, px));
  const targetY = Math.min(height - 1, Math.max(0, py));

  const bpp =
    colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 4 ? 2 : 1;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));

  const prevRow = Buffer.alloc(stride);
  const currRow = Buffer.alloc(stride);

  for (let row = 0; row <= targetY; row++) {
    const rowStart = row * (stride + 1);
    if (rowStart + 1 + stride > raw.length) {
      throw new Error('PNG scanline buffer truncated.');
    }
    const filter = raw[rowStart];

    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + 1 + i];
      const a = i >= bpp ? currRow[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;

      let val = x;
      if (filter === 1) {
        val = (x + a) & 0xff;
      } else if (filter === 2) {
        val = (x + b) & 0xff;
      } else if (filter === 3) {
        val = (x + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (x + pr) & 0xff;
      }
      currRow[i] = val;
    }
    currRow.copy(prevRow);
  }

  const idx = targetX * bpp;
  if (colorType === 3 && palette) {
    const palIdx = currRow[idx];
    const palOffset = palIdx * 3;
    if (palOffset + 2 >= palette.length) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const a = trns && palIdx < trns.length ? trns[palIdx] : 255;
    return {
      r: palette[palOffset],
      g: palette[palOffset + 1],
      b: palette[palOffset + 2],
      a,
    };
  }

  if (colorType === 6) {
    return {
      r: currRow[idx],
      g: currRow[idx + 1],
      b: currRow[idx + 2],
      a: currRow[idx + 3],
    };
  }

  if (colorType === 2) {
    return {
      r: currRow[idx],
      g: currRow[idx + 1],
      b: currRow[idx + 2],
      a: 255,
    };
  }

  if (colorType === 4) {
    return {
      r: currRow[idx],
      g: currRow[idx],
      b: currRow[idx],
      a: currRow[idx + 1],
    };
  }

  return {
    r: currRow[idx],
    g: currRow[idx],
    b: currRow[idx],
    a: 255,
  };
}
