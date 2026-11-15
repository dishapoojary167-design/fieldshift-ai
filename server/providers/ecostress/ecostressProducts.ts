import type {
  BoundingBox,
  EcostressLayerId,
  EcostressProductId,
  EcostressProductSpecification,
  GeoJsonPolygon,
} from '../../../shared/index.ts';

export const ECOSTRESS_TEMPORAL_START_DATE = '2018-07-10';
export const ECOSTRESS_LATITUDE_BOUNDS = { min: -52, max: 52 } as const;

export const ECOSTRESS_PRODUCT_SPECS: Record<EcostressProductId, EcostressProductSpecification> = {
  'ECO_L3T_JET.002': {
    productId: 'ECO_L3T_JET.002',
    shortName: 'ECO_L3T_JET',
    version: '002',
    title: 'ECOSTRESS Tiled Evapotranspiration Instantaneous and Daytime L3 Global 70 m',
    daac: 'LP DAAC',
    spatialResolutionMeters: 70,
    tilingGrid: 'Modified MGRS UTM (109.8 km × 109.8 km tiles)',
    fileFormat: 'COG',
    temporalExtentStart: ECOSTRESS_TEMPORAL_START_DATE,
    temporalExtentEnd: 'Present',
    latitudeBounds: { ...ECOSTRESS_LATITUDE_BOUNDS },
    appeearsSupported: true,
    supportedTaskTypes: ['point', 'area'],
    layers: [
      {
        layer: 'ETdaily',
        description: 'Daily Evapotranspiration (ET) estimate',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'ETinstUncertainty',
        description: 'Ensemble instantaneous ET inter-model uncertainty',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'PTJPLSMinst',
        description: 'PT-JPL-SM instantaneous total ET estimate',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'STICinst',
        description: 'STIC instantaneous ET estimate',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'MOD16inst',
        description: 'Penman-Monteith (MOD16) instantaneous ET estimate',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'BESSinst',
        description: 'BESS instantaneous ET estimate',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'PTJPLSMcanopy',
        description: 'PT-JPL-SM instantaneous canopy transpiration partition',
        units: 'Ratio',
        dataType: 'float32',
        fillValue: 'NaN',
        validMin: 0,
        validMax: 1,
        isMask: false,
      },
      {
        layer: 'PTJPLSMsoil',
        description: 'PT-JPL-SM soil evaporation partition',
        units: 'Ratio',
        dataType: 'float32',
        fillValue: 'NaN',
        validMin: 0,
        validMax: 1,
        isMask: false,
      },
      {
        layer: 'PTJPLSMinterception',
        description: 'PT-JPL-SM leaf interception evaporation partition',
        units: 'Ratio',
        dataType: 'float32',
        fillValue: 'NaN',
        validMin: 0,
        validMax: 1,
        isMask: false,
      },
      {
        layer: 'STICcanopy',
        description: 'STIC canopy partition ratio',
        units: 'Ratio',
        dataType: 'float32',
        fillValue: 'NaN',
        validMin: 0,
        validMax: 1,
        isMask: false,
      },
      {
        layer: 'cloud',
        description: 'Cloud Mask (1 = Cloud, 0 = Clear)',
        units: '1 = Cloud',
        dataType: 'uint8',
        fillValue: 255,
        validMin: 0,
        validMax: 1,
        isMask: true,
      },
      {
        layer: 'water',
        description: 'Water Mask (1 = Water, 0 = Land)',
        units: '1 = Water',
        dataType: 'uint8',
        fillValue: 255,
        validMin: 0,
        validMax: 1,
        isMask: true,
      },
    ],
    qualityGuidance: [
      'Filter pixels where cloud === 1 or fill value (255 / NaN) before agronomic aggregation.',
      'Exclude water pixels (water === 1) for cropland ET statistics.',
      'JET depends on upstream ECO_L2T_LSTE thermal and ECO_L2T_STARS VIIRS/HLS fusion inputs; occasional ISS solar-array obstructions can degrade scenes.',
      'ETdaily in AppEEARS Collection 2 COG layers is reported as latent heat flux (W/m²), not directly mm/day.',
    ],
  },
  'ECO_L4T_ESI.002': {
    productId: 'ECO_L4T_ESI.002',
    shortName: 'ECO_L4T_ESI',
    version: '002',
    title: 'ECOSTRESS Tiled Evaporative Stress Index PT-JPL Instantaneous L4 Global 70 m',
    daac: 'LP DAAC',
    spatialResolutionMeters: 70,
    tilingGrid: 'Modified MGRS UTM (109.8 km × 109.8 km tiles)',
    fileFormat: 'COG',
    temporalExtentStart: ECOSTRESS_TEMPORAL_START_DATE,
    temporalExtentEnd: 'Present',
    latitudeBounds: { ...ECOSTRESS_LATITUDE_BOUNDS },
    appeearsSupported: true,
    supportedTaskTypes: ['point', 'area'],
    layers: [
      {
        layer: 'ESI',
        description: 'Evaporative Stress Index (ET / PET ratio; 0 = stress, 1 = unstressed)',
        units: 'Ratio',
        dataType: 'float32',
        fillValue: 'NaN',
        validMin: 0,
        validMax: 1,
        isMask: false,
      },
      {
        layer: 'PET',
        description: 'Potential Evapotranspiration (PT-JPL)',
        units: 'W/m²',
        dataType: 'float32',
        fillValue: 'NaN',
        isMask: false,
      },
      {
        layer: 'cloud',
        description: 'Cloud Mask (1 = Cloud, 0 = Clear)',
        units: '1 = Cloud',
        dataType: 'uint8',
        fillValue: 255,
        validMin: 0,
        validMax: 1,
        isMask: true,
      },
      {
        layer: 'water',
        description: 'Water Mask (1 = Water, 0 = Land)',
        units: '1 = Water',
        dataType: 'uint8',
        fillValue: 255,
        validMin: 0,
        validMax: 1,
        isMask: true,
      },
    ],
    qualityGuidance: [
      'Consult cloud and water masks per granule before interpreting plant water stress ratios.',
      'Instantaneous overpass observations reflect ISS acquisition timing rather than fixed daily solar noon.',
    ],
  },
};

