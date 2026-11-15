import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../utils/errors.ts';

export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new ValidationError('Invalid route parameters', result.error.flatten()));
      return;
    }
    Object.assign(req.params, result.data);
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new ValidationError('Invalid query parameters', result.error.flatten()));
      return;
    }
    resLocalsValidatedQuery(req, result.data);
    next();
  };
}

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new ValidationError('Invalid request body', result.error.flatten()));
      return;
    }
    req.body = result.data;
    next();
  };
}

function resLocalsValidatedQuery(req: Request, data: unknown): void {
  (req as Request & { validatedQuery?: unknown }).validatedQuery = data;
}
