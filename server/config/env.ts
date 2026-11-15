import 'dotenv/config';
import { API_PREFIX } from '../../shared/index.ts';

export type NodeEnvironment = 'development' | 'production' | 'test';

export interface AppEnvConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  apiPrefix: string;
  appUrl: string;
  geminiApiKey: string | undefined;
  geminiModel: string;
  isGeminiConfigured: boolean;
  nasaPowerBaseUrl: string;
  nasaGpmImergBaseUrl: string;
  nasaEarthdataToken: string | undefined;
  nasaAppeearsBaseUrl: string;
  nasaAppeearsToken: string | undefined;
  nasaEarthdataUsername: string | undefined;
  nasaEarthdataPassword: string | undefined;
  soilGridsBaseUrl: string;
  soilGridsWcsBaseUrl: string;
  gibsWmtsBaseUrl: string;
  weatherCacheTtlMs: number;
  weatherHttpTimeoutMs: number;
  soilCacheTtlMs: number;
  soilHttpTimeoutMs: number;
  ecostressCacheTtlMs: number;
  ecostressHttpTimeoutMs: number;
  ecostressJobTtlMs: number;
  geminiHttpTimeoutMs: number;
  aiRateLimitMaxRequests: number;
  aiRateLimitWindowMs: number;
}

function parseNodeEnv(value: string | undefined): NodeEnvironment {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }
  return 'development';
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT environment variable: "${value}". Expected integer between 1 and 65535.`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} environment variable: "${value}". Expected positive integer.`);
  }
  return parsed;
}

function normalizeApiPrefix(value: string | undefined): string {
  const prefix = (value || API_PREFIX).trim();
  if (!prefix.startsWith('/')) {
    throw new Error(`Invalid API_PREFIX environment variable: "${prefix}". Must start with "/".`);
  }
  return prefix.endsWith('/') && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
}

function sanitizeOptionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith('MY_') || trimmed === 'undefined' || trimmed === 'null') {
    return undefined;
  }
  return trimmed;
}

