import type {
  HlsBundleFileDescriptor,
  HlsJobRecord,
  HlsJobStatus,
  HlsLayerId,
  HlsObservationQualityStatus,
  HlsPolygonStats,
  HlsProductId,
  HlsProductSpecification,
  HlsResultPayload,
  HlsResultSummary,
  HlsSurfaceReflectanceObservation,
  GeoJsonPolygon,
} from '../../../shared/index.ts';
import { env } from '../../config/env.ts';
import {
  ConfigurationError,
  ExternalServiceError,
  JobExpiredError,
} from '../../errors/AppError.ts';
import {
  parseGeoTiffGrid,
  getIntersectingPixelIndices,
  type ParsedGeoTiffGrid,
} from '../../utils/ecostressGeoTiff.ts';
import type { FetchLike } from '../../utils/resilientHttp.ts';
import { TtlCache } from '../../utils/ttlCache.ts';
import {
  HLS_PRODUCT_SPECS,
  bboxToGeoJsonPolygon,
} from './hlsProducts.ts';
import type {
  HlsJobSubmissionReceipt,
  HlsProviderAuthStatus,
  HlsProviderSubmitInput,
  HlsUpstreamTaskStatus,
  ILandsatHlsProvider,
} from './ILandsatHlsProvider.ts';

export interface LandsatHlsAppEearsProviderOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  jobTtlMs?: number;
  staleMaxAgeDays?: number;
  nowFn?: () => number;
  appeearsToken?: string;
  earthdataToken?: string;
  earthdataUsername?: string;
  earthdataPassword?: string;
}

interface AppeearsLoginResponse {
  token_type?: string;
  token?: string;
  expiration?: string;
}

interface AppeearsTaskResponse {
  task_id?: string;
  task_name?: string;
  status?: string;
  created?: string;
  updated?: string;
  expires_on?: string;
  error?: string;
  message?: string;
  progress?: {
    summary?: number;
    details?: Array<{ step?: string; pct_complete?: number }>;
  };
}

interface AppeearsBundleResponse {
  files?: Array<{
    file_id?: string;
    file_name?: string;
    file_size?: number;
    file_type?: string;
    sha256?: string;
  }>;
  task_id?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAppeearsDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}-${day}-${year}`;
}

function mapAppeearsStatus(rawStatus: string | undefined): HlsJobStatus {
  const normalized = (rawStatus ?? '').trim().toLowerCase();
  if (normalized === 'done' || normalized === 'completed') return 'completed';
  if (normalized === 'processing' || normalized === 'running') return 'processing';
  if (normalized === 'queued' || normalized === 'pending' || normalized === 'submitted') {
    return 'pending';
  }
  if (normalized === 'expired') return 'expired';
  if (normalized === 'error' || normalized === 'failed' || normalized === 'deleted') {
    return 'failed';
  }
  return 'pending';
}

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed === 'null') return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num === -9999 || num === -999) {
    return null;
  }
  return num;
}

function averageOrNull(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return Number((valid.reduce((sum, v) => sum + v, 0) / valid.length).toFixed(4));
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function inferProductFromFilename(fileName: string): HlsProductId | null {
  if (fileName.includes('HLSS30') || fileName.includes('Sentinel')) return 'HLSS30.002';
  if (fileName.includes('HLSL30') || fileName.includes('Landsat')) return 'HLSL30.002';
  return null;
}

function doyToIsoTimestamp(year: number, dayOfYear: number, hh = 0, mm = 0, ss = 0): string {
  const baseMs = Date.UTC(year, 0, 1, hh, mm, ss);
  const dt = new Date(baseMs + (dayOfYear - 1) * 86_400_000);
  return dt.toISOString();
}

interface ParsedHlsRasterFileMeta {
  productId: HlsProductId;
  layer: HlsLayerId;
  observationTimestamp: string;
}

function parseAppeearsHlsFilename(fileName: string): ParsedHlsRasterFileMeta | null {
  const base = fileName.split('/').pop() ?? fileName;

  let productId: HlsProductId | null = null;
  if (/HLSS30(?:[._]002)?/i.test(base)) {
    productId = 'HLSS30.002';
  } else if (/HLSL30(?:[._]002)?/i.test(base)) {
    productId = 'HLSL30.002';
  }
  if (!productId) {
    productId = inferProductFromFilename(base);
  }
  if (!productId) {
    return null;
  }

  const knownLayers: HlsLayerId[] = ['B03', 'B04', 'B05', 'B8A', 'B08', 'B11', 'B12', 'Fmask'];
  let matchedLayer: HlsLayerId | null = null;
  for (const candidate of knownLayers) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:_|\\.)${escaped}(?:_|\\.)`, 'i').test(base)) {
      matchedLayer = candidate;
      break;
    }
  }
  if (!matchedLayer) {
    if (/fmask/i.test(base)) matchedLayer = 'Fmask';
    else if (/b03/i.test(base)) matchedLayer = 'B03';
    else if (/b04/i.test(base)) matchedLayer = 'B04';
    else if (/b05/i.test(base)) matchedLayer = 'B05';
    else if (/b8a/i.test(base)) matchedLayer = 'B8A';
    else if (/b08/i.test(base)) matchedLayer = 'B08';
    else if (/b11/i.test(base)) matchedLayer = 'B11';
    else if (/b12/i.test(base)) matchedLayer = 'B12';
    else return null;
  }

  const doyFull = base.match(/doy(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/i);
  if (doyFull) {
    const year = Number(doyFull[1]);
    const doy = Number(doyFull[2]);
    const hh = Number(doyFull[3]);
    const mm = Number(doyFull[4]);
    const ss = Number(doyFull[5]);
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: doyToIsoTimestamp(year, doy, hh, mm, ss),
    };
  }

  const doyShort = base.match(/doy(\d{4})(\d{3})/i);
  if (doyShort) {
    const year = Number(doyShort[1]);
    const doy = Number(doyShort[2]);
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: doyToIsoTimestamp(year, doy),
    };
  }

  const isoMatch = base.match(/(\d{4}-\d{2}-\d{2})(?:T(\d{2})[:-]?(\d{2})[:-]?(\d{2})Z?)?/);
  if (isoMatch) {
    const datePart = isoMatch[1];
    if (isoMatch[2]) {
      return {
        productId,
        layer: matchedLayer,
        observationTimestamp: `${datePart}T${isoMatch[2]}:${isoMatch[3]}:${isoMatch[4]}.000Z`,
      };
    }
    return {
      productId,
      layer: matchedLayer,
      observationTimestamp: `${datePart}T00:00:00.000Z`,
    };
  }

  return null;
}

