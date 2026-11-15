import type {
  EcostressBundleFileDescriptor,
  EcostressEvapotranspirationObservation,
  EcostressJobRecord,
  EcostressJobStatus,
  EcostressLayerId,
  EcostressObservationQualityStatus,
  EcostressPolygonStats,
  EcostressProductId,
  EcostressProductSpecification,
  EcostressResultPayload,
  EcostressResultSummary,
  GeoJsonPolygon,
} from '../../../shared/index.ts';
import { env } from '../../config/env.ts';
import {
  ConfigurationError,
  ExternalServiceError,
  JobExpiredError,
} from '../../errors/AppError.ts';
import {
  computePolygonLayerStatistics,
  getEcostressLayerUnit,
  getIntersectingPixelIndices,
  isValidPhysicalLayerValue,
  parseAppeearsEcostressFilename,
  parseGeoTiffGrid,
  type ParsedEcostressRasterFileMeta,
  type ParsedGeoTiffGrid,
} from '../../utils/ecostressGeoTiff.ts';
import type { FetchLike } from '../../utils/resilientHttp.ts';
import { TtlCache } from '../../utils/ttlCache.ts';
import {
  ECOSTRESS_PRODUCT_SPECS,
  bboxToGeoJsonPolygon,
} from './ecostressProducts.ts';
import type {
  EcostressJobSubmissionReceipt,
  EcostressProviderAuthStatus,
  EcostressProviderSubmitInput,
  EcostressUpstreamTaskStatus,
  IEcostressProvider,
} from './IEcostressProvider.ts';

export interface EcostressAppEearsProviderOptions {
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

function mapAppeearsStatus(rawStatus: string | undefined): EcostressJobStatus {
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

function parseMaskFlag(raw: string | undefined): 0 | 1 | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed === 'null') return null;
  const num = Number(trimmed);
  if (num === 0) return 0;
  if (num === 1) return 1;
  return null;
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

function inferProductFromLayer(layerName: string): EcostressProductId {
  if (layerName === 'ESI' || layerName === 'PET') {
    return 'ECO_L4T_ESI.002';
  }
  return 'ECO_L3T_JET.002';
}

function inferProductFromFilename(fileName: string): EcostressProductId | null {
  if (fileName.includes('ECO_L4T_ESI')) return 'ECO_L4T_ESI.002';
  if (fileName.includes('ECO_L3T_JET')) return 'ECO_L3T_JET.002';
  return null;
}

function assignLayerValueToObservation(
  obs: EcostressEvapotranspirationObservation,
  layer: string,
  val: number | null,
  stats?: EcostressPolygonStats,
): void {
  const normalizedLayer = layer.trim() as EcostressLayerId;
  obs.parameterUnits[normalizedLayer] = getEcostressLayerUnit(obs.productId, normalizedLayer);

  if (stats) {
    obs.layerStats = {
      ...(obs.layerStats ?? {}),
      [normalizedLayer]: stats,
    };
  }

  switch (normalizedLayer) {
    case 'ETdaily':
      obs.etDailyWm2 = val;
      break;
    case 'ETinstUncertainty':
      obs.etInstUncertaintyWm2 = val;
      break;
    case 'PTJPLSMinst':
      obs.ptjplsmInstWm2 = val;
      break;
    case 'STICinst':
      obs.sticInstWm2 = val;
      break;
    case 'MOD16inst':
      obs.mod16InstWm2 = val;
      break;
    case 'BESSinst':
      obs.bessInstWm2 = val;
      break;
    case 'PTJPLSMcanopy':
      obs.canopyTranspirationRatio = val;
      break;
    case 'PTJPLSMsoil':
      obs.soilEvaporationRatio = val;
      break;
    case 'PTJPLSMinterception':
      obs.interceptionRatio = val;
      break;
    case 'STICcanopy':
      obs.sticCanopyRatio = val;
      break;
    case 'ESI':
      obs.esiRatio = val;
      break;
    case 'PET':
      obs.petWm2 = val;
      break;
    case 'cloud':
      obs.cloudMaskFlag = val === 0 ? 0 : val === 1 ? 1 : null;
      break;
    case 'water':
      obs.waterMaskFlag = val === 0 ? 0 : val === 1 ? 1 : null;
      break;
    default:
      break;
  }
}

function hasAnyValidDataMetric(obs: EcostressEvapotranspirationObservation): boolean {
  return (
    obs.etDailyWm2 !== null ||
    obs.etInstUncertaintyWm2 !== null ||
    obs.ptjplsmInstWm2 !== null ||
    obs.sticInstWm2 !== null ||
    obs.mod16InstWm2 !== null ||
    obs.bessInstWm2 !== null ||
    obs.canopyTranspirationRatio !== null ||
    obs.soilEvaporationRatio !== null ||
    obs.interceptionRatio !== null ||
    obs.sticCanopyRatio !== null ||
    obs.esiRatio !== null ||
    obs.petWm2 !== null
  );
}

export class EcostressAppEearsProvider implements IEcostressProvider {
  public readonly providerId = 'nasa-ecostress-appeears';
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
  private readonly resultCache: TtlCache<EcostressResultPayload>;

