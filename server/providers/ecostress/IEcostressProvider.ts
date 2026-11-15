import type {
  BoundingBox,
  DateRange,
  EcostressBundleFileDescriptor,
  EcostressJobRecord,
  EcostressJobStatus,
  EcostressLayerId,
  EcostressProductId,
  EcostressProductSpecification,
  EcostressResultPayload,
  EcostressTaskType,
  GeoCoordinates,
  GeoJsonPolygon,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
} from '../../../shared/index.ts';

export interface EcostressProviderSubmitInput {
  taskName: string;
  taskType: EcostressTaskType;
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessing: SpatialProcessingMetadata;
  dateRange: DateRange;
  products: EcostressProductId[];
  layers: Array<{ product: EcostressProductId; layer: EcostressLayerId }>;
  outputFormat: 'geotiff' | 'netcdf4' | 'csv';
}

export interface EcostressJobSubmissionReceipt {
  upstreamTaskId: string;
  upstreamStatus: string;
  status: EcostressJobStatus;
  submittedAt: string;
  expiresAt?: string;
}

export interface EcostressUpstreamTaskStatus {
  upstreamTaskId: string;
  upstreamStatus: string;
  status: EcostressJobStatus;
  updatedAt: string;
  expiresAt?: string;
  progressPercent?: number;
  errorMessage?: string;
  bundleFiles?: EcostressBundleFileDescriptor[];
}

export interface EcostressProviderAuthStatus {
  configured: boolean;
  authMode: 'appeears_token' | 'earthdata_credentials' | 'earthdata_token_fallback' | 'unconfigured';
  hasEarthdataToken: boolean;
  hasAppeearsToken: boolean;
  hasEarthdataCredentials: boolean;
  notes: string[];
}

export interface IEcostressProvider {
  readonly providerId: string;
  readonly appeearsBaseUrl: string;
  getVerifiedProducts(): EcostressProductSpecification[];
  getAuthStatus(): EcostressProviderAuthStatus;
  submitJob(input: EcostressProviderSubmitInput): Promise<EcostressJobSubmissionReceipt>;
  pollJobStatus(upstreamTaskId: string): Promise<EcostressUpstreamTaskStatus>;
  fetchJobResults(job: EcostressJobRecord): Promise<EcostressResultPayload>;
}
