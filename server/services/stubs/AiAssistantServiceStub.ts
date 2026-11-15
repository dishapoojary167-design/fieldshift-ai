import { GoogleGenAI } from '@google/genai';
import type {
  AiAssistantRequest,
  AiAssistantResponse,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';
import { env } from '../../config/env.ts';
import { ConfigurationError, ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { IAiAssistantService } from '../interfaces/index.ts';

export class AiAssistantServiceStub implements IAiAssistantService {
  private client: GoogleGenAI | null = null;

  getStatus(): ServiceReadinessStatus {
    return env.isGeminiConfigured ? 'stub' : 'unconfigured';
  }

  protected getClient(): GoogleGenAI {
    if (!env.isGeminiConfigured || !env.geminiApiKey) {
      throw new ConfigurationError('GEMINI_API_KEY is not configured in the server environment.');
    }
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: env.geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return this.client;
  }

  async askAssistant(_request: AiAssistantRequest): Promise<AiAssistantResponse> {
    throw new ServiceNotImplementedError('AiAssistantService', 'askAssistant');
  }
}
