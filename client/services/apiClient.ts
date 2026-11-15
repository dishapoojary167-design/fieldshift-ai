import {
  API_PREFIX,
  type AgroClimaticRegionsResult,
  type AiAssistantRequest,
  type AiAssistantResponse,
  type ApiErrorResponse,
  type ApiSuccessResponse,
  type BoundingBox,
  type ClimateTrendSummary,
  type ClimateTrendsQuery,
  type CropCatalogFilter,
  type CropIntelligenceRequest,
  type CropIntelligenceResult,
  type CropKnowledgeCatalogResult,
  type CropKnowledgeProfile,
  type EcostressJobRecord,
  type EcostressJobSubmissionRequest,
  type EcostressProviderCapabilitiesPayload,
  type EcostressResultPayload,
  type EnvironmentalAnalyticsRequest,
  type EnvironmentalAnalyticsResponse,
  type FarmIntelligenceRequest,
  type FarmIntelligenceResponse,
  type GeoJsonPolygon,
  type HealthCheckPayload,
  type HlsJobRecord,
  type HlsJobSubmissionRequest,
  type HlsProductId,
  type HlsProviderCapabilitiesPayload,
  type HlsResultPayload,
  type LocationContext,
  type LocationResolveRequest,
  type RotationCompareRequest,
  type RotationGenerateRequest,
  type RotationPlannerResult,
  type SoilMoistureRequest,
  type SoilMoistureSnapshot,
  type SoilProfile,
  type SoilProfileRequest,
  type SpatialProcessingMode,
  type WeatherTelemetryRequest,
  type WeatherTelemetrySnapshot,
} from '../../shared/index.ts';

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const body = (await response.json()) as ApiSuccessResponse<T> | ApiErrorResponse;

  if (!response.ok || !body.success) {
    const err = body.success
      ? { code: 'HTTP_ERROR', message: response.statusText }
      : body.error;
    throw new ApiClientError(err.message, response.status, err.code, err.details);
  }

  return body.data;
}

