import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';

export interface RequestLogEntry {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
}

export type RequestLogWriter = (entry: RequestLogEntry) => void;

const defaultWriter: RequestLogWriter = (entry) => {
  if (env.nodeEnv === 'test') {
    return;
  }
  console.info(
    `[FieldShift AI] ${entry.method} ${entry.path} ${entry.statusCode} ${entry.durationMs.toFixed(1)}ms reqId=${entry.requestId}`,
  );
};

export function createRequestLogger(writer: RequestLogWriter = defaultWriter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      writer({
        requestId: req.requestId || 'unknown',
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}

export const requestLogger = createRequestLogger();
