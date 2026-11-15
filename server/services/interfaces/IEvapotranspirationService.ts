import type {
  EcostressJobRecord,
  EcostressJobSubmissionRequest,
  EcostressProviderCapabilitiesPayload,
  EcostressResultPayload,
} from '../../../shared/index.ts';

export interface IEvapotranspirationService {
  getCapabilities(): EcostressProviderCapabilitiesPayload;
  submitJob(request: EcostressJobSubmissionRequest): Promise<EcostressJobRecord>;
  getJobStatus(jobId: string, options?: { refresh?: boolean }): Promise<EcostressJobRecord>;
  getJobResults(jobId: string): Promise<EcostressResultPayload>;
}
