import type {
  BoundingBox,
  DateRange,
  GeoCoordinates,
  GeoJsonPolygon,
  HlsJobRecord,
  HlsJobSubmissionRequest,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
  SoilBoundaryContext,
} from '../../../shared/index.ts';

export interface IVegetationRepository {
  getCapabilities(): HlsProviderCapabilitiesPayload;
  submitJob(request: HlsJobSubmissionRequest): Promise<HlsJobRecord>;
  getJobStatus(jobId: string, options?: { refresh?: boolean }): Promise<HlsJobRecord>;
  getJobResults(jobId: string): Promise<HlsResultPayload>;
  getLatestCompletedResult?(params: {
    location?: GeoCoordinates;
    boundary?: SoilBoundaryContext;
    geometry?: GeoJsonPolygon;
    bbox?: BoundingBox;
    dateRange?: DateRange;
  }): Promise<HlsResultPayload | null>;
}
