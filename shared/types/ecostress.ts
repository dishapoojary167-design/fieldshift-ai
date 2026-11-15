import type { BoundingBox, GeoJsonPolygon } from './common.ts';
import type {
  DateRange,
  GeoCoordinates,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
  SpatialProcessingMode,
} from './domain.ts';

export type EcostressProductId = 'ECO_L3T_JET.002' | 'ECO_L4T_ESI.002';

export type EcostressJetLayerId =
  | 'ETdaily'
  | 'ETinstUncertainty'
  | 'PTJPLSMinst'
  | 'STICinst'
  | 'MOD16inst'
  | 'BESSinst'
  | 'PTJPLSMcanopy'
  | 'PTJPLSMsoil'
  | 'PTJPLSMinterception'
  | 'STICcanopy'
  | 'cloud'
  | 'water';

export type EcostressEsiLayerId = 'ESI' | 'PET' | 'cloud' | 'water';

export type EcostressLayerId = EcostressJetLayerId | EcostressEsiLayerId;

export interface EcostressLayerSpecification {
  layer: EcostressLayerId;
  description: string;
  units: string;
  dataType: 'float32' | 'uint8';
  fillValue: 'NaN' | number;
  validMin?: number;
  validMax?: number;
  isMask: boolean;
}

export interface EcostressProductSpecification {
  productId: EcostressProductId;
  shortName: string;
  version: '002';
  title: string;
  daac: 'LP DAAC';
  spatialResolutionMeters: 70;
  tilingGrid: string;
  fileFormat: 'COG';
  temporalExtentStart: string;
  temporalExtentEnd: string;
  latitudeBounds: { min: number; max: number };
  appeearsSupported: boolean;
  supportedTaskTypes: Array<'point' | 'area'>;
  layers: EcostressLayerSpecification[];
  qualityGuidance: string[];
}

export type EcostressJobStatus =
  | 'submitted'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export type EcostressTaskType = 'area' | 'point';

export type EcostressOutputFormat = 'geotiff' | 'netcdf4' | 'csv';

export interface EcostressJobSubmissionRequest {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange: DateRange;
  products?: EcostressProductId[];
  layers?: EcostressLayerId[];
  taskName?: string;
  outputFormat?: 'geotiff' | 'netcdf4';
}

export interface EcostressBundleFileDescriptor {
  fileId: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
  sha256?: string;
}

export interface EcostressJobRecord {
  jobId: string;
  upstreamTaskId: string;
  providerId: string;
  status: EcostressJobStatus;
  upstreamStatus: string;
  taskType: EcostressTaskType;
  products: EcostressProductId[];
  layers: Array<{ product: EcostressProductId; layer: EcostressLayerId }>;
  dateRange: DateRange;
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  spatialProcessing: SpatialProcessingMetadata;
  outputFormat: EcostressOutputFormat;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  progressPercent?: number;
  errorMessage?: string;
  bundleFiles?: EcostressBundleFileDescriptor[];
  resultAvailable: boolean;
}

export interface EcostressPolygonStats {
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  pixelCount: number | null;
  validPixelCount: number | null;
  intersectingPixelCount: number | null;
  coveragePercent: number | null;
  cloudMaskedPixelCount?: number;
  waterMaskedPixelCount?: number;
  invalidPixelCount?: number;
  unit: string;
}

export type EcostressObservationQualityStatus =
  | 'valid'
  | 'cloud_masked'
  | 'water_masked'
  | 'invalid_data'
  | 'missing_data'
  | 'stale';

export interface EcostressEvapotranspirationObservation {
  observationTimestamp: string;
  retrievalTimestamp: string;
  productId: EcostressProductId;
  productVersion: '002';
  spatialResolutionMeters: 70;
  spatialAggregation: 'polygon_raster_pixels' | 'polygon_area_stats' | 'point';
  intersectingPixelCount: number | null;
  validPixelCount: number | null;
  coveragePercent: number | null;
  etDailyWm2: number | null;
  etInstUncertaintyWm2: number | null;
  ptjplsmInstWm2: number | null;
  sticInstWm2: number | null;
  mod16InstWm2: number | null;
  bessInstWm2: number | null;
  canopyTranspirationRatio: number | null;
  soilEvaporationRatio: number | null;
  interceptionRatio: number | null;
  sticCanopyRatio: number | null;
  esiRatio: number | null;
  petWm2: number | null;
  cloudMaskFlag: 0 | 1 | null;
  waterMaskFlag: 0 | 1 | null;
  qualityFiltered: boolean;
  qualityStatus: EcostressObservationQualityStatus;
  isStale: boolean;
  qualityNotes?: string[];
  parameterUnits: Partial<Record<EcostressLayerId, string>>;
  provenance: {
    providerId: string;
    daac: 'LP DAAC';
    productId: EcostressProductId;
    productVersion: '002';
    accessMethod: string;
  };
  layerStats?: Partial<Record<EcostressLayerId, EcostressPolygonStats>>;
}

export interface EcostressResultSummary {
  totalObservations: number;
  clearSkyObservations: number;
  cloudMaskedObservations: number;
  waterMaskedObservations: number;
  invalidOrMissingObservations: number;
  staleObservations: number;
  meanCoveragePercent: number | null;
  meanEtDailyWm2: number | null;
  latestEtDailyWm2: number | null;
  meanInstantaneousEtWm2: number | null;
  meanEsiRatio: number | null;
  latestEsiRatio: number | null;
  meanPetWm2: number | null;
}

export interface EcostressResultPayload {
  jobId: string;
  upstreamTaskId: string;
  status: 'completed';
  dataClassification: 'satellite_derived_et';
  taskType: EcostressTaskType;
  products: EcostressProductId[];
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
    etDaily: 'W/m²';
    instantaneousEt: 'W/m²';
    etInstUncertainty: 'W/m²';
    pet: 'W/m²';
    esi: 'Ratio (0–1)';
    partitionRatios: 'Ratio (0–1)';
    cloudMask: '0 = Clear, 1 = Cloud';
    waterMask: '0 = Land, 1 = Water';
  };
  summary: EcostressResultSummary;
  observations: EcostressEvapotranspirationObservation[];
  bundleFiles: EcostressBundleFileDescriptor[];
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

export interface EcostressProviderCapabilitiesPayload {
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
  products: EcostressProductSpecification[];
}
