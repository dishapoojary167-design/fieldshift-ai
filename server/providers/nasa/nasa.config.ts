import { getServerEnv } from '../../utils/env.ts';
import type { NasaProviderConfig } from './nasa.types.ts';

export function getNasaProviderConfig(): NasaProviderConfig {
  const env = getServerEnv();
  return {
    powerBaseUrl: env.NASA_POWER_BASE_URL || 'https://power.larc.nasa.gov/api/temporal/daily/point',
    gpmBaseUrl: env.NASA_GPM_BASE_URL || 'https://gpm1.gesdisc.eosdis.nasa.gov',
    smapBaseUrl: env.NASA_SMAP_BASE_URL || 'https://n5eil01u.ecs.nsidc.org',
    gibsWmtsUrl: env.NASA_GIBS_WMTS_URL || 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best',
    defaultTimeoutMs: 10000,
    maxRetries: 3,
    userAgent: 'FieldShift-AI/0.1.0 (NASA-Space-Apps-2026)',
  };
}