function getHlsLayerUnit(productId: HlsProductId, layer: HlsLayerId): string {
  const spec = HLS_PRODUCT_SPECS[productId];
  return spec.layers.find((l) => l.layer === layer)?.units ?? 'unknown';
}

function isValidHlsPhysicalValue(layer: HlsLayerId, rawVal: number): boolean {
  if (!Number.isFinite(rawVal) || rawVal === -9999 || rawVal === -999) {
    return false;
  }
  if (layer === 'Fmask') {
    return rawVal >= 0 && rawVal <= 65535;
  }
  return rawVal >= -1000 && rawVal <= 16000;
}

function isFmaskCloudOrShadow(fmaskVal: number): boolean {
  const cloud = (fmaskVal & 0x02) !== 0 || (fmaskVal & 0x01) !== 0;
  const shadow = (fmaskVal & 0x04) !== 0;
  return cloud || shadow;
}

function isFmaskWater(fmaskVal: number): boolean {
  return (fmaskVal & 0x20) !== 0;
}

function assignLayerValueToObservation(
  obs: HlsSurfaceReflectanceObservation,
  layer: string,
  scaledVal: number | null,
  stats?: HlsPolygonStats,
): void {
  const normalizedLayer = layer.trim() as HlsLayerId;
  obs.parameterUnits[normalizedLayer] = getHlsLayerUnit(obs.productId, normalizedLayer);

  if (stats) {
    obs.layerStats = {
      ...(obs.layerStats ?? {}),
      [normalizedLayer]: stats,
    };
  }

  switch (normalizedLayer) {
    case 'B03':
      obs.greenReflectance = scaledVal;
      break;
    case 'B04':
      obs.redReflectance = scaledVal;
      break;
    case 'B05':
    case 'B8A':
    case 'B08':
      obs.nirReflectance = scaledVal;
      break;
    case 'B11':
    case 'B12':
      obs.swir1Reflectance = scaledVal;
      break;
    case 'Fmask':
      if (scaledVal !== null) {
        obs.cloudMaskFlag = isFmaskCloudOrShadow(scaledVal) ? 1 : 0;
        obs.waterMaskFlag = isFmaskWater(scaledVal) ? 1 : 0;
      }
      break;
    default:
      break;
  }
}

function hasAnyValidReflectance(obs: HlsSurfaceReflectanceObservation): boolean {
  return (
    obs.redReflectance !== null ||
    obs.nirReflectance !== null ||
    obs.greenReflectance !== null ||
    obs.ndvi !== null ||
    obs.ndwi !== null
  );
}

export class LandsatHlsAppEearsProvider implements ILandsatHlsProvider {
  public readonly providerId = 'nasa-hls-appeears';
  public readonly appeearsBaseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly jobTtlMs: number;
  private readonly staleMaxAgeDays: number;
  private readonly nowFn: () => number;
  private readonly appeearsToken?: string;
  private readonly earthdataToken?: string;
  private readonly earthdataUsername?: string;
  private readonly earthdataPassword?: string;
  private readonly sessionTokenCache: TtlCache<string>;
  private readonly resultCache: TtlCache<HlsResultPayload>;