export function loadEnvConfig(source: NodeJS.ProcessEnv = process.env): AppEnvConfig {
  const geminiApiKey = source.GEMINI_API_KEY?.trim() || undefined;
  const nasaEarthdataToken = sanitizeOptionalSecret(source.NASA_EARTHDATA_TOKEN);
  const nasaAppeearsToken = sanitizeOptionalSecret(source.NASA_APPEEARS_TOKEN);
  const nasaEarthdataUsername = sanitizeOptionalSecret(source.NASA_EARTHDATA_USERNAME);
  const nasaEarthdataPassword = sanitizeOptionalSecret(source.NASA_EARTHDATA_PASSWORD);

  return {
    nodeEnv: parseNodeEnv(source.NODE_ENV),
    port: parsePort(source.PORT),
    apiPrefix: normalizeApiPrefix(source.API_PREFIX),
    appUrl: source.APP_URL?.trim() || 'http://localhost:3000',
    geminiApiKey,
    geminiModel: source.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen',
    isGeminiConfigured: Boolean(geminiApiKey && geminiApiKey !== 'MY_GEMINI_API_KEY'),
    nasaPowerBaseUrl: source.NASA_POWER_BASE_URL?.trim() || 'https://power.larc.nasa.gov/api',
    nasaGpmImergBaseUrl:
      source.NASA_GPM_IMERG_BASE_URL?.trim() ||
      'https://gis.earthdata.nasa.gov/portal/rest/services/GESDISC/GPM_3IMERGHHE/ImageServer',
    nasaEarthdataToken,
    nasaAppeearsBaseUrl: (
      source.NASA_APPEEARS_BASE_URL?.trim() ||
      'https://appeears.earthdatacloud.nasa.gov/api'
    ).replace(/\/+$/, ''),
    nasaAppeearsToken,
    nasaEarthdataUsername,
    nasaEarthdataPassword,
    soilGridsBaseUrl: source.SOILGRIDS_BASE_URL?.trim() || 'https://rest.isric.org/soilgrids/v2.0',
    soilGridsWcsBaseUrl: source.SOILGRIDS_WCS_BASE_URL?.trim() || 'https://maps.isric.org/mapserv',
    gibsWmtsBaseUrl: source.GIBS_WMTS_BASE_URL?.trim() || 'https://gibs.earthdata.nasa.gov',
    weatherCacheTtlMs: parsePositiveInt(source.WEATHER_CACHE_TTL_MS, 15 * 60 * 1000, 'WEATHER_CACHE_TTL_MS'),
    weatherHttpTimeoutMs: parsePositiveInt(source.WEATHER_HTTP_TIMEOUT_MS, 10_000, 'WEATHER_HTTP_TIMEOUT_MS'),
    soilCacheTtlMs: parsePositiveInt(source.SOIL_CACHE_TTL_MS, 60 * 60 * 1000, 'SOIL_CACHE_TTL_MS'),
    soilHttpTimeoutMs: parsePositiveInt(source.SOIL_HTTP_TIMEOUT_MS, 6_000, 'SOIL_HTTP_TIMEOUT_MS'),
    ecostressCacheTtlMs: parsePositiveInt(
      source.ECOSTRESS_CACHE_TTL_MS,
      60 * 60 * 1000,
      'ECOSTRESS_CACHE_TTL_MS',
    ),
    ecostressHttpTimeoutMs: parsePositiveInt(
      source.ECOSTRESS_HTTP_TIMEOUT_MS,
      15_000,
      'ECOSTRESS_HTTP_TIMEOUT_MS',
    ),
    ecostressJobTtlMs: parsePositiveInt(
      source.ECOSTRESS_JOB_TTL_MS,
      24 * 60 * 60 * 1000,
      'ECOSTRESS_JOB_TTL_MS',
    ),
    geminiHttpTimeoutMs: parsePositiveInt(source.GEMINI_HTTP_TIMEOUT_MS, 45_000, 'GEMINI_HTTP_TIMEOUT_MS'),
    aiRateLimitMaxRequests: parsePositiveInt(source.AI_RATE_LIMIT_MAX_REQUESTS, 20, 'AI_RATE_LIMIT_MAX_REQUESTS'),
    aiRateLimitWindowMs: parsePositiveInt(source.AI_RATE_LIMIT_WINDOW_MS, 60_000, 'AI_RATE_LIMIT_WINDOW_MS'),
  };
}

export const env: AppEnvConfig = loadEnvConfig();

export function validateEnv(config: AppEnvConfig = env): AppEnvConfig {
  if (!config.nasaPowerBaseUrl.startsWith('http')) {
    throw new Error(`Invalid NASA_POWER_BASE_URL: "${config.nasaPowerBaseUrl}"`);
  }
  if (!config.nasaGpmImergBaseUrl.startsWith('http')) {
    throw new Error(`Invalid NASA_GPM_IMERG_BASE_URL: "${config.nasaGpmImergBaseUrl}"`);
  }
  if (!config.nasaAppeearsBaseUrl.startsWith('http')) {
    throw new Error(`Invalid NASA_APPEEARS_BASE_URL: "${config.nasaAppeearsBaseUrl}"`);
  }
  if (!config.soilGridsBaseUrl.startsWith('http')) {
    throw new Error(`Invalid SOILGRIDS_BASE_URL: "${config.soilGridsBaseUrl}"`);
  }
  if (!config.soilGridsWcsBaseUrl.startsWith('http')) {
    throw new Error(`Invalid SOILGRIDS_WCS_BASE_URL: "${config.soilGridsWcsBaseUrl}"`);
  }
  if (!config.gibsWmtsBaseUrl.startsWith('http')) {
    throw new Error(`Invalid GIBS_WMTS_BASE_URL: "${config.gibsWmtsBaseUrl}"`);
  }
  return config;
}
