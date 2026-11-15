import type { BoundingBox, GeoJsonPolygon } from './common.ts';
import type {
  DateRange,
  GeoCoordinates,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
  SpatialProcessingMode,
} from './domain.ts';

export type HlsProductId = 'HLSL30.002' | 'HLSS30.002';

export type HlsLayerId =
  | 'B03'
  | 'B04'
  | 'B05'
  | 'B8A'
  | 'B08'
  | 'B11'
  | 'B12'
  | 'Fmask';

export interface HlsLayerSpecification {
  layer: HlsLayerId;
  description: string;
  units: string;
  dataType: 'int16' | 'float32' | 'uint16';
  scaleFactor: number;
  fillValue: 'NaN' | number;
  validMin?: number;
  validMax?: number;
  isMask: boolean;
}

export interface HlsProductSpecification {
  productId: HlsProductId;
  shortName: string;
  version: '002';
  title: string;
  sensor: string;
  daac: 'LP DAAC';
  spatialResolutionMeters: 30;
  tilingGrid: string;
  fileFormat: 'COG';
  temporalExtentStart: string;
  temporalExtentEnd: string;
  latitudeBounds: { min: number; max: number };
  appeearsSupported: boolean;
  supportedTaskTypes: Array<'point' | 'area'>;
  layers: HlsLayerSpecification[];
  qualityGuidance: string[];
}

export type HlsJobStatus =
  | 'submitted'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export type HlsTaskType = 'area' | 'point';

export type HlsOutputFormat = 'geotiff' | 'netcdf4' | 'csv';

export interface HlsJobSubmissionRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange: DateRange;
  products?: HlsProductId[];
  layers?: HlsLayerId[];
  taskName?: string;
  outputFormat?: 'geotiff' | 'netcdf4';
}

export interface HlsBundleFileDescriptor {
  fileId: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
  sha256?: string;
}

export interface HlsJobRecord {
  jobId: string;
  upstreamTaskId: string;
  providerId: string;
  status: HlsJobStatus;
  upstreamStatus: string;
  taskType: HlsTaskType;
  products: HlsProductId[];
  layers: Array<{ product: HlsProductId; layer: HlsLayerId }>;
  dateRange: DateRange;
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing: SpatialProcessingMetadata;
  outputFormat: HlsOutputFormat;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  progressPercent?: number;
  errorMessage?: string;
  bundleFiles?: HlsBundleFileDescriptor[];
  resultAvailable: boolean;
}

export interface HlsPolygonStats {
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  pixelCount: number | null;
  validPixelCount: number | null;
  intersectingPixelCount: number | null;
  coveragePercent: number | null;
  cloudMaskedPixelCount?: number;
  shadowMaskedPixelCount?: number;
  waterMaskedPixelCount?: number;
  invalidPixelCount?: number;
  unit: string;
}

export type HlsObservationQualityStatus =
  | 'valid'
  | 'cloud_masked'
  | 'shadow_masked'
  | 'water_masked'
  | 'invalid_data'
  | 'missing_data'
  | 'stale';

export interface HlsSurfaceReflectanceObservation {
  observationTimestamp: string;
  retrievalTimestamp: string;
  productId: HlsProductId;
  productVersion: '002';
  spatialResolutionMeters: 30;
  spatialAggregation: 'polygon_raster_pixels' | 'polygon_area_stats' | 'point';
  intersectingPixelCount: number | null;
  validPixelCount: number | null;
  coveragePercent: number | null;
  greenReflectance: number | null;
  redReflectance: number | null;
  nirReflectance: number | null;
  swir1Reflectance: number | null;
  ndvi: number | null;
  ndwi: number | null;
  cloudMaskFlag: 0 | 1 | null;
  shadowMaskFlag: 0 | 1 | null;
  waterMaskFlag: 0 | 1 | null;
  qualityFiltered: boolean;
  qualityStatus: HlsObservationQualityStatus;
  isStale: boolean;
  qualityNotes?: string[];
  parameterUnits: Partial<Record<HlsLayerId | 'NDVI' | 'NDWI', string>>;
  provenance: {
    providerId: string;
    daac: 'LP DAAC';
    productId: HlsProductId;
    productVersion: '002';
    accessMethod: string;
  };
  layerStats?: Partial<Record<HlsLayerId | 'NDVI' | 'NDWI', HlsPolygonStats>>;
}

export interface HlsResultSummary {
  totalObservations: number;
  clearSkyObservations: number;
  cloudMaskedObservations: number;
  shadowMaskedObservations: number;
  waterMaskedObservations: number;
  invalidOrMissingObservations: number;
  staleObservations: number;
  meanCoveragePercent: number | null;
  meanRedReflectance: number | null;
  meanNirReflectance: number | null;
  meanNdvi: number | null;
  minNdvi: number | null;
  maxNdvi: number | null;
  meanNdwi: number | null;
  latestNdvi: number | null;
  latestNdwi: number | null;
}

export interface HlsResultPayload {
  jobId: string;
  upstreamTaskId: string;
  status: 'completed';
  dataClassification: 'satellite_derived_surface_reflectance';
  taskType: HlsTaskType;
  products: HlsProductId[];
  dateRange: DateRange;
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing: SpatialProcessingMetadata;
  spatialResolution: {
    value: number;
    unit: 'm';
    label: string;
  };
  units: {
    reflectance: 'Reflectance Ratio (0–1)';
    indices: 'Index Ratio (-1 to 1)';
    scaleFactor: '0.0001';
    fmask: 'Bitmask (0 = Clear, 1 = Cloud, etc.)';
  };
  summary: HlsResultSummary;
  observations: HlsSurfaceReflectanceObservation[];
  bundleFiles: HlsBundleFileDescriptor[];
  sourceAttribution: {
    providerId: string;
    providerName: string;
    accessMethod: string;
    daac: string;
    productVersions: string[];
    datasetNames: string[];
    url: string;
    retrievedAt: string;
    cached: boolean;
  };
  caveats: string[];
  retrievedAt: string;
}

export interface HlsProviderCapabilitiesPayload {
  providerId: string;
  accessMethod: 'NASA AppEEARS API';
  appeearsBaseUrl: string;
  authentication: {
    configured: boolean;
    authMode: 'appeears_token' | 'earthdata_credentials' | 'earthdata_token_fallback' | 'unconfigured';
    hasEarthdataToken: boolean;
    hasAppeearsToken: boolean;
    hasEarthdataCredentials: boolean;
    notes: string[];
  };
  products: HlsProductSpecification[];
}