  constructor(options: LandsatHlsAppEearsProviderOptions = {}) {
    this.appeearsBaseUrl = (options.baseUrl ?? env.nasaAppeearsBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? env.ecostressHttpTimeoutMs;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    const cacheTtlMs = options.cacheTtlMs ?? env.ecostressCacheTtlMs;
    this.jobTtlMs = options.jobTtlMs ?? env.ecostressJobTtlMs;
    this.staleMaxAgeDays = options.staleMaxAgeDays ?? 30;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.appeearsToken = options.appeearsToken ?? env.nasaAppeearsToken;
    this.earthdataToken = options.earthdataToken ?? env.nasaEarthdataToken;
    this.earthdataUsername = options.earthdataUsername ?? env.nasaEarthdataUsername;
    this.earthdataPassword = options.earthdataPassword ?? env.nasaEarthdataPassword;
    this.sessionTokenCache = new TtlCache<string>(47 * 60 * 60 * 1000, 4);
    this.resultCache = new TtlCache<HlsResultPayload>(cacheTtlMs, 100);
  }

  getVerifiedProducts(): HlsProductSpecification[] {
    return [HLS_PRODUCT_SPECS['HLSL30.002'], HLS_PRODUCT_SPECS['HLSS30.002']];
  }

  getAuthStatus(): HlsProviderAuthStatus {
    const hasAppeearsToken = Boolean(this.appeearsToken);
    const hasEarthdataCredentials = Boolean(this.earthdataUsername && this.earthdataPassword);
    const hasEarthdataToken = Boolean(this.earthdataToken);

    const authMode: HlsProviderAuthStatus['authMode'] = hasAppeearsToken
      ? 'appeears_token'
      : hasEarthdataCredentials
        ? 'earthdata_credentials'
        : hasEarthdataToken
          ? 'earthdata_token_fallback'
          : 'unconfigured';

    const notes: string[] = [
      'NASA AppEEARS supports asynchronous point and area (GeoJSON Polygon) subsetting for HLSL30.002 and HLSS30.002 surface reflectance.',
    ];

    if (authMode === 'unconfigured') {
      notes.push(
        'AppEEARS requires authentication via NASA_APPEEARS_TOKEN or NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD.',
      );
    }

    return {
      configured: authMode !== 'unconfigured',
      authMode,
      hasEarthdataToken,
      hasAppeearsToken,
      hasEarthdataCredentials,
      notes,
    };
  }

  private async resolveBearerToken(): Promise<string> {
    if (this.appeearsToken) {
      return this.appeearsToken;
    }

    const cached = this.sessionTokenCache.get('appeears-hls-session');
    if (cached) {
      return cached;
    }

    if (this.earthdataUsername && this.earthdataPassword) {
      const basic = Buffer.from(`${this.earthdataUsername}:${this.earthdataPassword}`).toString(
        'base64',
      );
      const loginResponse = await this.executeHttpWithRetry(
        `${this.appeearsBaseUrl}/login`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: 'application/json',
            'Content-Length': '0',
          },
        },
        'NASA AppEEARS Login',
      );

      const loginPayload = (await loginResponse.json()) as AppeearsLoginResponse;
      if (!loginPayload.token) {
        throw new ExternalServiceError(
          'NASA AppEEARS /login response did not contain a bearer session token.',
        );
      }

      let ttlMs = 47 * 60 * 60 * 1000;
      if (loginPayload.expiration) {
        const expMs = Date.parse(loginPayload.expiration);
        if (Number.isFinite(expMs)) {
          const remaining = expMs - Date.now() - 5 * 60 * 1000;
          if (remaining > 60_000) ttlMs = remaining;
        }
      }
      this.sessionTokenCache.set('appeears-hls-session', loginPayload.token, ttlMs);
      return loginPayload.token;
    }

    if (this.earthdataToken) {
      return this.earthdataToken;
    }

