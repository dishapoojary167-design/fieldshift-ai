import type {
  AiAssistantRequest,
  AiAssistantResponse,
  ServiceReadinessStatus,
} from '../../../shared/index.ts';

export interface IAiAssistantService {
  getStatus(): ServiceReadinessStatus;
  askAssistant(request: AiAssistantRequest): Promise<AiAssistantResponse>;
}
