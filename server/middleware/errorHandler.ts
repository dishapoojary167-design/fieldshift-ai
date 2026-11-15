import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { API_VERSION, ERROR_CODES, type ApiErrorResponse } from '../../shared/index.ts';
import { env } from '../config/env.ts';
import { AppError, NotFoundError } from '../errors/AppError.ts';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void | Response> | void | Response,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Endpoint not found: ${req.method} ${req.originalUrl}`));
}

function isMalformedJsonError(err: unknown): err is SyntaxError & { status?: number; type?: string } {
  return (
    err instanceof SyntaxError &&
    typeof (err as { status?: unknown }).status === 'number' &&
    (err as { status?: number }).status === 400
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (isMalformedJsonError(err)) {
    const payload: ApiErrorResponse = {
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Malformed JSON request body.',
      },
      meta: {
        apiVersion: API_VERSION,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    };
    res.status(400).json(payload);
    return;
  }

  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : ERROR_CODES.INTERNAL_ERROR;

  const message = isAppError
    ? err.message
    : env.nodeEnv === 'production'
      ? 'An unexpected internal error occurred.'
      : err instanceof Error
        ? err.message
        : 'An unexpected internal error occurred.';

  if ((!isAppError || statusCode >= 500) && env.nodeEnv !== 'test') {
    console.error(`[${req.requestId || 'no-req-id'}] Error ${statusCode}:`, err);
  }

  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(isAppError && err.details !== undefined ? { details: err.details } : {}),
    },
    meta: {
      apiVersion: API_VERSION,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    },
  };

  res.status(statusCode).json(payload);
}
