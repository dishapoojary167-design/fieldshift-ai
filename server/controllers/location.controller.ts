import type { Request, Response } from 'express';
import type { LocationResolveRequest } from '../../shared/index.ts';
import type { ILocationService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class LocationController {
  private readonly locationService: ILocationService;

  constructor(locationService: ILocationService) {
    this.locationService = locationService;
  }

  resolveLocation = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as LocationResolveRequest;
    const result = await this.locationService.resolveLocation(payload);
    sendSuccess(res, req, result, 200);
  };

  listRegions = async (req: Request, res: Response): Promise<void> => {
    const regions = await this.locationService.listRegions();
    sendSuccess(res, req, regions, 200);
  };
}