  constructor(options: EcostressAppEearsProviderOptions = {}) {
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
    this.resultCache = new TtlCache<EcostressResultPayload>(cacheTtlMs, 100);
  }

  getVerifiedProducts(): EcostressProductSpecification[] {
    return [
      ECOSTRESS_PRODUCT_SPECS['ECO_L3T_JET.002'],
      ECOSTRESS_PRODUCT_SPECS['ECO_L4T_ESI.002'],
    ];
  }

  getAuthStatus(): EcostressProviderAuthStatus {
    const hasAppeearsToken = Boolean(this.appeearsToken);
    const hasEarthdataCredentials = Boolean(this.earthdataUsername && this.earthdataPassword);
    const hasEarthdataToken = Boolean(this.earthdataToken);

    const authMode: EcostressProviderAuthStatus['authMode'] = hasAppeearsToken
      ? 'appeears_token'
      : hasEarthdataCredentials
        ? 'earthdata_credentials'
        : hasEarthdataToken
          ? 'earthdata_token_fallback'
          : 'unconfigured';

    const notes: string[] = [
      'NASA AppEEARS supports asynchronous point and area (GeoJSON Polygon) subsetting for ECO_L3T_JET.002 and ECO_L4T_ESI.002.',
    ];

    if (authMode === 'unconfigured') {
      notes.push(
        'AppEEARS requires authentication via NASA_APPEEARS_TOKEN or NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD (for POST /api/login). NASA_EARTHDATA_TOKEN can also be provided as a fallback bearer token.',
      );
    } else if (authMode === 'earthdata_token_fallback') {
      notes.push(
        'Using NASA_EARTHDATA_TOKEN directly; note that AppEEARS may require a session token issued by POST /api/login using NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD if EDL bearer tokens are rejected with HTTP 401/403.',
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

    const cached = this.sessionTokenCache.get('appeears-session');
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
          if (remaining > 60_000) {
            ttlMs = remaining;
          }
        }
      }
      this.sessionTokenCache.set('appeears-session', loginPayload.token, ttlMs);
      return loginPayload.token;
    }

    if (this.earthdataToken) {
      return this.earthdataToken;
    }

    throw new ConfigurationError(
      'NASA AppEEARS authentication is not configured. Set NASA_APPEEARS_TOKEN or NASA_EARTHDATA_USERNAME and NASA_EARTHDATA_PASSWORD (or NASA_EARTHDATA_TOKEN) in environment secrets.',
      {
        providerId: this.providerId,
        requiredVariables: [
          'NASA_APPEEARS_TOKEN',
          'NASA_EARTHDATA_USERNAME + NASA_EARTHDATA_PASSWORD',
          'NASA_EARTHDATA_TOKEN',
        ],
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
            `${serviceLabel} reports that the requested ECOSTRESS task has expired and is no longer available.`,
            { upstreamStatus: 410 },
          );
        }

