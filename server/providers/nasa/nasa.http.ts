import type { NasaHttpOptions } from './nasa.types.ts';
import { getServerEnv } from '../../utils/env.ts';

export async function fetchWithNasaRetry(
  url: string,
  options: NasaHttpOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const retries = options.retries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  const env = getServerEnv();

  const headers: Record<string, string> = {
    'User-Agent': 'FieldShift-AI/0.1.0 (NASA-Space-Apps-2026)',
    'Accept': 'application/json,image/png,*/*',
    ...options.headers,
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 404) {
        return response;
      }

      // If server error (5xx), retry
      if (response.status >= 500 && attempt < retries) {
        console.warn(`[FieldShift AI] NASA HTTP warning: status ${response.status} for ${url}. Attempt ${attempt}/${retries}. Retrying in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }

      return response;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries) {
        console.warn(`[FieldShift AI] NASA HTTP request failed for ${url} (attempt ${attempt}/${retries}): ${lastError.message}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch from NASA endpoint after ${retries} attempts: ${url}`);
}
