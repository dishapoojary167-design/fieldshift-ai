export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_SERVER_ERROR',
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
  constructor(message = 'Request validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(providerName: string, details?: unknown) {
    super(
      `External data provider "${providerName}" is unavailable`,
      503,
      'PROVIDER_UNAVAILABLE',
      details,
    );
  }
}

export class NotImplementedModuleError extends AppError {
  constructor(capability: string, targetModule: string) {
    super(
      `${capability} is defined as an architectural interface in Module 00 and will be implemented in ${targetModule}.`,
      501,
      'NOT_IMPLEMENTED_IN_MODULE_00',
      { capability, targetModule },
    );
  }
}
