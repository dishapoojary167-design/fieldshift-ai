import type { Request, Response } from 'express';
import type { EcostressJobSubmissionRequest } from '../../shared/index.ts';
import type { IEvapotranspirationService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class EvapotranspirationController {
  private readonly service: IEvapotranspirationService;

  constructor(service: IEvapotranspirationService) {
    this.service = service;
  }

  getProducts = async (req: Request, res: Response): Promise<void> => {
    const capabilities = this.service.getCapabilities();
    sendSuccess(res, req, capabilities, 200);
  };

  submitJob = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as EcostressJobSubmissionRequest;
    const job = await this.service.submitJob(payload);
    sendSuccess(res, req, job, 202);
  };

  getJobStatus = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = (req.validated?.params ?? req.params) as { jobId: string };
    const query = (req.validated?.query ?? req.query) as { refresh?: boolean };
    const status = await this.service.getJobStatus(jobId, { refresh: query.refresh });
    sendSuccess(res, req, status, 200);
  };

  getJobResults = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = (req.validated?.params ?? req.params) as { jobId: string };
    const results = await this.service.getJobResults(jobId);
    sendSuccess(res, req, results, 200);
  };
}