    throw new ConfigurationError(
      'NASA AppEEARS authentication is not configured for HLS. Set NASA_APPEEARS_TOKEN or NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD.',
      {
        providerId: this.providerId,
        requiredVariables: ['NASA_APPEEARS_TOKEN', 'NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD'],
      },
    );
  }

  private async executeHttpWithRetry(
    url: string,
    init: RequestInit,
    serviceLabel: string,
    allowRedirect303 = false,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          ...init,
          headers: {
            'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
            ...(init.headers as Record<string, string> | undefined),
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (allowRedirect303 && response.status === 303) {
          return response;
        }

        if (response.status === 410) {
          throw new JobExpiredError(
            `${serviceLabel} reports that the requested HLS task has expired.`,
            { upstreamStatus: 410 },
          );
        }

        if (response.status === 401 || response.status === 403) {
          const errText = await response.text().catch(() => '');
          throw new ExternalServiceError(
            `${serviceLabel} rejected authentication (HTTP ${response.status}).`,
            {
              upstreamStatus: response.status,
              upstreamMessage: errText.slice(0, 300) || undefined,
            },
          );
        }

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.retryDelayMs * (attempt + 1));
            continue;
          }
          const errText = await response.text().catch(() => '');
          throw new ExternalServiceError(`${serviceLabel} returned HTTP ${response.status}.`, {
            upstreamStatus: response.status,
            upstreamMessage: errText.slice(0, 300) || undefined,
          });
        }

        return response;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;

        if (error instanceof ExternalServiceError || error instanceof JobExpiredError) {
          throw error;
        }

        const isAbort =
          error instanceof Error &&
          (error.name === 'AbortError' || error.message.includes('aborted'));

        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw new ExternalServiceError(
          isAbort
            ? `${serviceLabel} timed out after ${this.timeoutMs}ms.`
            : `Failed to connect to ${serviceLabel}.`,
          {
            reason: error instanceof Error ? error.message : 'Unknown network error',
            attempts: attempt + 1,
          },
        );
      }
    }

    throw new ExternalServiceError(`${serviceLabel} request failed.`, {
      reason: lastError instanceof Error ? lastError.message : 'Unknown error',
    });
  }

  public buildAppeearsTaskPayload(input: HlsProviderSubmitInput): Record<string, unknown> {
    const startDate = formatAppeearsDate(input.dateRange.startDate);
    const endDate = formatAppeearsDate(input.dateRange.endDate);

    if (input.taskType === 'area') {
      const polygon: GeoJsonPolygon | undefined =
        input.geometry ?? (input.bbox ? bboxToGeoJsonPolygon(input.bbox) : undefined);

      if (!polygon) {
        throw new ConfigurationError('Cannot construct AppEEARS area task without GeoJSON Polygon or BBox.');
      }

      return {
        task_type: 'area',
        task_name: input.taskName,
        params: {
          dates: [{ startDate, endDate }],
          layers: input.layers.map((pair) => ({
            product: pair.product,
            layer: pair.layer,
          })),
          geo: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: input.boundaryContext?.id ?? 'farm-parcel',
                properties: {
                  name: input.boundaryContext?.name ?? 'Selected Farm Boundary',
                  areaHectares: input.boundaryContext?.areaHectares ?? 0,
                },
                geometry: polygon,
              },
            ],
          },
          output: {
            format: { type: 'geotiff' },
            projection: 'geographic',
          },
        },
      };
    }

    return {
      task_type: 'point',
      task_name: input.taskName,
      params: {
        dates: [{ startDate, endDate }],
        layers: input.layers.map((pair) => ({
          product: pair.product,
          layer: pair.layer,
        })),
        coordinates: [
          {
            id: input.boundaryContext?.id ?? 'farm-point',
            category: input.boundaryContext?.name ?? 'Selected Farm Location',
            latitude: input.location.latitude,
            longitude: input.location.longitude,
          },
        ],
      },
    };
  }

  async submitJob(input: HlsProviderSubmitInput): Promise<HlsJobSubmissionReceipt> {
    const token = await this.resolveBearerToken();
    const payload = this.buildAppeearsTaskPayload(input);

    const response = await this.executeHttpWithRetry(
      `${this.appeearsBaseUrl}/task`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      },
      'NASA AppEEARS HLS Task Submit',
    );

    const data = (await response.json()) as AppeearsTaskResponse;
    if (!data.task_id) {
      throw new ExternalServiceError('NASA AppEEARS /task submission response did not return a task_id.');
    }

    const submittedAt = data.created ?? new Date().toISOString();
    const upstreamStatus = data.status ?? 'pending';

    return {
      upstreamTaskId: data.task_id,
      upstreamStatus,
      status: mapAppeearsStatus(upstreamStatus),
      submittedAt,
      expiresAt: data.expires_on,
    };
  }

  async pollJobStatus(upstreamTaskId: string): Promise<HlsUpstreamTaskStatus> {
    const token = await this.resolveBearerToken();

    const response = await this.executeHttpWithRetry(
      `${this.appeearsBaseUrl}/task/${encodeURIComponent(upstreamTaskId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      'NASA AppEEARS HLS Task Status',
      true,
    );

    if (response.status === 303) {
      const bundleFiles = await this.fetchBundleManifest(upstreamTaskId, token);
      return {
        upstreamTaskId,
        upstreamStatus: 'done',
        status: 'completed',
        updatedAt: new Date().toISOString(),
        progressPercent: 100,
        bundleFiles,
      };
    }

    const taskData = (await response.json()) as AppeearsTaskResponse;
    const upstreamStatus = taskData.status ?? 'pending';
    const mappedStatus = mapAppeearsStatus(upstreamStatus);
    const expiresAt = taskData.expires_on;

    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return {
        upstreamTaskId,
        upstreamStatus: 'expired',
        status: 'expired',
        updatedAt: new Date().toISOString(),
        expiresAt,
        errorMessage: 'Upstream AppEEARS bundle expired before retrieval.',
      };
    }

    let bundleFiles: HlsBundleFileDescriptor[] | undefined;
    if (mappedStatus === 'completed') {
      bundleFiles = await this.fetchBundleManifest(upstreamTaskId, token);
    }

    return {
      upstreamTaskId,
      upstreamStatus,
      status: mappedStatus,
      updatedAt: taskData.updated ?? new Date().toISOString(),
      expiresAt,
      progressPercent:
        taskData.progress?.summary ??
        (mappedStatus === 'completed' ? 100 : mappedStatus === 'processing' ? 50 : 0),
      errorMessage: taskData.error ?? taskData.message,
      bundleFiles,
    };
  }

  private async fetchBundleManifest(
    upstreamTaskId: string,
    token: string,
  ): Promise<HlsBundleFileDescriptor[]> {
    const response = await this.executeHttpWithRetry(
      `${this.appeearsBaseUrl}/bundle/${encodeURIComponent(upstreamTaskId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      'NASA AppEEARS HLS Bundle Manifest',
    );

    const bundle = (await response.json()) as AppeearsBundleResponse;
    return (bundle.files ?? [])
      .filter((f) => Boolean(f.file_id && f.file_name))
      .map((f) => ({
        fileId: f.file_id!,
        fileName: f.file_name!,
        fileSizeBytes: f.file_size ?? 0,
        fileType: (f.file_type ?? f.file_name!.split('.').pop() ?? 'unknown').toLowerCase(),
        ...(f.sha256 ? { sha256: f.sha256 } : {}),
      }));
  }

  async fetchJobResults(job: HlsJobRecord): Promise<HlsResultPayload> {
    const cacheKey = `hls:${job.upstreamTaskId}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        sourceAttribution: {
          ...cached.sourceAttribution,
          cached: true,
        },
      };
    }

    const token = await this.resolveBearerToken();
    const bundleFiles =
      job.bundleFiles && job.bundleFiles.length > 0
        ? job.bundleFiles
        : await this.fetchBundleManifest(job.upstreamTaskId, token);

    const nowMs = this.nowFn();
    const retrievedAt = new Date(nowMs).toISOString();
    const polygon: GeoJsonPolygon | undefined =
      job.boundaryContext?.geometry ??
      (job.boundaryContext?.bbox ? bboxToGeoJsonPolygon(job.boundaryContext.bbox) : undefined);

    const observationsByKey = new Map<string, HlsSurfaceReflectanceObservation>();

    const csvFiles = bundleFiles.filter((f) => f.fileType === 'csv');
    const rasterEntries: Array<{
      file: HlsBundleFileDescriptor;
      meta: ParsedHlsRasterFileMeta;
    }> = [];

    for (const file of bundleFiles) {
      const isTiff =
        file.fileType === 'tif' || file.fileType === 'tiff' || /\.tiff?$/i.test(file.fileName);
      if (!isTiff) continue;
      const meta = parseAppeearsHlsFilename(file.fileName);
      if (meta) {
        rasterEntries.push({ file, meta });
      }
    }

    if (rasterEntries.length > 0) {
      await this.extractGeoTiffRasterObservations({
        job,
        token,
        rasterEntries,
        polygon,
        retrievedAt,
        targetMap: observationsByKey,
      });
    }

    for (const file of csvFiles) {
      const fileResponse = await this.executeHttpWithRetry(
        `${this.appeearsBaseUrl}/bundle/${encodeURIComponent(job.upstreamTaskId)}/${encodeURIComponent(file.fileId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/csv, text/plain, */*',
          },
        },
        'NASA AppEEARS Bundle File Download',
      );
      const csvText = await fileResponse.text();
      this.parseCsvIntoObservations(
        csvText,
        file.fileName,
        job.taskType === 'area' ? 'polygon_area_stats' : 'point',
        retrievedAt,
        observationsByKey,
      );
    }

    const observations = Array.from(observationsByKey.values()).sort((a, b) =>
      a.observationTimestamp.localeCompare(b.observationTimestamp),
    );

    for (const obs of observations) {
      this.finalizeObservationQuality(obs, nowMs);
    }

    const clearObs = observations.filter((o) => o.qualityFiltered);
    const cloudMasked = observations.filter((o) => o.qualityStatus === 'cloud_masked').length;
    const shadowMasked = observations.filter((o) => o.qualityStatus === 'shadow_masked').length;
    const waterMasked = observations.filter((o) => o.qualityStatus === 'water_masked').length;
    const invalidOrMissing = observations.filter(
      (o) => o.qualityStatus === 'invalid_data' || o.qualityStatus === 'missing_data',
    ).length;
    const staleCount = observations.filter((o) => o.isStale).length;

    const validRed = clearObs.map((o) => o.redReflectance).filter((v): v is number => v !== null);
    const validNir = clearObs.map((o) => o.nirReflectance).filter((v): v is number => v !== null);
    const validNdvi = clearObs.map((o) => o.ndvi).filter((v): v is number => v !== null);
    const validNdwi = clearObs.map((o) => o.ndwi).filter((v): v is number => v !== null);

    const summary: HlsResultSummary = {
      totalObservations: observations.length,
      clearSkyObservations: clearObs.length,
      cloudMaskedObservations: cloudMasked,
      shadowMaskedObservations: shadowMasked,
      waterMaskedObservations: waterMasked,
      invalidOrMissingObservations: invalidOrMissing,
      staleObservations: staleCount,
      meanCoveragePercent: averageOrNull(observations.map((o) => o.coveragePercent)),
      meanRedReflectance: averageOrNull(validRed),
      meanNirReflectance: averageOrNull(validNir),
      meanNdvi: averageOrNull(validNdvi),
      minNdvi: validNdvi.length > 0 ? Math.min(...validNdvi) : null,
      maxNdvi: validNdvi.length > 0 ? Math.max(...validNdvi) : null,
      meanNdwi: averageOrNull(validNdwi),
      latestNdvi: validNdvi.length > 0 ? validNdvi[validNdvi.length - 1] : null,
      latestNdwi: validNdwi.length > 0 ? validNdwi[validNdwi.length - 1] : null,
    };

    const caveats = [
      'NASA Harmonized Landsat Sentinel-2 (HLS) surface reflectance data (HLSL30.002 / HLSS30.002) provide 30 m resolution multispectral observations.',
      'Surface reflectance values are scaled by 0.0001 per official LP DAAC specifications.',
      'Cloud and cloud shadow pixels identified via Fmask are masked out from clear-sky summaries.',
      'NDVI is calculated as (NIR - Red) / (NIR + Red) and NDWI as (Green - NIR) / (Green + NIR) or (NIR - SWIR) / (NIR + SWIR) strictly from unmasked clear pixels.',
    ];

    const result: HlsResultPayload = {
      jobId: job.jobId,
      upstreamTaskId: job.upstreamTaskId,
      status: 'completed',
      dataClassification: 'satellite_derived_surface_reflectance',
      taskType: job.taskType,
      products: job.products,
      dateRange: job.dateRange,
      location: job.location,
      boundaryContext: job.boundaryContext,
      spatialProcessing: job.spatialProcessing,
      spatialResolution: {
        value: 30,
        unit: 'm',
        label: '30 m × 30 m (Modified MGRS UTM Tile)',
      },
      units: {
        reflectance: 'Reflectance Ratio (0–1)',
        indices: 'Index Ratio (-1 to 1)',
        scaleFactor: '0.0001',
        fmask: 'Bitmask (0 = Clear, 1 = Cloud, etc.)',
      },
      summary,
      observations,
      bundleFiles,
      sourceAttribution: {
        providerId: this.providerId,
        providerName: 'NASA LP DAAC / AppEEARS',
        accessMethod: 'AppEEARS Asynchronous Subsetting API',
        daac: 'LP DAAC (Earthdata Cloud)',
        productVersions: Array.from(
          new Set(job.products.map((id) => HLS_PRODUCT_SPECS[id].version)),
        ),
        datasetNames: job.products.map((id) => `${id} (${HLS_PRODUCT_SPECS[id].title})`),
        url: 'https://appeears.earthdatacloud.nasa.gov/',
        retrievedAt,
        cached: false,
      },
      caveats,
      retrievedAt,
    };

    this.resultCache.set(cacheKey, result);
    return result;
  }

  private async extractGeoTiffRasterObservations(params: {
    job: HlsJobRecord;
    token: string;
    rasterEntries: Array<{
      file: HlsBundleFileDescriptor;
      meta: ParsedHlsRasterFileMeta;
    }>;
    polygon?: GeoJsonPolygon;
    retrievedAt: string;
    targetMap: Map<string, HlsSurfaceReflectanceObservation>;
  }): Promise<void> {
    const { job, token, rasterEntries, polygon, retrievedAt, targetMap } = params;

    type DecodedEntry = {
      meta: ParsedHlsRasterFileMeta;
      grid?: ParsedGeoTiffGrid;
      error?: string;
    };

    const decodedByObsKey = new Map<string, DecodedEntry[]>();
    const gridsByLayerKey = new Map<string, ParsedGeoTiffGrid>();
    const fmaskByObsKey = new Map<string, ParsedGeoTiffGrid>();
    const fmaskByTimestamp = new Map<string, ParsedGeoTiffGrid>();

    for (const entry of rasterEntries) {
      const obsKey = `${entry.meta.observationTimestamp}::${entry.meta.productId}`;
      const list = decodedByObsKey.get(obsKey) ?? [];

      try {
        const resp = await this.executeHttpWithRetry(
          `${this.appeearsBaseUrl}/bundle/${encodeURIComponent(job.upstreamTaskId)}/${encodeURIComponent(entry.file.fileId)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'image/tiff, application/octet-stream, */*',
            },
          },
          'NASA AppEEARS HLS GeoTIFF Download',
        );
        const buf = Buffer.from(await resp.arrayBuffer());
        const grid = parseGeoTiffGrid(buf);
        list.push({ meta: entry.meta, grid });
        gridsByLayerKey.set(`${obsKey}::${entry.meta.layer}`, grid);

        if (entry.meta.layer === 'Fmask') {
          fmaskByObsKey.set(obsKey, grid);
          fmaskByTimestamp.set(entry.meta.observationTimestamp, grid);
        }
      } catch (error) {
        if (error instanceof JobExpiredError) throw error;
        list.push({
          meta: entry.meta,
          error: error instanceof Error ? error.message : 'Failed to decode HLS GeoTIFF.',
        });
      }

      decodedByObsKey.set(obsKey, list);
    }

    for (const [obsKey, entries] of decodedByObsKey.entries()) {
      const sampleMeta = entries[0].meta;
      const obs: HlsSurfaceReflectanceObservation = {
        observationTimestamp: sampleMeta.observationTimestamp,
        retrievalTimestamp: retrievedAt,
        productId: sampleMeta.productId,
        productVersion: '002',
        spatialResolutionMeters: 30,
        spatialAggregation: 'polygon_raster_pixels',
        intersectingPixelCount: null,
        validPixelCount: null,
        coveragePercent: null,
        greenReflectance: null,
        redReflectance: null,
        nirReflectance: null,
        swir1Reflectance: null,
        ndvi: null,
        ndwi: null,
        cloudMaskFlag: null,
        shadowMaskFlag: null,
        waterMaskFlag: null,
        qualityFiltered: false,
        qualityStatus: 'missing_data',
        isStale: false,
        parameterUnits: {},
        provenance: {
          providerId: this.providerId,
          daac: 'LP DAAC',
          productId: sampleMeta.productId,
          productVersion: '002',
          accessMethod: 'AppEEARS Asynchronous Subsetting API',
        },
      };

      const fmaskGrid = fmaskByObsKey.get(obsKey) ?? fmaskByTimestamp.get(sampleMeta.observationTimestamp);

      let maxIntersecting = 0;
      let maxValid = 0;

      // Process individual band rasters first
      for (const item of entries) {
        const layer = item.meta.layer;
        if (item.error || !item.grid || layer === 'Fmask') continue;

        const intersecting = getIntersectingPixelIndices(item.grid, polygon);
        const spec = HLS_PRODUCT_SPECS[sampleMeta.productId];
        const layerSpec = spec.layers.find((l) => l.layer === layer);
        const scale = layerSpec?.scaleFactor ?? 0.0001;
        const unit = layerSpec?.units ?? 'unknown';

        const validSamples: number[] = [];
        for (const idx of intersecting) {
          if (fmaskGrid && fmaskGrid.values[idx] !== undefined) {
            const fmaskVal = fmaskGrid.values[idx];
            if (isFmaskCloudOrShadow(fmaskVal) || isFmaskWater(fmaskVal)) {
              continue;
            }
          }
          const raw = item.grid.values[idx];
          if (isValidHlsPhysicalValue(layer, raw)) {
            validSamples.push(raw * scale);
          }
        }

        const stats: HlsPolygonStats = {
          mean: averageOrNull(validSamples),
          min: validSamples.length > 0 ? Math.min(...validSamples) : null,
          max: validSamples.length > 0 ? Math.max(...validSamples) : null,
          stdDev: null,
          pixelCount: validSamples.length,
          validPixelCount: validSamples.length,
          intersectingPixelCount: intersecting.length,
          coveragePercent: intersecting.length > 0 ? Number(((validSamples.length / intersecting.length) * 100).toFixed(2)) : 0,
          unit,
        };

        maxIntersecting = Math.max(maxIntersecting, intersecting.length);
        maxValid = Math.max(maxValid, validSamples.length);
        assignLayerValueToObservation(obs, layer, stats.mean, stats);
      }

      // Compute pixel-by-pixel NDVI and NDWI across intersecting clear pixels
      const b03Grid = gridsByLayerKey.get(`${obsKey}::B03`);
      const b04Grid = gridsByLayerKey.get(`${obsKey}::B04`);
      const b05Grid = gridsByLayerKey.get(`${obsKey}::B05`);
      const b8aGrid = gridsByLayerKey.get(`${obsKey}::B8A`);
      const b08Grid = gridsByLayerKey.get(`${obsKey}::B08`);
      const b11Grid = gridsByLayerKey.get(`${obsKey}::B11`);

      const referenceGrid = b04Grid ?? b05Grid ?? b8aGrid ?? b08Grid;
      if (referenceGrid) {
        const intersecting = getIntersectingPixelIndices(referenceGrid, polygon);
        if (fmaskGrid) {
          let cloudyCount = 0;
          let shadowCount = 0;
          let waterCount = 0;
          for (const idx of intersecting) {
            const v = fmaskGrid.values[idx];
            if (Number.isFinite(v)) {
              if ((v & 0x01) !== 0 || (v & 0x02) !== 0) cloudyCount += 1;
              else if ((v & 0x04) !== 0) shadowCount += 1;
              else if ((v & 0x20) !== 0) waterCount += 1;
            }
          }
          if (maxValid === 0 && cloudyCount > 0) {
            obs.cloudMaskFlag = 1;
          } else if (fmaskGrid) {
            obs.cloudMaskFlag = 0;
          }

          if (maxValid === 0 && shadowCount > 0) {
            obs.shadowMaskFlag = 1;
          } else if (fmaskGrid) {
            obs.shadowMaskFlag = 0;
          }

          if (maxValid === 0 && waterCount > 0) {
            obs.waterMaskFlag = 1;
          } else if (fmaskGrid) {
            obs.waterMaskFlag = 0;
          }

          if (cloudyCount > 0 || shadowCount > 0 || waterCount > 0) {
            obs.qualityNotes = [
              ...(obs.qualityNotes ?? []),
              `Fmask: ${cloudyCount} cloudy, ${shadowCount} shadow, and ${waterCount} water pixels filtered out from parcel statistics.`,
            ];
          }
        }

        const ndviSamples: number[] = [];
        const ndwiSamples: number[] = [];

        for (const idx of intersecting) {
          if (fmaskGrid && fmaskGrid.values[idx] !== undefined) {
            const fmaskVal = fmaskGrid.values[idx];
            if (isFmaskCloudOrShadow(fmaskVal) || isFmaskWater(fmaskVal)) continue;
          }

          const redRaw = b04Grid?.values[idx];
          const nirRaw = b05Grid?.values[idx] ?? b8aGrid?.values[idx] ?? b08Grid?.values[idx];
          const greenRaw = b03Grid?.values[idx];
          const swir1Raw = b11Grid?.values[idx];

          if (redRaw !== undefined && nirRaw !== undefined) {
            const red = parseFiniteNumber(String(redRaw));
            const nir = parseFiniteNumber(String(nirRaw));
            if (red !== null && nir !== null && isValidHlsPhysicalValue('B04', red) && isValidHlsPhysicalValue('B05', nir)) {
              const rScaled = red * 0.0001;
              const nScaled = nir * 0.0001;
              const denom = nScaled + rScaled;
              if (denom !== 0) {
                const ndviVal = (nScaled - rScaled) / denom;
                if (Number.isFinite(ndviVal) && ndviVal >= -1 && ndviVal <= 1) {
                  ndviSamples.push(ndviVal);
                }
              }
            }
          }

          if (greenRaw !== undefined && nirRaw !== undefined) {
            const green = parseFiniteNumber(String(greenRaw));
            const nir = parseFiniteNumber(String(nirRaw));
            if (green !== null && nir !== null && isValidHlsPhysicalValue('B03', green) && isValidHlsPhysicalValue('B05', nir)) {
              const gScaled = green * 0.0001;
              const nScaled = nir * 0.0001;
              const denom = gScaled + nScaled;
              if (denom !== 0) {
                const ndwiVal = (gScaled - nScaled) / denom;
                if (Number.isFinite(ndwiVal) && ndwiVal >= -1 && ndwiVal <= 1) {
                  ndwiSamples.push(ndwiVal);
                }
              }
            }
          } else if (nirRaw !== undefined && swir1Raw !== undefined) {
            const nir = parseFiniteNumber(String(nirRaw));
            const swir = parseFiniteNumber(String(swir1Raw));
            if (nir !== null && swir !== null) {
              const nScaled = nir * 0.0001;
              const sScaled = swir * 0.0001;
              const denom = nScaled + sScaled;
              if (denom !== 0) {
                const ndwiVal = (nScaled - sScaled) / denom;
                if (Number.isFinite(ndwiVal) && ndwiVal >= -1 && ndwiVal <= 1) {
                  ndwiSamples.push(ndwiVal);
                }
              }
            }
          }
        }

        if (ndviSamples.length > 0) {
          const meanNdvi = averageOrNull(ndviSamples);
          obs.ndvi = meanNdvi;
          obs.parameterUnits['NDVI'] = 'Index Ratio (-1 to 1)';
          obs.layerStats = {
            ...(obs.layerStats ?? {}),
            NDVI: {
              mean: meanNdvi,
              min: Math.min(...ndviSamples),
              max: Math.max(...ndviSamples),
              stdDev: null,
              pixelCount: ndviSamples.length,
              validPixelCount: ndviSamples.length,
              intersectingPixelCount: intersecting.length,
              coveragePercent: intersecting.length > 0 ? Number(((ndviSamples.length / intersecting.length) * 100).toFixed(2)) : 0,
              unit: 'Index Ratio (-1 to 1)',
            },
          };
        }

        if (ndwiSamples.length > 0) {
          const meanNdwi = averageOrNull(ndwiSamples);
          obs.ndwi = meanNdwi;
          obs.parameterUnits['NDWI'] = 'Index Ratio (-1 to 1)';
          obs.layerStats = {
            ...(obs.layerStats ?? {}),
            NDWI: {
              mean: meanNdwi,
              min: Math.min(...ndwiSamples),
              max: Math.max(...ndwiSamples),
              stdDev: null,
              pixelCount: ndwiSamples.length,
              validPixelCount: ndwiSamples.length,
              intersectingPixelCount: intersecting.length,
              coveragePercent: intersecting.length > 0 ? Number(((ndwiSamples.length / intersecting.length) * 100).toFixed(2)) : 0,
              unit: 'Index Ratio (-1 to 1)',
            },
          };
        }
      }

      obs.intersectingPixelCount = maxIntersecting;
      obs.validPixelCount = maxValid;
      obs.coveragePercent = maxIntersecting > 0 ? Number(((maxValid / maxIntersecting) * 100).toFixed(2)) : 0;

      targetMap.set(obsKey, obs);
    }
  }

  private finalizeObservationQuality(obs: HlsSurfaceReflectanceObservation, nowMs: number): void {
    const obsMs = Date.parse(obs.observationTimestamp);
    const maxAgeMs = this.staleMaxAgeDays * 86_400_000;
    const isFuture = Number.isFinite(obsMs) && obsMs > nowMs + 5 * 60_000;
    const isTooOld = !Number.isFinite(obsMs) || nowMs - obsMs > maxAgeMs;
    obs.isStale = isFuture || isTooOld;

    const hasData = hasAnyValidReflectance(obs);
    let status: HlsObservationQualityStatus;

    if (obs.cloudMaskFlag === 1) {
      status = 'cloud_masked';
      obs.qualityFiltered = false;
    } else if (obs.shadowMaskFlag === 1) {
      status = 'shadow_masked';
      obs.qualityFiltered = false;
    } else if (obs.waterMaskFlag === 1) {
      status = 'water_masked';
      obs.qualityFiltered = false;
    } else if (!hasData) {
      status = (obs.intersectingPixelCount ?? 0) > 0 ? 'invalid_data' : 'missing_data';
      obs.qualityFiltered = false;
    } else {
      obs.qualityFiltered = true;
      status = obs.isStale ? 'stale' : 'valid';
    }

    obs.qualityStatus = status;
  }

  private parseCsvIntoObservations(
    csvText: string,
    fileName: string,
    aggregation: 'polygon_area_stats' | 'point',
    retrievedAt: string,
    targetMap: Map<string, HlsSurfaceReflectanceObservation>,
  ): void {
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) return;

    const headers = parseCsvLine(lines[0]);
    const headerIdx = new Map<string, number>();
    headers.forEach((h, idx) => headerIdx.set(h, idx));

    const dateCol = headerIdx.get('Date') ?? headerIdx.get('date');
    if (dateCol === undefined) return;

    const fallbackProduct = inferProductFromFilename(fileName) ?? 'HLSL30.002';
    const datasetCol = headerIdx.get('Dataset') ?? headerIdx.get('Layer');
    const meanCol = headerIdx.get('Mean');

    if (datasetCol !== undefined && meanCol !== undefined) {
      for (let r = 1; r < lines.length; r++) {
        const cols = parseCsvLine(lines[r]);
        const timestamp = cols[dateCol];
        const rawDataset = cols[datasetCol];
        if (!timestamp || !rawDataset) continue;

        const layerMatch = rawDataset.match(/(B03|B04|B05|B8A|B08|B11|B12|Fmask)$/);
        const layerName = (layerMatch ? layerMatch[1] : rawDataset) as HlsLayerId;
        const productId: HlsProductId = rawDataset.includes('HLSS30')
          ? 'HLSS30.002'
          : rawDataset.includes('HLSL30')
            ? 'HLSL30.002'
            : fallbackProduct;

        const obsKey = `${timestamp}::${productId}`;
        const existing =
          targetMap.get(obsKey) ??
          this.createEmptyObservation(timestamp, productId, aggregation, retrievedAt);

        const rawMean = parseFiniteNumber(cols[meanCol]);
        const scale = HLS_PRODUCT_SPECS[productId].layers.find((l) => l.layer === layerName)?.scaleFactor ?? 0.0001;
        const scaledVal = rawMean !== null ? rawMean * scale : null;

        assignLayerValueToObservation(existing, layerName, scaledVal);
        targetMap.set(obsKey, existing);
      }
    }
  }

  private createEmptyObservation(
    observationTimestamp: string,
    productId: HlsProductId,
    spatialAggregation: 'polygon_raster_pixels' | 'polygon_area_stats' | 'point',
    retrievalTimestamp: string,
  ): HlsSurfaceReflectanceObservation {
    return {
      observationTimestamp,
      retrievalTimestamp,
      productId,
      productVersion: '002',
      spatialResolutionMeters: 30,
      spatialAggregation,
      intersectingPixelCount: null,
      validPixelCount: null,
      coveragePercent: null,
      greenReflectance: null,
      redReflectance: null,
      nirReflectance: null,
      swir1Reflectance: null,
      ndvi: null,
      ndwi: null,
      cloudMaskFlag: null,
      shadowMaskFlag: null,
      waterMaskFlag: null,
      qualityFiltered: false,
      qualityStatus: 'missing_data',
      isStale: false,
      parameterUnits: {},
      provenance: {
        providerId: this.providerId,
        daac: 'LP DAAC',
        productId,
        productVersion: '002',
        accessMethod: 'AppEEARS Asynchronous Subsetting API',
      },
    };
  }
}