function isHlsResultPayload(
  payload: HlsResultPayload | HlsJobRecord,
): payload is HlsResultPayload {
  return 'observations' in payload && Array.isArray(payload.observations);
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const apiClient = {
  getHealth: (): Promise<HealthCheckPayload> => request<HealthCheckPayload>('/health'),
  resolveLocation: (payload: LocationResolveRequest): Promise<LocationContext> =>
    request<LocationContext>('/location/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getWeatherTelemetry: (payload: WeatherTelemetryRequest): Promise<WeatherTelemetrySnapshot> =>
    request<WeatherTelemetrySnapshot>('/weather/telemetry', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getClimateTrends: (query: ClimateTrendsQuery): Promise<ClimateTrendSummary> => {
    const params = new URLSearchParams({
      latitude: String(query.latitude),
      longitude: String(query.longitude),
      ...(query.years !== undefined ? { years: String(query.years) } : {}),
    });
    return request<ClimateTrendSummary>(`/weather/trends?${params.toString()}`);
  },
  getSoilProfile: (payload: SoilProfileRequest): Promise<SoilProfile> =>
    request<SoilProfile>('/soil/profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSoilMoisture: (payload: SoilMoistureRequest): Promise<SoilMoistureSnapshot> =>
    request<SoilMoistureSnapshot>('/soil/moisture', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSmapSoilMoisture: (query: {
    latitude?: number;
    longitude?: number;
    polygon?: GeoJsonPolygon;
    bbox?: BoundingBox;
    spatialProcessingMode?: SpatialProcessingMode;
    startDate?: string;
    endDate?: string;
  }): Promise<Record<string, unknown>> => {
    const params = new URLSearchParams();
    if (query.latitude !== undefined) params.set('latitude', String(query.latitude));
    if (query.longitude !== undefined) params.set('longitude', String(query.longitude));
    if (query.polygon) params.set('polygon', JSON.stringify(query.polygon));
    if (query.bbox) params.set('bbox', JSON.stringify(query.bbox));
    if (query.spatialProcessingMode) params.set('spatialProcessingMode', query.spatialProcessingMode);
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);
    return request<Record<string, unknown>>(`/soil-moisture?${params.toString()}`);
  },

  // NASA ECOSTRESS Evapotranspiration & Evaporative Stress Index (AppEEARS Async API)
  getEcostressProducts: (): Promise<EcostressProviderCapabilitiesPayload> =>
    request<EcostressProviderCapabilitiesPayload>('/evapotranspiration/products'),
  submitEcostressJob: (payload: EcostressJobSubmissionRequest): Promise<EcostressJobRecord> =>
    request<EcostressJobRecord>('/evapotranspiration/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEcostressJobStatus: (jobId: string, refresh = true): Promise<EcostressJobRecord> =>
    request<EcostressJobRecord>(
      `/evapotranspiration/jobs/${encodeURIComponent(jobId)}?refresh=${refresh ? 'true' : 'false'}`,
    ),
  getEcostressJobResults: (jobId: string): Promise<EcostressResultPayload> =>
    request<EcostressResultPayload>(
      `/evapotranspiration/jobs/${encodeURIComponent(jobId)}/results`,
    ),

  // NASA Harmonized Landsat & Sentinel-2 (HLS) Surface Reflectance / NDVI / NDWI
  getHlsProducts: (): Promise<HlsProviderCapabilitiesPayload> =>
    request<HlsProviderCapabilitiesPayload>('/vegetation/products'),
  getVegetation: (query: {
    latitude?: number;
    longitude?: number;
    polygon?: GeoJsonPolygon;
    bbox?: BoundingBox;
    spatialProcessingMode?: SpatialProcessingMode;
    startDate?: string;
    endDate?: string;
    products?: HlsProductId[];
  }): Promise<HlsResultPayload | HlsJobRecord> => {
    const params = new URLSearchParams();
    if (query.latitude !== undefined) params.set('latitude', String(query.latitude));
    if (query.longitude !== undefined) params.set('longitude', String(query.longitude));
    if (query.polygon) params.set('polygon', JSON.stringify(query.polygon));
    if (query.bbox) params.set('bbox', JSON.stringify(query.bbox));
    if (query.spatialProcessingMode) params.set('spatialProcessingMode', query.spatialProcessingMode);
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);
    if (query.products && query.products.length > 0) {
      params.set('products', query.products.join(','));
    }
    return request<HlsResultPayload | HlsJobRecord>(`/vegetation?${params.toString()}`);
  },
  submitHlsJob: (payload: HlsJobSubmissionRequest): Promise<HlsJobRecord> =>
    request<HlsJobRecord>('/vegetation/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getHlsJobStatus: (jobId: string, refresh = true): Promise<HlsJobRecord> =>
    request<HlsJobRecord>(
      `/vegetation/jobs/${encodeURIComponent(jobId)}?refresh=${refresh ? 'true' : 'false'}`,
    ),
  getHlsJobResults: (jobId: string): Promise<HlsResultPayload> =>
    request<HlsResultPayload>(`/vegetation/jobs/${encodeURIComponent(jobId)}/results`),

  fetchEcostressForFarm: async (
    payload: EcostressJobSubmissionRequest,
    options?: {
      maxPollAttempts?: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
      onJobUpdate?: (job: EcostressJobRecord) => void;
    },
  ): Promise<EcostressResultPayload> => {
    const maxAttempts = options?.maxPollAttempts ?? 12;
    const intervalMs = options?.pollIntervalMs ?? 2500;
    let job = await apiClient.submitEcostressJob(payload);
    options?.onJobUpdate?.(job);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (job.status === 'completed') {
        return apiClient.getEcostressJobResults(job.jobId);
      }
      if (job.status === 'failed' || job.status === 'expired') {
        throw new ApiClientError(
          job.errorMessage ?? `ECOSTRESS job ended with status "${job.status}".`,
          502,
          'ECOSTRESS_JOB_FAILED',
          job,
        );
      }
      await waitMs(intervalMs, options?.signal);
      job = await apiClient.getEcostressJobStatus(job.jobId, true);
      options?.onJobUpdate?.(job);
    }

    if (job.status === 'completed') {
      return apiClient.getEcostressJobResults(job.jobId);
    }
    throw new ApiClientError(
      `ECOSTRESS extraction job (${job.jobId}) is still "${job.status}". Retry shortly to fetch completed results.`,
      202,
      'ECOSTRESS_JOB_PENDING',
      job,
    );
  },

  fetchHlsForFarm: async (
    payload: HlsJobSubmissionRequest,
    options?: {
      maxPollAttempts?: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
      onJobUpdate?: (job: HlsJobRecord) => void;
    },
  ): Promise<HlsResultPayload> => {
    const maxAttempts = options?.maxPollAttempts ?? 12;
    const intervalMs = options?.pollIntervalMs ?? 2500;

    const initial = await apiClient.getVegetation({
      latitude: payload.location?.latitude,
      longitude: payload.location?.longitude,
      polygon: payload.geometry ?? payload.boundary?.geometry,
      bbox: payload.bbox ?? payload.boundary?.bbox,
      spatialProcessingMode: payload.spatialProcessingMode,
      startDate: payload.dateRange.startDate,
      endDate: payload.dateRange.endDate,
      products: payload.products,
    });

    if (isHlsResultPayload(initial)) {
      return initial;
    }

    let job: HlsJobRecord = initial;
    options?.onJobUpdate?.(job);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (job.status === 'completed') {
        return apiClient.getHlsJobResults(job.jobId);
      }
      if (job.status === 'failed' || job.status === 'expired') {
        throw new ApiClientError(
          job.errorMessage ?? `HLS vegetation job ended with status "${job.status}".`,
          502,
          'HLS_JOB_FAILED',
          job,
        );
      }
      await waitMs(intervalMs, options?.signal);
      job = await apiClient.getHlsJobStatus(job.jobId, true);
      options?.onJobUpdate?.(job);
    }

    if (job.status === 'completed') {
      return apiClient.getHlsJobResults(job.jobId);
    }
    throw new ApiClientError(
      `Landsat/HLS extraction job (${job.jobId}) is still "${job.status}". Retry shortly to fetch completed results.`,
      202,
      'HLS_JOB_PENDING',
      job,
    );
  },

  getCropRegions: (): Promise<AgroClimaticRegionsResult> =>
    request<AgroClimaticRegionsResult>('/crops/regions'),
  searchCropCatalog: (filter: CropCatalogFilter = {}): Promise<CropKnowledgeCatalogResult> => {
    const params = new URLSearchParams();
    if (filter.search) params.set('search', filter.search);
    if (filter.season) params.set('season', filter.season);
    if (filter.agroClimaticZone) params.set('agroClimaticZone', filter.agroClimaticZone);
    if (filter.state) params.set('state', filter.state);
    if (filter.cropFamily) params.set('cropFamily', filter.cropFamily);
    if (filter.waterRequirement) params.set('waterRequirement', filter.waterRequirement);
    if (filter.nitrogenFixingOnly !== undefined) {
      params.set('nitrogenFixingOnly', String(filter.nitrogenFixingOnly));
    }
    if (filter.soilTexture) params.set('soilTexture', filter.soilTexture);
    if (filter.phTarget !== undefined) params.set('phTarget', String(filter.phTarget));

    const qs = params.toString();
    return request<CropKnowledgeCatalogResult>(`/crops/catalog${qs ? `?${qs}` : ''}`);
  },
  getCropProfileById: (cropId: string): Promise<CropKnowledgeProfile> =>
    request<CropKnowledgeProfile>(`/crops/${encodeURIComponent(cropId)}`),
  evaluateCropSuitability: (payload: CropIntelligenceRequest): Promise<CropIntelligenceResult> =>
    request<CropIntelligenceResult>('/crops/suitability', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recommendCrops: (payload: CropIntelligenceRequest): Promise<CropIntelligenceResult> =>
    request<CropIntelligenceResult>('/crops/recommend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateRotation: (payload: RotationGenerateRequest): Promise<RotationPlannerResult> =>
    request<RotationPlannerResult>('/rotation/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  compareRotations: (payload: RotationCompareRequest): Promise<RotationPlannerResult> =>
    request<RotationPlannerResult>('/rotation/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  askAssistant: (payload: AiAssistantRequest): Promise<AiAssistantResponse> =>
    request<AiAssistantResponse>('/ai/ask', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  analyzeEnvironmental: (
    payload: EnvironmentalAnalyticsRequest,
  ): Promise<EnvironmentalAnalyticsResponse> =>
    request<EnvironmentalAnalyticsResponse>('/environmental/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getFarmIntelligenceSummary: (
    payload: FarmIntelligenceRequest,
  ): Promise<FarmIntelligenceResponse> =>
    request<FarmIntelligenceResponse>('/farm-intelligence/summary', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
