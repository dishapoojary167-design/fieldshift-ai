import type { Request, Response } from 'express';
import type { AiAssistantRequest } from '../../shared/index.ts';
import type { IAiAssistantService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class AiAssistantController {
  private readonly aiAssistantService: IAiAssistantService;

  constructor(aiAssistantService: IAiAssistantService) {
    this.aiAssistantService = aiAssistantService;
  }

  ask = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as AiAssistantRequest;
    const answer = await this.aiAssistantService.askAssistant(payload);
    sendSuccess(res, req, answer, 200);
  };
}
