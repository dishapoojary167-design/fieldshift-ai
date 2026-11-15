import type { NextFunction, Request, Response } from 'express';
import { RateLimitError } from '../errors/AppError.ts';

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { maxRequests, windowMs, keyPrefix = 'ai' } = options;
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const clientIp =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : undefined) ||
      req.ip ||
      req.socket?.remoteAddress ||
      'local';

    const key = `${keyPrefix}:${clientIp}`;
    const existing = buckets.get(key) ?? [];
    const activeTimestamps = existing.filter((ts) => now - ts < windowMs);

    if (activeTimestamps.length >= maxRequests) {
      const oldest = activeTimestamps[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      next(
        new RateLimitError(
          `AI assistant rate limit exceeded (${maxRequests} requests per ${Math.round(windowMs / 1000)}s). Retry after ${retryAfterSeconds}s.`,
          { retryAfterSeconds, maxRequests, windowMs },
        ),
      );
      return;
    }

    activeTimestamps.push(now);
    buckets.set(key, activeTimestamps);

    // Opportunistic pruning if map grows
    if (buckets.size > 1000) {
      for (const [bucketKey, timestamps] of buckets.entries()) {
        if (timestamps.every((ts) => now - ts >= windowMs)) {
          buckets.delete(bucketKey);
        }
      }
    }

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - activeTimestamps.length)));
    next();
  };
}
