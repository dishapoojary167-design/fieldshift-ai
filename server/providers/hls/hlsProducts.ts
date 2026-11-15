import type {
  BoundingBox,
  HlsLayerId,
  HlsProductId,
  HlsProductSpecification,
  GeoJsonPolygon,
} from '../../../shared/index.ts';

export const HLS_TEMPORAL_START_DATE = '2013-04-11';
export const HLS_LATITUDE_BOUNDS = { min: -82, max: 82 } as const;

export const HLS_PRODUCT_SPECS: Record<HlsProductId, HlsProductSpecification> = {
  'HLSL30.002': {
    productId: 'HLSL30.002',
    shortName: 'HLSL30',
    version: '002',
    title: 'Harmonized Landsat Sentinel-2 Landsat 8/9 OLI Surface Reflectance L3 Global 30 m',
    sensor: 'Landsat 8/9 OLI',
    daac: 'LP DAAC',
    spatialResolutionMeters: 30,
    tilingGrid: 'Modified MGRS UTM (109.8 km × 109.8 km tiles)',
    fileFormat: 'COG',
    temporalExtentStart: '2013-04-11',
    temporalExtentEnd: 'Present',
    latitudeBounds: { ...HLS_LATITUDE_BOUNDS },
    appeearsSupported: true,
    supportedTaskTypes: ['point', 'area'],
    layers: [
      {
        layer: 'B03',
        description: 'Surface Reflectance Band 3 (Green, 0.53 - 0.59 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B04',
        description: 'Surface Reflectance Band 4 (Red, 0.64 - 0.67 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B05',
        description: 'Surface Reflectance Band 5 (NIR, 0.85 - 0.88 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B11',
        description: 'Surface Reflectance Band 11 (SWIR1, 1.57 - 1.65 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'Fmask',
        description: 'Fmask Quality Assessment Bitmask (Cloud, Shadow, Water, Snow)',
        units: 'Bitmask',
        dataType: 'uint16',
        scaleFactor: 1,
        fillValue: 255,
        isMask: true,
      },
    ],
    qualityGuidance: [
      'Apply scale factor 0.0001 to surface reflectance bands.',
      'Filter pixels using Fmask bit flags for cloud, cloud shadow, and water before NDVI/NDWI computation.',
    ],
  },
  'HLSS30.002': {
    productId: 'HLSS30.002',
    shortName: 'HLSS30',
    version: '002',
    title: 'Harmonized Landsat Sentinel-2 Sentinel-2A/2B MSI Surface Reflectance L3 Global 30 m',
    sensor: 'Sentinel-2A/2B MSI',
    daac: 'LP DAAC',
    spatialResolutionMeters: 30,
    tilingGrid: 'Modified MGRS UTM (109.8 km × 109.8 km tiles)',
    fileFormat: 'COG',
    temporalExtentStart: '2015-06-23',
    temporalExtentEnd: 'Present',
    latitudeBounds: { ...HLS_LATITUDE_BOUNDS },
    appeearsSupported: true,
    supportedTaskTypes: ['point', 'area'],
    layers: [
      {
        layer: 'B03',
        description: 'Surface Reflectance Band 3 (Green, 0.56 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B04',
        description: 'Surface Reflectance Band 4 (Red, 0.66 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B8A',
        description: 'Surface Reflectance Band 8A (Narrow NIR, 0.86 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'B11',
        description: 'Surface Reflectance Band 11 (SWIR1, 1.61 µm)',
        units: 'Reflectance Ratio (0-1)',
        dataType: 'int16',
        scaleFactor: 0.0001,
        fillValue: -9999,
        validMin: 0,
        validMax: 10000,
        isMask: false,
      },
      {
        layer: 'Fmask',
        description: 'Fmask Quality Assessment Bitmask',
        units: 'Bitmask',
        dataType: 'uint16',
        scaleFactor: 1,
        fillValue: 255,
        isMask: true,
      },
    ],
    qualityGuidance: [
      'Apply scale factor 0.0001 to Sentinel-2 surface reflectance bands.',
      'Use B8A (narrow NIR) and B03 (Green) or B11 (SWIR1) for NDVI and NDWI calculations.',
    ],
  },
};

export const DEFAULT_HLS_PRODUCTS: HlsProductId[] = ['HLSL30.002', 'HLSS30.002'];

const DEFAULT_LAYERS_BY_PRODUCT: Record<HlsProductId, HlsLayerId[]> = {
  'HLSL30.002': ['B03', 'B04', 'B05', 'B11', 'Fmask'],
  'HLSS30.002': ['B03', 'B04', 'B8A', 'B11', 'Fmask'],
};

export function resolveHlsLayerPairs(
  products: HlsProductId[],
  requestedLayers?: HlsLayerId[],
): Array<{ product: HlsProductId; layer: HlsLayerId }> {
  const pairs: Array<{ product: HlsProductId; layer: HlsLayerId }> = [];

  for (const product of products) {
    const spec = HLS_PRODUCT_SPECS[product];
    const supportedSet = new Set(spec.layers.map((l) => l.layer));
    const chosen =
      requestedLayers && requestedLayers.length > 0
        ? requestedLayers.filter((l) => supportedSet.has(l))
        : DEFAULT_LAYERS_BY_PRODUCT[product];

    const withMasks = new Set<HlsLayerId>(chosen);
    if (withMasks.size > 0) {
      withMasks.add('Fmask');
    }

    for (const layer of withMasks) {
      if (supportedSet.has(layer)) {
        pairs.push({ product, layer });
      }
    }
  }

  return pairs;
}

export function bboxToGeoJsonPolygon(bbox: BoundingBox): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bbox.west, bbox.south],
        [bbox.east, bbox.south],
        [bbox.east, bbox.north],
        [bbox.west, bbox.north],
        [bbox.west, bbox.south],
      ],
    ],
  };
}
