export type EnvironmentalLayerId =
  | 'satellite'
  | 'rainfall'
  | 'temperature'
  | 'soil_moisture'
  | 'vegetation';

export interface LegendStop {
  color: string;
  label: string;
}

export type LayerLegendSpec =
  | {
      type: 'gradient';
      stops: LegendStop[];
    }
  | {
      type: 'categorical';
      swatches: LegendStop[];
    };

export interface GibsLayerDefinition {
  id: EnvironmentalLayerId;
  label: string;
  gibsLayerId: string;
  tileMatrixSet:
    | 'GoogleMapsCompatible_Level6'
    | 'GoogleMapsCompatible_Level7'
    | 'GoogleMapsCompatible_Level9';
  maxNativeZoom: number;
  format: 'jpeg' | 'png';
  defaultDate: string;
  defaultOpacity: number;
  units: string;
  sourceAttribution: string;
  description: string;
  legend: LayerLegendSpec;
}

export interface EnvironmentalLayerState {
  id: EnvironmentalLayerId;
  enabled: boolean;
  opacity: number;
  date: string;
}

export const OSM_BASE_LAYER = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
} as const;

export const GIBS_LAYER_DEFINITIONS: readonly GibsLayerDefinition[] = [
  {
    id: 'satellite',
    label: 'Satellite True Color',
    gibsLayerId: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxNativeZoom: 9,
    format: 'jpeg',
    defaultDate: '2026-11-14',
    defaultOpacity: 0.85,
    units: 'Surface Reflectance (RGB Bands 1-4-3)',
    sourceAttribution: 'NASA GIBS / EOSDIS MODIS Terra',
    description: 'Daily corrected true-color satellite surface reflectance.',
    legend: {
      type: 'categorical',
      swatches: [
        { color: '#2d5a27', label: 'Dense vegetation' },
        { color: '#a8906e', label: 'Bare soil / arid' },
        { color: '#f1f5f9', label: 'Cloud / snow cover' },
      ],
    },
  },
  {
    id: 'rainfall',
    label: 'Precipitation Rate',
    gibsLayerId: 'IMERG_Precipitation_Rate',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    format: 'png',
    defaultDate: '2026-11-12',
    defaultOpacity: 0.72,
    units: 'mm/hr',
    sourceAttribution: 'NASA GIBS / GPM IMERG',
    description: 'Global satellite-estimated liquid precipitation rate.',
    legend: {
      type: 'gradient',
      stops: [
        { color: 'rgb(0, 118, 78)', label: '0.1' },
        { color: 'rgb(16, 173, 0)', label: '0.3' },
        { color: 'rgb(242, 230, 0)', label: '1.3' },
        { color: 'rgb(255, 38, 38)', label: '5.6' },
        { color: 'rgb(138, 0, 0)', label: '23.7' },
        { color: 'rgb(51, 0, 0)', label: '53+' },
      ],
    },
  },
  {
    id: 'temperature',
    label: 'Land Surface Temperature',
    gibsLayerId: 'MODIS_Terra_L3_Land_Surface_Temp_Daily_Day',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxNativeZoom: 7,
    format: 'png',
    defaultDate: '2026-11-12',
    defaultOpacity: 0.72,
    units: 'K (°C)',
    sourceAttribution: 'NASA GIBS / MODIS Terra MOD11A1',
    description: 'Daytime 1 km land surface skin temperature.',
    legend: {
      type: 'gradient',
      stops: [
        { color: 'rgb(201, 0, 255)', label: '200 K (-73°C)' },
        { color: 'rgb(1, 0, 255)', label: '230 K (-43°C)' },
        { color: 'rgb(4, 255, 247)', label: '260 K (-13°C)' },
        { color: 'rgb(189, 255, 0)', label: '290 K (17°C)' },
        { color: 'rgb(255, 157, 0)', label: '320 K (47°C)' },
        { color: 'rgb(255, 1, 0)', label: '350+ K (77°C)' },
      ],
    },
  },
  {
    id: 'soil_moisture',
    label: 'Surface Soil Moisture',
    gibsLayerId: 'SMAP_L4_Analyzed_Surface_Soil_Moisture',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    format: 'png',
    defaultDate: '2026-11-10',
    defaultOpacity: 0.72,
    units: 'm³/m³',
    sourceAttribution: 'NASA GIBS / SMAP L4',
    description: 'Analyzed volumetric surface soil moisture (0–5 cm).',
    legend: {
      type: 'gradient',
      stops: [
        { color: 'rgb(255, 162, 0)', label: '0.00' },
        { color: 'rgb(208, 231, 0)', label: '0.14' },
        { color: 'rgb(0, 177, 100)', label: '0.28' },
        { color: 'rgb(0, 113, 255)', label: '0.42' },
        { color: 'rgb(0, 0, 140)', label: '0.56' },
        { color: 'rgb(80, 80, 80)', label: '0.70+' },
      ],
    },
  },
  {
    id: 'vegetation',
    label: 'Vegetation Index (NDVI)',
    gibsLayerId: 'MODIS_Terra_NDVI_8Day',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxNativeZoom: 9,
    format: 'png',
    defaultDate: '2026-11-13',
    defaultOpacity: 0.75,
    units: 'NDVI (unitless)',
    sourceAttribution: 'NASA GIBS / MODIS Terra 8-Day',
    description: '8-day Normalized Difference Vegetation Index composite.',
    legend: {
      type: 'gradient',
      stops: [
        { color: 'rgb(241, 236, 236)', label: '0.00' },
        { color: 'rgb(205, 186, 159)', label: '0.14' },
        { color: 'rgb(157, 124, 95)', label: '0.28' },
        { color: 'rgb(100, 166, 1)', label: '0.48' },
        { color: 'rgb(29, 117, 1)', label: '0.72' },
        { color: 'rgb(0, 24, 1)', label: '1.00' },
      ],
    },
  },
];

