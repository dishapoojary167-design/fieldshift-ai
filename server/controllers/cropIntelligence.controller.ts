import type { Request, Response } from 'express';
import type { CropIntelligenceRequest } from '../../shared/index.ts';
import type { ICropIntelligenceService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class CropIntelligenceController {
  private readonly cropIntelligenceService: ICropIntelligenceService;

  constructor(cropIntelligenceService: ICropIntelligenceService) {
    this.cropIntelligenceService = cropIntelligenceService;
  }

  analyzeSuitability = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as CropIntelligenceRequest;
    const result = await this.cropIntelligenceService.analyzeSuitability(payload);
    sendSuccess(res, req, result, 200);
  };
}
