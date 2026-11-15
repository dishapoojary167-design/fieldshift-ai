import type {
  BoundingBox,
  DateRange,
  GeoCoordinates,
  GeoJsonPolygon,
  HlsBundleFileDescriptor,
  HlsJobRecord,
  HlsJobStatus,
  HlsLayerId,
  HlsProductId,
  HlsProductSpecification,
  HlsResultPayload,
  HlsTaskType,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
} from '../../../shared/index.ts';

export interface HlsProviderSubmitInput {
  taskName: string;
  taskType: HlsTaskType;
  location: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessing: SpatialProcessingMetadata;
  dateRange: DateRange;
  products: HlsProductId[];
  layers: Array<{ product: HlsProductId; layer: HlsLayerId }>;
  outputFormat: 'geotiff' | 'netcdf4' | 'csv';
}

export interface HlsJobSubmissionReceipt {
  upstreamTaskId: string;
  upstreamStatus: string;
  status: HlsJobStatus;
  submittedAt: string;
  expiresAt?: string;
}

export interface HlsUpstreamTaskStatus {
  upstreamTaskId: string;
  upstreamStatus: string;
  status: HlsJobStatus;
  updatedAt: string;
  expiresAt?: string;
  progressPercent?: number;
  errorMessage?: string;
  bundleFiles?: HlsBundleFileDescriptor[];
}

export interface HlsProviderAuthStatus {
  configured: boolean;
  authMode: 'appeears_token' | 'earthdata_credentials' | 'earthdata_token_fallback' | 'unconfigured';
  hasEarthdataToken: boolean;
  hasAppeearsToken: boolean;
  hasEarthdataCredentials: boolean;
  notes: string[];
}

export interface ILandsatHlsProvider {
  readonly providerId: string;
  readonly appeearsBaseUrl: string;
  getVerifiedProducts(): HlsProductSpecification[];
  getAuthStatus(): HlsProviderAuthStatus;
  submitJob(input: HlsProviderSubmitInput): Promise<HlsJobSubmissionReceipt>;
  pollJobStatus(upstreamTaskId: string): Promise<HlsUpstreamTaskStatus>;
  fetchJobResults(job: HlsJobRecord): Promise<HlsResultPayload>;
}
