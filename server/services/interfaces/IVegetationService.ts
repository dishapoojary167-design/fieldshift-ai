import type {
  HlsJobRecord,
  HlsJobSubmissionRequest,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
} from '../../../shared/index.ts';

export interface IVegetationService {
  getCapabilities(): HlsProviderCapabilitiesPayload;
  submitJob(request: HlsJobSubmissionRequest): Promise<HlsJobRecord>;
  getJobStatus(jobId: string, options?: { refresh?: boolean }): Promise<HlsJobRecord>;
  getJobResults(jobId: string): Promise<HlsResultPayload>;
}
