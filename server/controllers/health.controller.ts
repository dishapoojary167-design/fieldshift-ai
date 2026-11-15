import type { Request, Response } from 'express';
import {
  API_VERSION,
  APP_NAME,
  APP_VERSION,
  CHALLENGE_NAME,
  type HealthCheckPayload,
} from '../../shared/index.ts';
import { env } from '../config/env.ts';
import type { ServiceContainer } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';

export class HealthController {
  private readonly services: ServiceContainer;

  constructor(services: ServiceContainer) {
    this.services = services;
  }

  getHealth = (req: Request, res: Response): void => {
    const payload: HealthCheckPayload = {
      status: 'ok',
      appName: APP_NAME,
      challenge: CHALLENGE_NAME,
      version: APP_VERSION,
      apiVersion: API_VERSION,
      environment: env.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: {
        location: this.services.location.getStatus(),
        weather: this.services.weather.getStatus(),
        soil: this.services.soil.getStatus(),
        cropIntelligence: this.services.cropIntelligence.getStatus(),
        cropRotation: this.services.cropRotation.getStatus(),
        aiAssistant: this.services.aiAssistant.getStatus(),
      },
    };

    sendSuccess(res, req, payload, 200);
  };
}
