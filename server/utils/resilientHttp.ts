import { ExternalServiceError } from '../errors/AppError.ts';

export type FetchLike = typeof fetch;

export interface ResilientFetchOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
  serviceName?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(
  url: string,
  options: ResilientFetchOptions = {},
): Promise<T> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 300;
  const serviceName = options.serviceName ?? 'External API';

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
          ...(options.headers ?? {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          await delay(retryDelayMs * (attempt + 1));
          continue;
        }
        const errText = await response.text().catch(() => '');
        throw new ExternalServiceError(
          `${serviceName} returned HTTP ${response.status}.`,
          {
            upstreamStatus: response.status,
            upstreamMessage: errText.slice(0, 300) || undefined,
          },
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (error instanceof ExternalServiceError) {
        throw error;
      }

      const isAbort =
        error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));

      if (attempt < maxRetries) {
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }

      throw new ExternalServiceError(
        isAbort
          ? `${serviceName} request timed out after ${timeoutMs}ms.`
          : `Failed to connect to ${serviceName}.`,
        {
          reason: error instanceof Error ? error.message : 'Unknown network error',
          attempts: attempt + 1,
        },
      );
    }
  }

  throw new ExternalServiceError(`${serviceName} request failed.`, {
    reason: lastError instanceof Error ? lastError.message : 'Unknown error',
  });
}
