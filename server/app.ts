import express, { type Express } from 'express';
import { env } from './config/env.ts';
import { createControllerContainer, type ControllerContainer } from './controllers/index.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { requestContext } from './middleware/requestContext.ts';
import { createRequestLogger, type RequestLogWriter } from './middleware/requestLogger.ts';
import { createRepositoryContainer, type RepositoryContainer } from './repositories/index.ts';
import { createV1Router } from './routes/v1/index.ts';
import { createServiceContainer, type ServiceContainer } from './services/index.ts';

export interface CreateAppOptions {
  repositories?: RepositoryContainer;
  services?: ServiceContainer;
  controllers?: ControllerContainer;
  apiPrefix?: string;
  logWriter?: RequestLogWriter;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const repositories = options.repositories ?? createRepositoryContainer();
  const services = options.services ?? createServiceContainer(repositories);
  const controllers = options.controllers ?? createControllerContainer(services);
  const apiPrefix = options.apiPrefix ?? env.apiPrefix;

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(createRequestLogger(options.logWriter));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(apiPrefix, createV1Router(controllers));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
