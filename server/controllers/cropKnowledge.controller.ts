import type { Request, Response } from 'express';
import type { CropCatalogFilter } from '../../shared/index.ts';
import type { ICropKnowledgeService } from '../services/interfaces/ICropKnowledgeService.ts';
import { sendSuccess } from '../utils/response.ts';

export class CropKnowledgeController {
  private readonly cropKnowledgeService: ICropKnowledgeService;

  constructor(cropKnowledgeService: ICropKnowledgeService) {
    this.cropKnowledgeService = cropKnowledgeService;
  }

  listCatalog = async (req: Request, res: Response): Promise<void> => {
    const filter = (req.validated?.query ?? req.query) as unknown as CropCatalogFilter;
    const result = await this.cropKnowledgeService.searchCrops(filter);
    sendSuccess(res, req, result, 200);
  };

  getRegions = async (req: Request, res: Response): Promise<void> => {
    const result = await this.cropKnowledgeService.getAgroClimaticRegions();
    sendSuccess(res, req, result, 200);
  };

  getCropById = async (req: Request, res: Response): Promise<void> => {
    const { cropId } = (req.validated?.params ?? req.params) as { cropId: string };
    const result = await this.cropKnowledgeService.getCropById(cropId);
    sendSuccess(res, req, result, 200);
  };
}
