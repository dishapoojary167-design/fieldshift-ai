import type {
  EcostressJobRecord,
  EcostressJobSubmissionRequest,
  EcostressProviderCapabilitiesPayload,
  EcostressResultPayload,
} from '../../../shared/index.ts';
import type { IEvapotranspirationRepository } from '../../repositories/interfaces/IEvapotranspirationRepository.ts';
import type { IEvapotranspirationService } from '../interfaces/IEvapotranspirationService.ts';

export class EvapotranspirationService implements IEvapotranspirationService {
  private readonly repository: IEvapotranspirationRepository;

  constructor(repository: IEvapotranspirationRepository) {
    this.repository = repository;
  }

  getCapabilities(): EcostressProviderCapabilitiesPayload {
    return this.repository.getCapabilities();
  }

  async submitJob(request: EcostressJobSubmissionRequest): Promise<EcostressJobRecord> {
    return this.repository.submitJob(request);
  }

  async getJobStatus(
    jobId: string,
    options?: { refresh?: boolean },
  ): Promise<EcostressJobRecord> {
    return this.repository.getJobStatus(jobId, options);
  }

  async getJobResults(jobId: string): Promise<EcostressResultPayload> {
    return this.repository.getJobResults(jobId);
  }
}
