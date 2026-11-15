import dotenv from 'dotenv';
import { z } from 'zod';
import {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_REGION_CODE,
} from '../../shared/constants/regions.ts';

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  APP_URL: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  DEFAULT_COUNTRY_CODE: z.string().min(2).max(3).default(DEFAULT_COUNTRY_CODE),
  DEFAULT_REGION_CODE: z.string().min(2).max(16).default(DEFAULT_REGION_CODE),
  NASA_POWER_BASE_URL: z.string().url().default('https://power.larc.nasa.gov/api'),
  NASA_GPM_BASE_URL: z.string().url().default('https://gpm1.gesdisc.eosdis.nasa.gov'),
  NASA_SMAP_BASE_URL: z.string().url().default('https://n5eil01u.ecs.nsidc.org'),
  NASA_GIBS_WMTS_URL: z
    .string()
    .url()
    .default('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'),
  NASA_EARTHDATA_TOKEN: z.string().optional().default(''),
  NASA_APPEEARS_BASE_URL: z
    .string()
    .url()
    .default('https://appeears.earthdatacloud.nasa.gov/api'),
  NASA_APPEEARS_TOKEN: z.string().optional().default(''),
  NASA_EARTHDATA_USERNAME: z.string().optional().default(''),
  NASA_EARTHDATA_PASSWORD: z.string().optional().default(''),
  SOILGRIDS_BASE_URL: z.string().url().default('https://rest.isric.org/soilgrids/v2.0'),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server environment configuration: ${formatted}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function isSecretConfigured(secretValue: string): boolean {
  const trimmed = secretValue.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith('MY_') &&
    trimmed !== 'undefined' &&
    trimmed !== 'null'
  );
}