        if (response.status === 401 || response.status === 403) {
          const errText = await response.text().catch(() => '');
          throw new ExternalServiceError(
            `${serviceLabel} rejected authentication (HTTP ${response.status}). Verify Earthdata/AppEEARS credentials and data access approval.`,
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

  public buildAppeearsTaskPayload(input: EcostressProviderSubmitInput): Record<string, unknown> {
    const startDate = formatAppeearsDate(input.dateRange.startDate);
    const endDate = formatAppeearsDate(input.dateRange.endDate);

    if (input.taskType === 'area') {
      const polygon: GeoJsonPolygon | undefined =
        input.geometry ?? (input.bbox ? bboxToGeoJsonPolygon(input.bbox) : undefined);

      if (!polygon) {
        throw new ConfigurationError(
          'Cannot construct AppEEARS area task without GeoJSON Polygon or BoundingBox.',
        );
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
            format: {
              type: input.outputFormat === 'netcdf4' ? 'netcdf4' : 'geotiff',
            },
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

  async submitJob(input: EcostressProviderSubmitInput): Promise<EcostressJobSubmissionReceipt> {
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
      'NASA AppEEARS Task Submit',
    );

    const data = (await response.json()) as AppeearsTaskResponse;
    if (!data.task_id) {
      throw new ExternalServiceError(
        'NASA AppEEARS /task submission response did not return a task_id.',
        { upstreamResponse: data },
      );
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

  async pollJobStatus(upstreamTaskId: string): Promise<EcostressUpstreamTaskStatus> {
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
      'NASA AppEEARS Task Status',
      true,
    );

    // AppEEARS may respond 303 See Other -> bundle ready when status === 'done'
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

    let bundleFiles: EcostressBundleFileDescriptor[] | undefined;
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
  ): Promise<EcostressBundleFileDescriptor[]> {
    const response = await this.executeHttpWithRetry(
      `${this.appeearsBaseUrl}/bundle/${encodeURIComponent(upstreamTaskId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      'NASA AppEEARS Bundle Manifest',
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

  async fetchJobResults(job: EcostressJobRecord): Promise<EcostressResultPayload> {
    const cacheKey = `ecostress:${job.upstreamTaskId}`;
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

    const observationsByKey = new Map<string, EcostressEvapotranspirationObservation>();

    const csvFiles = bundleFiles.filter((f) => f.fileType === 'csv');
    const rasterEntries: Array<{
      file: EcostressBundleFileDescriptor;
      meta: ParsedEcostressRasterFileMeta;
    }> = [];

    for (const file of bundleFiles) {
      const isTiff =
        file.fileType === 'tif' ||
        file.fileType === 'tiff' ||
        /\.tiff?$/i.test(file.fileName);
      if (!isTiff) continue;
      const meta = parseAppeearsEcostressFilename(file.fileName);
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
    const waterMasked = observations.filter((o) => o.qualityStatus === 'water_masked').length;
    const invalidOrMissing = observations.filter(
      (o) => o.qualityStatus === 'invalid_data' || o.qualityStatus === 'missing_data',
    ).length;
    const staleCount = observations.filter((o) => o.isStale).length;

    const validEtDaily = clearObs
      .map((o) => o.etDailyWm2)
      .filter((v): v is number => v !== null);
    const validInstEt = clearObs
      .map((o) => o.ptjplsmInstWm2)
      .filter((v): v is number => v !== null);
    const validEsi = clearObs
      .map((o) => o.esiRatio)
      .filter((v): v is number => v !== null);
    const validPet = clearObs
      .map((o) => o.petWm2)
      .filter((v): v is number => v !== null);

    const summary: EcostressResultSummary = {
      totalObservations: observations.length,
      clearSkyObservations: clearObs.length,
      cloudMaskedObservations: cloudMasked,
      waterMaskedObservations: waterMasked,
      invalidOrMissingObservations: invalidOrMissing,
      staleObservations: staleCount,
      meanCoveragePercent: averageOrNull(observations.map((o) => o.coveragePercent)),
      // Strictly aggregate ETdaily from ETdaily layers — never convert instantaneous ET into ETdaily
      meanEtDailyWm2: averageOrNull(validEtDaily),
      latestEtDailyWm2:
        validEtDaily.length > 0 ? validEtDaily[validEtDaily.length - 1] : null,
      meanInstantaneousEtWm2: averageOrNull(validInstEt),
      meanEsiRatio: averageOrNull(validEsi),
      latestEsiRatio: validEsi.length > 0 ? validEsi[validEsi.length - 1] : null,
      meanPetWm2: averageOrNull(validPet),
    };

    const caveats = [
      'ECOSTRESS 70 m observations are satellite-derived thermal/radiative fluxes from LP DAAC Collection 2 (ECO_L3T_JET.002 / ECO_L4T_ESI.002) and represent historical ISS overpass times rather than forecasts.',
      'Instantaneous ET layers (PTJPLSMinst, STICinst, MOD16inst, BESSinst) are reported separately in W/m² and are never converted into daily ET (ETdaily) without a validated temporal upscaling method.',
      '70 m ECOSTRESS footprints reflect mixed land-surface conditions within each pixel and do not automatically isolate or verify a single selected crop species.',
      'Satellite-derived ET, PET, and ESI describe surface energy/evaporative stress fluxes and are not direct measurements of agronomic crop water requirements or irrigation volume.',
      'ECOSTRESS thermal evapotranspiration datasets do not measure or infer soil nutrients (N, P, K, pH, or organic matter).',
      'Cloud-masked (cloud = 1), water-masked (water = 1), fill (255 / NaN / -9999), and physically out-of-range pixels are excluded from polygon statistics; missing or invalid values remain null and are never substituted with zero.',
    ];

    if (observations.length === 0) {
      caveats.push(
        'No extractable ECOSTRESS GeoTIFF raster or CSV observations were found in the completed AppEEARS bundle for the requested boundary and date range.',
      );
    }
    if (staleCount > 0) {
      caveats.push(
        `${staleCount} observation(s) exceed the ${this.staleMaxAgeDays}-day freshness threshold relative to retrieval time and should be interpreted strictly as historical overpass measurements.`,
      );
    }

    const result: EcostressResultPayload = {
      jobId: job.jobId,
      upstreamTaskId: job.upstreamTaskId,
      status: 'completed',
      dataClassification: 'satellite_derived_et',
      taskType: job.taskType,
      products: job.products,
      dateRange: job.dateRange,
      location: job.location,
      boundaryContext: job.boundaryContext,
      spatialProcessing: job.spatialProcessing,
      spatialResolution: {
        value: 70,
        unit: 'm',
        label: '70 m × 70 m (Modified MGRS UTM Tile)',
      },
      units: {
        etDaily: 'W/m²',
        instantaneousEt: 'W/m²',
        etInstUncertainty: 'W/m²',
        pet: 'W/m²',
        esi: 'Ratio (0–1)',
        partitionRatios: 'Ratio (0–1)',
        cloudMask: '0 = Clear, 1 = Cloud',
        waterMask: '0 = Land, 1 = Water',
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
          new Set(job.products.map((id) => ECOSTRESS_PRODUCT_SPECS[id].version)),
        ),
        datasetNames: job.products.map((id) => `${id} (${ECOSTRESS_PRODUCT_SPECS[id].title})`),
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
    job: EcostressJobRecord;
    token: string;
    rasterEntries: Array<{
      file: EcostressBundleFileDescriptor;
      meta: ParsedEcostressRasterFileMeta;
    }>;
    polygon?: GeoJsonPolygon;
    retrievedAt: string;
    targetMap: Map<string, EcostressEvapotranspirationObservation>;
  }): Promise<void> {
    const { job, token, rasterEntries, polygon, retrievedAt, targetMap } = params;

    type DecodedEntry = {
      meta: ParsedEcostressRasterFileMeta;
      grid?: ParsedGeoTiffGrid;
      error?: string;
    };

    const decodedByObsKey = new Map<string, DecodedEntry[]>();
    const cloudByObsKey = new Map<string, ParsedGeoTiffGrid>();
    const waterByObsKey = new Map<string, ParsedGeoTiffGrid>();
    const cloudByTimestamp = new Map<string, ParsedGeoTiffGrid>();
    const waterByTimestamp = new Map<string, ParsedGeoTiffGrid>();

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
          'NASA AppEEARS GeoTIFF Download',
        );
        const buf = Buffer.from(await resp.arrayBuffer());
        const grid = parseGeoTiffGrid(buf);
        list.push({ meta: entry.meta, grid });

        if (entry.meta.layer === 'cloud') {
          cloudByObsKey.set(obsKey, grid);
          cloudByTimestamp.set(entry.meta.observationTimestamp, grid);
        } else if (entry.meta.layer === 'water') {
          waterByObsKey.set(obsKey, grid);
          waterByTimestamp.set(entry.meta.observationTimestamp, grid);
        }
      } catch (error) {
        if (error instanceof JobExpiredError) {
          throw error;
        }
        const errStatus =
          error instanceof ExternalServiceError
            ? (error.details as Record<string, unknown> | undefined)?.upstreamStatus
            : undefined;
        if (errStatus === 401 || errStatus === 403) {
          throw error;
        }
        list.push({
          meta: entry.meta,
          error: error instanceof Error ? error.message : 'Failed to decode ECOSTRESS GeoTIFF.',
        });
      }

      decodedByObsKey.set(obsKey, list);
    }

    for (const [obsKey, entries] of decodedByObsKey.entries()) {
      const sampleMeta = entries[0].meta;
      const obs = this.createEmptyObservation(
        sampleMeta.observationTimestamp,
        sampleMeta.productId,
        'polygon_raster_pixels',
        retrievedAt,
      );

      const cloudGrid =
        cloudByObsKey.get(obsKey) ?? cloudByTimestamp.get(sampleMeta.observationTimestamp);
      const waterGrid =
        waterByObsKey.get(obsKey) ?? waterByTimestamp.get(sampleMeta.observationTimestamp);

      let maxIntersecting = 0;
      let maxValid = 0;
      let totalCloudMasked = 0;
      let totalWaterMasked = 0;
      let totalInvalidPixels = 0;
      let sawDataLayer = false;

      // Process data layers first so cloud/water mask coverage is anchored to primary ET/ESI pixels
      const orderedEntries = [...entries].sort((a, b) => {
        const aIsMask = a.meta.layer === 'cloud' || a.meta.layer === 'water';
        const bIsMask = b.meta.layer === 'cloud' || b.meta.layer === 'water';
        return Number(aIsMask) - Number(bIsMask);
      });

      for (const item of orderedEntries) {
        const layer = item.meta.layer;
        if (item.error || !item.grid) {
          obs.qualityNotes = [
            ...(obs.qualityNotes ?? []),
            `Layer ${layer} raster could not be decoded: ${item.error ?? 'Unknown error'}.`,
          ];
          assignLayerValueToObservation(obs, layer, null);
          continue;
        }

        const isMask = layer === 'cloud' || layer === 'water';
        const intersecting = getIntersectingPixelIndices(item.grid, polygon);
        const stats = computePolygonLayerStatistics({
          grid: item.grid,
          intersectingIndices: intersecting,
          productId: sampleMeta.productId,
          layer,
          cloudGrid: isMask ? undefined : cloudGrid,
          waterGrid: isMask ? undefined : waterGrid,
        });

        if (!isMask) {
          sawDataLayer = true;
          if ((stats.intersectingPixelCount ?? 0) > maxIntersecting) {
            maxIntersecting = stats.intersectingPixelCount ?? 0;
          }
          if ((stats.validPixelCount ?? 0) > maxValid) {
            maxValid = stats.validPixelCount ?? 0;
          }
          totalCloudMasked = Math.max(totalCloudMasked, stats.cloudMaskedPixelCount ?? 0);
          totalWaterMasked = Math.max(totalWaterMasked, stats.waterMaskedPixelCount ?? 0);
          totalInvalidPixels = Math.max(totalInvalidPixels, stats.invalidPixelCount ?? 0);
          assignLayerValueToObservation(obs, layer, stats.mean, stats);
        } else {
          // For mask layers, derive 0|1 polygon mask state strictly without dropping 1s
          let clearCount = 0;
          let maskedCount = 0;
          for (const idx of intersecting) {
            const v = item.grid.values[idx];
            if (v === 0) clearCount += 1;
            else if (v === 1) maskedCount += 1;
          }
          if (!sawDataLayer) {
            maxIntersecting = Math.max(maxIntersecting, intersecting.length);
            maxValid = Math.max(maxValid, clearCount);
          }
          const flagVal: 0 | 1 | null =
            clearCount > 0 ? 0 : maskedCount > 0 ? 1 : null;
          if (layer === 'cloud') {
            totalCloudMasked = Math.max(totalCloudMasked, maskedCount);
          } else {
            totalWaterMasked = Math.max(totalWaterMasked, maskedCount);
          }
          assignLayerValueToObservation(obs, layer, flagVal, stats);
        }
      }

      if (sawDataLayer && maxIntersecting > 0) {
        if (maxValid === 0 && totalCloudMasked > 0) {
          obs.cloudMaskFlag = 1;
        } else if (cloudGrid && maxValid > 0) {
          obs.cloudMaskFlag = 0;
        }
        if (maxValid === 0 && totalWaterMasked > 0) {
          obs.waterMaskFlag = 1;
        } else if (waterGrid && maxValid > 0) {
          obs.waterMaskFlag = 0;
        }
      }

      obs.intersectingPixelCount = maxIntersecting;
      obs.validPixelCount = maxValid;
      obs.coveragePercent =
        maxIntersecting > 0
          ? Number(((maxValid / maxIntersecting) * 100).toFixed(2))
          : 0;

      if (maxIntersecting === 0) {
        obs.qualityNotes = [
          ...(obs.qualityNotes ?? []),
          'Selected farm polygon did not intersect any pixel footprints in this ECOSTRESS raster.',
        ];
      } else {
        if (totalCloudMasked > 0) {
          obs.qualityNotes = [
            ...(obs.qualityNotes ?? []),
            `${totalCloudMasked} of ${maxIntersecting} intersecting pixel(s) flagged as cloud (cloud = 1) were excluded from statistics.`,
          ];
        }
        if (totalWaterMasked > 0) {
          obs.qualityNotes = [
            ...(obs.qualityNotes ?? []),
            `${totalWaterMasked} of ${maxIntersecting} intersecting pixel(s) flagged as water (water = 1) were excluded from statistics.`,
          ];
        }
        if (totalInvalidPixels > 0) {
          obs.qualityNotes = [
            ...(obs.qualityNotes ?? []),
            `${totalInvalidPixels} of ${maxIntersecting} intersecting pixel(s) contained fill/NaN or out-of-range values and were excluded without substituting zero.`,
          ];
        }
      }

      targetMap.set(obsKey, obs);
    }
  }

  private finalizeObservationQuality(
    obs: EcostressEvapotranspirationObservation,
    nowMs: number,
  ): void {
    const obsMs = Date.parse(obs.observationTimestamp);
    const maxAgeMs = this.staleMaxAgeDays * 86_400_000;
    const isFuture = Number.isFinite(obsMs) && obsMs > nowMs + 5 * 60_000;
    const isTooOld = !Number.isFinite(obsMs) || nowMs - obsMs > maxAgeMs;
    obs.isStale = isFuture || isTooOld;

    const hasData = hasAnyValidDataMetric(obs);
    let status: EcostressObservationQualityStatus;

    if (obs.cloudMaskFlag === 1) {
      status = 'cloud_masked';
      obs.qualityFiltered = false;
    } else if (obs.waterMaskFlag === 1) {
      status = 'water_masked';
      obs.qualityFiltered = false;
    } else if (!hasData) {
      const hasDecodeFailure = Boolean(
        obs.qualityNotes?.some((note) => note.includes('raster could not be decoded')),
      );
      const hasCorruptOrInvalid =
        hasDecodeFailure ||
        (obs.intersectingPixelCount !== null && obs.intersectingPixelCount > 0);
      status = hasCorruptOrInvalid ? 'invalid_data' : 'missing_data';
      obs.qualityFiltered = false;
    } else {
      obs.qualityFiltered = true;
      status = obs.isStale ? 'stale' : 'valid';
    }

    obs.qualityStatus = status;

    if (obs.isStale) {
      const ageDays = Number.isFinite(obsMs)
        ? Math.max(0, Math.round((nowMs - obsMs) / 86_400_000))
        : null;
      const staleMsg = isFuture
        ? `Observation timestamp "${obs.observationTimestamp}" is in the future relative to retrieval time.`
        : ageDays !== null
          ? `Observation timestamp "${obs.observationTimestamp}" is ${ageDays} days old (exceeds ${this.staleMaxAgeDays}-day freshness threshold); historical overpass data only.`
          : `Observation timestamp "${obs.observationTimestamp}" could not be parsed as a valid date.`;
      obs.qualityNotes = [...(obs.qualityNotes ?? []), staleMsg];
    }
  }

  private parseCsvIntoObservations(
    csvText: string,
    fileName: string,
    aggregation: 'polygon_area_stats' | 'point',
    retrievedAt: string,
    targetMap: Map<string, EcostressEvapotranspirationObservation>,
  ): void {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      return;
    }

    const headers = parseCsvLine(lines[0]);
    const headerIdx = new Map<string, number>();
    headers.forEach((h, idx) => headerIdx.set(h, idx));

    const dateCol = headerIdx.get('Date') ?? headerIdx.get('date');
    if (dateCol === undefined) {
      return;
    }

    const fallbackProduct = inferProductFromFilename(fileName) ?? 'ECO_L3T_JET.002';

    // Detect Area Statistics CSV schema (File Name, Dataset, Date, Mean, Min, Max, Std Dev, Count...)
    const datasetCol = headerIdx.get('Dataset') ?? headerIdx.get('Layer');
    const meanCol = headerIdx.get('Mean');

    if (datasetCol !== undefined && meanCol !== undefined) {
      const minCol = headerIdx.get('Minimum') ?? headerIdx.get('Min');
      const maxCol = headerIdx.get('Maximum') ?? headerIdx.get('Max');
      const stdCol = headerIdx.get('Standard Deviation') ?? headerIdx.get('StdDev');
      const countCol = headerIdx.get('Count');
      const passQualityCol = headerIdx.get('Pixels Pass Quality');

      const rasterExtractedKeys = new Set(
        Array.from(targetMap.entries())
          .filter(([, o]) => o.spatialAggregation === 'polygon_raster_pixels')
          .map(([k]) => k),
      );

      for (let r = 1; r < lines.length; r++) {
        const cols = parseCsvLine(lines[r]);
        const timestamp = cols[dateCol];
        const rawDataset = cols[datasetCol];
        if (!timestamp || !rawDataset) continue;

        const layerMatch = rawDataset.match(
          /(ETdaily|ETinstUncertainty|PTJPLSMinst|STICinst|MOD16inst|BESSinst|PTJPLSMcanopy|PTJPLSMsoil|PTJPLSMinterception|STICcanopy|ESI|PET|cloud|water)$/,
        );
        const layerName = (layerMatch ? layerMatch[1] : rawDataset) as EcostressLayerId;
        const productId: EcostressProductId = rawDataset.includes('ECO_L4T_ESI')
          ? 'ECO_L4T_ESI.002'
          : rawDataset.includes('ECO_L3T_JET')
            ? 'ECO_L3T_JET.002'
            : inferProductFromLayer(layerName);

        const obsKey = `${timestamp}::${productId}`;
        if (rasterExtractedKeys.has(obsKey)) {
          continue;
        }

        const existing =
          targetMap.get(obsKey) ??
          this.createEmptyObservation(timestamp, productId, aggregation, retrievedAt);

        const rawMean = parseFiniteNumber(cols[meanCol]);
        const validMean =
          rawMean !== null && isValidPhysicalLayerValue(layerName, rawMean) ? rawMean : null;

        const countVal = countCol !== undefined ? parseFiniteNumber(cols[countCol]) : null;
        const passVal =
          passQualityCol !== undefined ? parseFiniteNumber(cols[passQualityCol]) : null;
        const validPx = passVal ?? (validMean !== null ? countVal : 0);
        const coverage =
          countVal !== null && countVal > 0 && validPx !== null
            ? Number(((validPx / countVal) * 100).toFixed(2))
            : validMean !== null
              ? 100
              : 0;

        const stats: EcostressPolygonStats = {
          mean: validMean,
          min: minCol !== undefined ? parseFiniteNumber(cols[minCol]) : null,
          max: maxCol !== undefined ? parseFiniteNumber(cols[maxCol]) : null,
          stdDev: stdCol !== undefined ? parseFiniteNumber(cols[stdCol]) : null,
          pixelCount: validPx,
          validPixelCount: validPx,
          intersectingPixelCount: countVal,
          coveragePercent: coverage,
          unit: getEcostressLayerUnit(productId, layerName),
        };

        if (countVal !== null) {
          existing.intersectingPixelCount = Math.max(
            existing.intersectingPixelCount ?? 0,
            countVal,
          );
        }
        if (validPx !== null && layerName !== 'cloud' && layerName !== 'water') {
          existing.validPixelCount = Math.max(existing.validPixelCount ?? 0, validPx);
          if (existing.intersectingPixelCount && existing.intersectingPixelCount > 0) {
            existing.coveragePercent = Number(
              ((existing.validPixelCount / existing.intersectingPixelCount) * 100).toFixed(2),
            );
          }
        }

        assignLayerValueToObservation(existing, layerName, validMean, stats);
        targetMap.set(obsKey, existing);
      }
      return;
    }

    // Point extraction CSV schema: columns named like "ECO_L3T_JET_002_ETdaily" or "ETdaily"
    const layerColumns: Array<{ idx: number; layer: EcostressLayerId }> = [];
    headers.forEach((h, idx) => {
      const m = h.match(
        /(?:ECO_L[34]T_[A-Z]+_002_)?(ETdaily|ETinstUncertainty|PTJPLSMinst|STICinst|MOD16inst|BESSinst|PTJPLSMcanopy|PTJPLSMsoil|PTJPLSMinterception|STICcanopy|ESI|PET|cloud|water)$/,
      );
      if (m) {
        layerColumns.push({ idx, layer: m[1] as EcostressLayerId });
      }
    });

    if (layerColumns.length === 0) {
      return;
    }

    for (let r = 1; r < lines.length; r++) {
      const cols = parseCsvLine(lines[r]);
      const timestamp = cols[dateCol];
      if (!timestamp) continue;

      const obsKey = `${timestamp}::${fallbackProduct}`;
      const existing =
        targetMap.get(obsKey) ??
        this.createEmptyObservation(timestamp, fallbackProduct, aggregation, retrievedAt);

      existing.intersectingPixelCount = 1;

      for (const { idx, layer } of layerColumns) {
        if (layer === 'cloud' || layer === 'water') {
          const flag = parseMaskFlag(cols[idx]);
          assignLayerValueToObservation(existing, layer, flag);
        } else {
          const val = parseFiniteNumber(cols[idx]);
          const validVal =
            val !== null && isValidPhysicalLayerValue(layer, val) ? val : null;
          assignLayerValueToObservation(existing, layer, validVal);
        }
      }

      const ptValid =
        existing.cloudMaskFlag !== 1 &&
        existing.waterMaskFlag !== 1 &&
        hasAnyValidDataMetric(existing);
      existing.validPixelCount = ptValid ? 1 : 0;
      existing.coveragePercent = ptValid ? 100 : 0;

      targetMap.set(obsKey, existing);
    }
  }

  private createEmptyObservation(
    observationTimestamp: string,
    productId: EcostressProductId,
    spatialAggregation: 'polygon_raster_pixels' | 'polygon_area_stats' | 'point',
    retrievalTimestamp: string,
  ): EcostressEvapotranspirationObservation {
    return {
      observationTimestamp,
      retrievalTimestamp,
      productId,
      productVersion: '002',
      spatialResolutionMeters: 70,
      spatialAggregation,
      intersectingPixelCount: null,
      validPixelCount: null,
      coveragePercent: null,
      etDailyWm2: null,
      etInstUncertaintyWm2: null,
      ptjplsmInstWm2: null,
      sticInstWm2: null,
      mod16InstWm2: null,
      bessInstWm2: null,
      canopyTranspirationRatio: null,
      soilEvaporationRatio: null,
      interceptionRatio: null,
      sticCanopyRatio: null,
      esiRatio: null,
      petWm2: null,
      cloudMaskFlag: null,
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
