import type { Request, Response } from 'express';
import type {
  CropRotationPlanRequest,
  RotationCompareRequest,
  RotationGenerateRequest,
} from '../../shared/index.ts';
import type { ICropRotationService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class CropRotationController {
  private readonly cropRotationService: ICropRotationService;

  constructor(cropRotationService: ICropRotationService) {
    this.cropRotationService = cropRotationService;
  }

  generatePlan = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as CropRotationPlanRequest;
    const plan = await this.cropRotationService.generateRotationPlan(payload);
    sendSuccess(res, req, plan, 200);
  };

  generate = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as RotationGenerateRequest;
    const result = await this.cropRotationService.generateRotationStrategies(payload);
    sendSuccess(res, req, result, 200);
  };

  compare = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as RotationCompareRequest;
    const result = await this.cropRotationService.compareRotationStrategies(payload);
    sendSuccess(res, req, result, 200);
  };
}