export function createInitialLayerStates(): EnvironmentalLayerState[] {
  return GIBS_LAYER_DEFINITIONS.map((layer) => ({
    id: layer.id,
    enabled: false,
    opacity: layer.defaultOpacity,
    date: layer.defaultDate,
  }));
}

export function buildGibsWmtsTileUrl(layer: GibsLayerDefinition, date: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : layer.defaultDate;
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.gibsLayerId}/default/${safeDate}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.format}`;
}

export type ParcelTelemetryLayerId = 'ecostress_et' | 'hls_ndvi_ndwi';

export interface ParcelTelemetryLayerDefinition {
  id: ParcelTelemetryLayerId;
  label: string;
  datasetName: string;
  resolutionLabel: string;
  units: string;
  sourceAttribution: string;
  spatialRasterAvailable: false;
  unavailableReason: string;
  description: string;
  legend: LayerLegendSpec;
}

export const PARCEL_TELEMETRY_LAYER_DEFINITIONS: readonly ParcelTelemetryLayerDefinition[] = [
  {
    id: 'ecostress_et',
    label: 'ECOSTRESS Evapotranspiration & ESI',
    datasetName: 'ECO_L3T_JET.002 / ECO_L4T_ESI.002',
    resolutionLabel: '70 m × 70 m',
    units: 'W/m² (ET) · Ratio 0–1 (ESI)',
    sourceAttribution: 'NASA LP DAAC AppEEARS',
    spatialRasterAvailable: false,
    unavailableReason:
      'Spatial WMTS map tile raster unavailable; 70 m polygon/point statistics are retrieved via NASA AppEEARS.',
    description: 'High-resolution thermal evapotranspiration flux and evaporative stress ratio.',
    legend: {
      type: 'gradient',
      stops: [
        { color: '#dc2626', label: '0.00 ESI (Stress)' },
        { color: '#f59e0b', label: '0.40 ESI' },
        { color: '#84cc16', label: '0.70 ESI' },
        { color: '#059669', label: '1.00 ESI (Unstressed)' },
      ],
    },
  },
  {
    id: 'hls_ndvi_ndwi',
    label: 'Landsat / Sentinel-2 HLS (NDVI & NDWI)',
    datasetName: 'HLSL30.002 / HLSS30.002',
    resolutionLabel: '30 m × 30 m',
    units: 'Index Ratio (-1 to 1)',
    sourceAttribution: 'NASA LP DAAC AppEEARS',
    spatialRasterAvailable: false,
    unavailableReason:
      'Spatial WMTS map tile raster unavailable; 30 m Fmask-filtered NDVI/NDWI time-series are retrieved via NASA AppEEARS (use MODIS NDVI above for 250 m map tiles).',
    description: 'Harmonized Landsat 8/9 & Sentinel-2 canopy greenness and water indices.',
    legend: {
      type: 'gradient',
      stops: [
        { color: '#a8a29e', label: '0.00 (Bare)' },
        { color: '#eab308', label: '0.25' },
        { color: '#22c55e', label: '0.55' },
        { color: '#065f46', label: '0.85+ (Dense)' },
      ],
    },
  },
];
