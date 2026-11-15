export interface ApiResponseMeta {
  apiVersion: string;
  timestamp: string;
  requestId?: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiResponseMeta;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  meta: ApiResponseMeta;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export type ServiceReadinessStatus = 'ready' | 'stub' | 'unconfigured';

export interface ServiceStatusMap {
  location: ServiceReadinessStatus;
  weather: ServiceReadinessStatus;
  soil: ServiceReadinessStatus;
  cropIntelligence: ServiceReadinessStatus;
  cropRotation: ServiceReadinessStatus;
  aiAssistant: ServiceReadinessStatus;
}

export interface HealthCheckPayload {
  status: 'ok' | 'degraded';
  appName: string;
  challenge: string;
  version: string;
  apiVersion: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  services: ServiceStatusMap;
}
