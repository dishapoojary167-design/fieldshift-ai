import type {
  BoundingBox,
  DateRange,
  EcostressJobRecord,
  EcostressJobSubmissionRequest,
  EcostressProviderCapabilitiesPayload,
  EcostressResultPayload,
  GeoCoordinates,
  GeoJsonPolygon,
  SoilBoundaryContext,
} from '../../../shared/index.ts';

export interface IEvapotranspirationRepository {
  getCapabilities(): EcostressProviderCapabilitiesPayload;
  submitJob(request: EcostressJobSubmissionRequest): Promise<EcostressJobRecord>;
  getJobStatus(jobId: string, options?: { refresh?: boolean }): Promise<EcostressJobRecord>;
  getJobResults(jobId: string): Promise<EcostressResultPayload>;
  getLatestCompletedResult?(params: {
    location?: GeoCoordinates;
    boundary?: SoilBoundaryContext;
    geometry?: GeoJsonPolygon;
    bbox?: BoundingBox;
    dateRange?: DateRange;
  }): Promise<EcostressResultPayload | null>;
}
