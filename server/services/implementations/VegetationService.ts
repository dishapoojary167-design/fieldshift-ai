import type {
  HlsJobRecord,
  HlsJobSubmissionRequest,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
} from '../../../shared/index.ts';
import type { IVegetationRepository } from '../../repositories/interfaces/IVegetationRepository.ts';
import type { IVegetationService } from '../interfaces/IVegetationService.ts';

export class VegetationService implements IVegetationService {
  private readonly repository: IVegetationRepository;

  constructor(repository: IVegetationRepository) {
    this.repository = repository;
  }

  getCapabilities(): HlsProviderCapabilitiesPayload {
    return this.repository.getCapabilities();
  }

  async submitJob(request: HlsJobSubmissionRequest): Promise<HlsJobRecord> {
    return this.repository.submitJob(request);
  }

  async getJobStatus(jobId: string, options?: { refresh?: boolean }): Promise<HlsJobRecord> {
    return this.repository.getJobStatus(jobId, options);
  }

  async getJobResults(jobId: string): Promise<HlsResultPayload> {
    return this.repository.getJobResults(jobId);
  }
}
