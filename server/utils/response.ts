import type { Request, Response } from 'express';
import { API_VERSION, type ApiSuccessResponse } from '../../shared/index.ts';

export function createSuccessResponse<T>(data: T, req?: Request): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      apiVersion: API_VERSION,
      timestamp: new Date().toISOString(),
      ...(req?.requestId ? { requestId: req.requestId } : {}),
    },
  };
}

export function sendSuccess<T>(
  res: Response,
  req: Request,
  data: T,
  statusCode = 200,
): Response<ApiSuccessResponse<T>> {
  return res.status(statusCode).json(createSuccessResponse(data, req));
}