export const DEFAULT_ECOSTRESS_PRODUCTS: EcostressProductId[] = [
  'ECO_L3T_JET.002',
  'ECO_L4T_ESI.002',
];

const DEFAULT_LAYERS_BY_PRODUCT: Record<EcostressProductId, EcostressLayerId[]> = {
  'ECO_L3T_JET.002': [
    'ETdaily',
    'ETinstUncertainty',
    'PTJPLSMinst',
    'PTJPLSMcanopy',
    'PTJPLSMsoil',
    'PTJPLSMinterception',
    'cloud',
    'water',
  ],
  'ECO_L4T_ESI.002': ['ESI', 'PET', 'cloud', 'water'],
};

export function resolveEcostressLayerPairs(
  products: EcostressProductId[],
  requestedLayers?: EcostressLayerId[],
): Array<{ product: EcostressProductId; layer: EcostressLayerId }> {
  const pairs: Array<{ product: EcostressProductId; layer: EcostressLayerId }> = [];

  for (const product of products) {
    const spec = ECOSTRESS_PRODUCT_SPECS[product];
    const supportedSet = new Set(spec.layers.map((l) => l.layer));
    const chosen = requestedLayers && requestedLayers.length > 0
      ? requestedLayers.filter((l) => supportedSet.has(l))
      : DEFAULT_LAYERS_BY_PRODUCT[product];

    // Always include cloud & water masks whenever data layers for that product are requested
    const withMasks = new Set<EcostressLayerId>(chosen);
    if (withMasks.size > 0) {
      withMasks.add('cloud');
      withMasks.add('water');
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
