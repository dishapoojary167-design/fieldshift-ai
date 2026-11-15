import type { Request, Response } from 'express';
import type { SoilMoistureRequest, SoilProfileRequest } from '../../shared/index.ts';
import type { ISoilService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class SoilController {
  private readonly soilService: ISoilService;

  constructor(soilService: ISoilService) {
    this.soilService = soilService;
  }

  getProfile = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as SoilProfileRequest;
    const profile = await this.soilService.getSoilProfile(payload);
    sendSuccess(res, req, profile, 200);
  };

  getMoisture = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as SoilMoistureRequest;
    const moisture = await this.soilService.getSoilMoisture(payload);
    sendSuccess(res, req, moisture, 200);
  };
}
