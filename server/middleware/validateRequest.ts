import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type ZodType } from 'zod';
import { ValidationError } from '../errors/AppError.ts';

export interface ValidatedRequestParts<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}

declare global {
  namespace Express {
    interface Request {
      validated?: ValidatedRequestParts;
    }
  }
}

export interface RequestValidationSchemas<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
}

interface ValidationIssueDetail {
  location: 'body' | 'query' | 'params';
  path: string;
  message: string;
  code: string;
}

export function validateRequest<TBody = unknown, TQuery = unknown, TParams = unknown>(
  schemas: RequestValidationSchemas<TBody, TQuery, TParams>,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues: ValidationIssueDetail[] = [];
    const validated: ValidatedRequestParts<TBody, TQuery, TParams> = {};

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            location: 'params',
            path: issue.path.join('.') || 'params',
            message: issue.message,
            code: issue.code,
          });
        }
      } else {
        validated.params = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            location: 'query',
            path: issue.path.join('.') || 'query',
            message: issue.message,
            code: issue.code,
          });
        }
      } else {
        validated.query = result.data;
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            location: 'body',
            path: issue.path.join('.') || 'body',
            message: issue.message,
            code: issue.code,
          });
        }
      } else {
        validated.body = result.data;
        req.body = result.data;
      }
    }

    if (issues.length > 0) {
      next(new ValidationError('Request validation failed.', { issues }));
      return;
    }

    req.validated = validated;
    next();
  };
}
