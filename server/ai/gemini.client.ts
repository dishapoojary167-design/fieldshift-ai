import type {
  AiAdvisoryInput,
  AiAdvisoryOutput,
  AiAdvisoryProvider,
  ProviderDescriptor,
} from '../../shared/types/index.ts';
import { getServerEnv, isSecretConfigured } from '../utils/env.ts';
import { NotImplementedModuleError } from '../utils/errors.ts';

export class GeminiAdvisoryProvider implements AiAdvisoryProvider {
  public readonly descriptor: ProviderDescriptor;

  constructor() {
    const env = getServerEnv();
    const hasKey = isSecretConfigured(env.GEMINI_API_KEY);

    this.descriptor = {
      id: 'google-gemini-advisory',
      name: 'Google Gemini Agronomic Advisory',
      category: 'ai_advisory',
      status: hasKey ? 'configured' : 'interface_ready',
      requiresCredentials: true,
      credentialsPresent: hasKey,
      supportedParameters: ['crop_advisory_synthesis', 'rotation_explanation', 'risk_briefing'],
      spatialResolutionLabel: 'Farm / Plot Level',
      provenance: {
        providerId: 'google-gemini-advisory',
        providerName: 'Google GenAI SDK (@google/genai)',
        datasetName: 'Gemini Reasoning Layer (Server-Side Only)',
      },
      plannedModule: 'Module 04',
    };
  }

  async generateAdvisory(_input: AiAdvisoryInput): Promise<AiAdvisoryOutput> {
    throw new NotImplementedModuleError('Gemini AI agronomic advisory generation', 'Module 04');
  }
}
