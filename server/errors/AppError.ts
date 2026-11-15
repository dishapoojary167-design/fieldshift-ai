import { ERROR_CODES, type ErrorCode } from '../../shared/index.ts';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = ERROR_CODES.INTERNAL_ERROR,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, ERROR_CODES.VALIDATION_ERROR, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found', details?: unknown) {
    super(message, 404, ERROR_CODES.NOT_FOUND, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 502, ERROR_CODES.EXTERNAL_SERVICE_ERROR, details);
  }
}

export class ServiceNotImplementedError extends AppError {
  constructor(serviceName: string, operation?: string) {
    const label = operation ? `${serviceName}.${operation}` : serviceName;
    super(
      `${label} is scaffolded as a service interface and has not been implemented yet.`,
      501,
      ERROR_CODES.NOT_IMPLEMENTED,
      { service: serviceName, operation },
    );
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 500, ERROR_CODES.CONFIGURATION_ERROR, details, false);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please wait a moment and try again.', details?: unknown) {
    super(message, 429, ERROR_CODES.RATE_LIMITED, details);
  }
}

export class ServiceTimeoutError extends AppError {
  constructor(message = 'Upstream service timed out before returning a response.', details?: unknown) {
    super(message, 504, ERROR_CODES.SERVICE_TIMEOUT, details);
  }
}

export class PolygonProcessingUnsupportedError extends AppError {
  constructor(providerOrStage: string, details?: Record<string, unknown>) {
    super(
      `Polygon zonal processing was requested for ${providerOrStage}, but current providers only support point/centroid grid lookups. Centroid substitution was refused.`,
      501,
      ERROR_CODES.NOT_IMPLEMENTED,
      {
        reason: 'POLYGON_PROCESSING_UNSUPPORTED',
        stage: providerOrStage,
        ...details,
      },
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, ERROR_CODES.JOB_NOT_READY, details);
  }
}

export class JobExpiredError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 410, ERROR_CODES.JOB_EXPIRED, details);
  }
}
