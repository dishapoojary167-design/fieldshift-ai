import { randomUUID } from 'node:crypto';
import {
  calculateAreaHectaresFromGeoJsonPolygon,
  calculateBoundingBoxCenter,
  calculateBoundingBoxFromGeoJsonPolygon,
  calculateCentroidFromGeoJsonPolygon,
  countGeoJsonPolygonVertices,
  extractOuterRingVertices,
  type BoundingBox,
  type DateRange,
  type HlsJobRecord,
  type HlsJobSubmissionRequest,
  type HlsProductId,
  type HlsProviderCapabilitiesPayload,
  type HlsResultPayload,
  type HlsTaskType,
  type GeoCoordinates,
  type GeoJsonPolygon,
  type SoilBoundaryContext,
  type SpatialProcessingMetadata,
} from '../../../shared/index.ts';
import { env } from '../../config/env.ts';
import {
  ConflictError,
  ExternalServiceError,
  JobExpiredError,
  NotFoundError,
  ValidationError,
} from '../../errors/AppError.ts';
import {
  DEFAULT_HLS_PRODUCTS,
  HLS_LATITUDE_BOUNDS,
  HLS_TEMPORAL_START_DATE,
  LandsatHlsAppEearsProvider,
  resolveHlsLayerPairs,
  type ILandsatHlsProvider,
} from '../../providers/hls/index.ts';
import type { IVegetationRepository } from '../interfaces/IVegetationRepository.ts';

export interface HlsVegetationRepositoryOptions {
  provider?: ILandsatHlsProvider;
  jobTtlMs?: number;
  nowFn?: () => number;
}

interface SpatialHlsResolution {
  targetLocation: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  taskType: HlsTaskType;
  spatialProcessing: SpatialProcessingMetadata;
}

export class HlsVegetationRepository implements IVegetationRepository {
  private readonly provider: ILandsatHlsProvider;
  private readonly jobTtlMs: number;
  private readonly nowFn: () => number;
  private readonly jobs = new Map<string, HlsJobRecord>();

  constructor(options: HlsVegetationRepositoryOptions = {}) {
    this.provider = options.provider ?? new LandsatHlsAppEearsProvider();
    this.jobTtlMs = options.jobTtlMs ?? env.ecostressJobTtlMs;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  getCapabilities(): HlsProviderCapabilitiesPayload {
    return {
      providerId: this.provider.providerId,
      accessMethod: 'NASA AppEEARS API',
      appeearsBaseUrl: this.provider.appeearsBaseUrl,
      authentication: this.provider.getAuthStatus(),
      products: this.provider.getVerifiedProducts(),
    };
  }

  private resolveSpatialContext(request: HlsJobSubmissionRequest): SpatialHlsResolution {
    const geometry = request.boundary?.geometry ?? request.geometry;
    const bbox =
      request.boundary?.bbox ??
      request.bbox ??
      (geometry ? calculateBoundingBoxFromGeoJsonPolygon(geometry) : undefined);

    const requestedMode = request.spatialProcessingMode ?? 'auto';
    if (requestedMode === 'polygon' && !geometry && !bbox) {
      throw new ValidationError(
        'Polygon processing was requested (spatialProcessingMode: "polygon"), but no GeoJSON Polygon geometry or bbox was provided.',
      );
    }

    const targetLocation =
      request.boundary?.centroid ??
      request.location ??
      (geometry
        ? calculateCentroidFromGeoJsonPolygon(geometry)
        : bbox
          ? calculateBoundingBoxCenter(bbox)
          : undefined);

    if (!targetLocation) {
      throw new ValidationError(
        'Unable to resolve target farm coordinates from location, boundary, geometry, or bbox.',
      );
    }

    this.assertLatitudeBounds(targetLocation, geometry, bbox);

    let boundaryContext: SoilBoundaryContext | undefined = request.boundary;
    if (request.boundary) {
      boundaryContext = {
        ...request.boundary,
        ...(geometry ? { geometry } : {}),
        ...(bbox ? { bbox } : {}),
      };
    } else if (geometry || bbox) {
      boundaryContext = {
        id: 'custom-polygon',
        name: 'Selected Farm Boundary',
        areaHectares: geometry ? calculateAreaHectaresFromGeoJsonPolygon(geometry) : 0,
        centroid: geometry
          ? calculateCentroidFromGeoJsonPolygon(geometry)
          : calculateBoundingBoxCenter(bbox!),
        ...(geometry ? { geometry } : {}),
        ...(bbox ? { bbox } : {}),
      };
    }

    const useAreaPolygonTask = requestedMode !== 'centroid' && Boolean(geometry || bbox);
    const taskType: HlsTaskType = useAreaPolygonTask ? 'area' : 'point';
    const vertexCount = geometry ? countGeoJsonPolygonVertices(geometry) : undefined;

    const appliedMode: SpatialProcessingMetadata['appliedMode'] = useAreaPolygonTask
      ? 'polygon'
      : boundaryContext
        ? 'centroid'
        : 'point';

    const note = useAreaPolygonTask
      ? `Submitted as an AppEEARS area subsetting task using ${geometry ? `full GeoJSON Polygon (${vertexCount} vertices)` : 'BoundingBox'}.`
      : 'Submitted as an AppEEARS point extraction task at target coordinates.';

    return {
      targetLocation,
      boundaryContext,
      geometry,
      bbox,
      taskType,
      spatialProcessing: {
        requestedMode,
        appliedMode,
        hasPolygonGeometry: Boolean(geometry),
        hasBoundingBox: Boolean(bbox),
        ...(vertexCount !== undefined ? { vertexCount } : {}),
        note,
      },
    };
  }

  private assertLatitudeBounds(
    targetLocation: GeoCoordinates,
    geometry?: GeoJsonPolygon,
    bbox?: BoundingBox,
  ): void {
    const { min, max } = HLS_LATITUDE_BOUNDS;
    const outOfRange = (lat: number) => lat < min || lat > max;

    if (outOfRange(targetLocation.latitude)) {
      throw new ValidationError(
        `NASA HLS coverage spans ${min}° to ${max}° latitude; target latitude ${targetLocation.latitude}° is outside coverage.`,
      );
    }

    if (bbox && (outOfRange(bbox.south) || outOfRange(bbox.north))) {
      throw new ValidationError(
        `NASA HLS coverage spans ${min}° to ${max}° latitude; bounding box exceeds coverage.`,
      );
    }

    if (geometry) {
      const vertices = extractOuterRingVertices(geometry);
      const invalidVertex = vertices.find((v) => outOfRange(v.latitude));
      if (invalidVertex) {
        throw new ValidationError(
          `NASA HLS coverage spans ${min}° to ${max}° latitude; polygon vertex latitude ${invalidVertex.latitude}° is outside coverage.`,
        );
      }
    }
  }

  async submitJob(request: HlsJobSubmissionRequest): Promise<HlsJobRecord> {
    if (request.dateRange.startDate < HLS_TEMPORAL_START_DATE) {
      throw new ValidationError(
        `NASA HLS data begins on ${HLS_TEMPORAL_START_DATE}; requested startDate ${request.dateRange.startDate} is earlier than mission coverage.`,
      );
    }

    const spatial = this.resolveSpatialContext(request);
    const products: HlsProductId[] =
      request.products && request.products.length > 0
        ? Array.from(new Set(request.products))
        : [...DEFAULT_HLS_PRODUCTS];

    const layers = resolveHlsLayerPairs(products, request.layers);
    if (layers.length === 0) {
      throw new ValidationError('No valid NASA HLS layers matched the selected products.', {
        products,
        requestedLayers: request.layers,
      });
    }

    const outputFormat = spatial.taskType === 'area' ? (request.outputFormat ?? 'geotiff') : 'csv';
    const jobId = `hls-${randomUUID()}`;
    const taskName =
      request.taskName?.trim() ||
      `FieldShift_HLS_${spatial.boundaryContext?.id ?? 'point'}_${request.dateRange.startDate}_${request.dateRange.endDate}`;

    const receipt = await this.provider.submitJob({
      taskName,
      taskType: spatial.taskType,
      location: spatial.targetLocation,
      boundaryContext: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessing: spatial.spatialProcessing,
      dateRange: request.dateRange,
      products,
      layers,
      outputFormat,
    });

    const nowIso = new Date(this.nowFn()).toISOString();
    const fallbackExpiry = new Date(this.nowFn() + this.jobTtlMs).toISOString();

    const record: HlsJobRecord = {
      jobId,
      upstreamTaskId: receipt.upstreamTaskId,
      providerId: this.provider.providerId,
      status: receipt.status,
      upstreamStatus: receipt.upstreamStatus,
      taskType: spatial.taskType,
      products,
      layers,
      dateRange: request.dateRange,
      location: spatial.targetLocation,
      ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
      spatialProcessing: spatial.spatialProcessing,
      outputFormat,
      createdAt: receipt.submittedAt || nowIso,
      updatedAt: nowIso,
      expiresAt: receipt.expiresAt || fallbackExpiry,
      resultAvailable: receipt.status === 'completed',
    };

    this.jobs.set(jobId, record);
    return record;
  }

  private getStoredJobOrThrow(jobId: string): HlsJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundError(`NASA HLS vegetation job "${jobId}" was not found.`);
    }

    if (job.status !== 'expired' && Date.parse(job.expiresAt) <= this.nowFn()) {
      const expiredRecord: HlsJobRecord = {
        ...job,
        status: 'expired',
        upstreamStatus: 'expired',
        updatedAt: new Date(this.nowFn()).toISOString(),
        resultAvailable: false,
        errorMessage: 'NASA HLS extraction job expired before results were finalized.',
      };
      this.jobs.set(jobId, expiredRecord);
      return expiredRecord;
    }

    return job;
  }

  async getJobStatus(jobId: string, options: { refresh?: boolean } = {}): Promise<HlsJobRecord> {
    const existing = this.getStoredJobOrThrow(jobId);

    const isTerminal =
      existing.status === 'completed' ||
      existing.status === 'failed' ||
      existing.status === 'expired';

    if (isTerminal && !options.refresh) {
      return existing;
    }
    if (existing.status === 'expired') {
      return existing;
    }

    try {
      const upstream = await this.provider.pollJobStatus(existing.upstreamTaskId);
      const updated: HlsJobRecord = {
        ...existing,
        status: upstream.status,
        upstreamStatus: upstream.upstreamStatus,
        updatedAt: upstream.updatedAt,
        expiresAt: upstream.expiresAt ?? existing.expiresAt,
        progressPercent: upstream.progressPercent ?? existing.progressPercent,
        errorMessage: upstream.errorMessage,
        bundleFiles: upstream.bundleFiles ?? existing.bundleFiles,
        resultAvailable: upstream.status === 'completed',
      };
      this.jobs.set(jobId, updated);
      return updated;
    } catch (error) {
      if (error instanceof JobExpiredError) {
        const expiredRecord: HlsJobRecord = {
          ...existing,
          status: 'expired',
          upstreamStatus: 'expired',
          updatedAt: new Date(this.nowFn()).toISOString(),
          resultAvailable: false,
          errorMessage: error.message,
        };
        this.jobs.set(jobId, expiredRecord);
        return expiredRecord;
      }
      throw error;
    }
  }

  async getJobResults(jobId: string): Promise<HlsResultPayload> {
    let job = this.getStoredJobOrThrow(jobId);

    if (job.status === 'submitted' || job.status === 'pending' || job.status === 'processing') {
      job = await this.getJobStatus(jobId, { refresh: true });
    }

    if (job.status === 'expired') {
      throw new JobExpiredError(`NASA HLS job "${jobId}" has expired and results are no longer available.`, {
        jobId,
        upstreamTaskId: job.upstreamTaskId,
      });
    }

    if (job.status === 'failed') {
      throw new ExternalServiceError(
        `NASA HLS job "${jobId}" failed upstream: ${job.errorMessage ?? 'Unknown error.'}`,
        { jobId, upstreamTaskId: job.upstreamTaskId, status: job.status },
      );
    }

    if (job.status !== 'completed') {
      throw new ConflictError(`NASA HLS job "${jobId}" is currently "${job.status}" and results are not ready.`, {
        jobId,
        status: job.status,
      });
    }

    try {
      return await this.provider.fetchJobResults(job);
    } catch (error) {
      if (error instanceof JobExpiredError) {
        this.jobs.set(jobId, {
          ...job,
          status: 'expired',
          upstreamStatus: 'expired',
          updatedAt: new Date(this.nowFn()).toISOString(),
          resultAvailable: false,
          errorMessage: error.message,
        });
      }
      throw error;
    }
  }

  async getLatestCompletedResult(params: {
    location?: GeoCoordinates;
    boundary?: SoilBoundaryContext;
    geometry?: GeoJsonPolygon;
    bbox?: BoundingBox;
    dateRange?: DateRange;
  }): Promise<HlsResultPayload | null> {
    for (const job of this.jobs.values()) {
      if (job.status === 'completed') {
        if (params.boundary?.id && job.boundaryContext?.id === params.boundary.id) {
          try {
            return await this.getJobResults(job.jobId);
          } catch {
            // ignore
          }
        } else if (params.location && job.location) {
          const toRad = (deg: number) => (deg * Math.PI) / 180;
          const rKm = 6371;
          const dLat = toRad(job.location.latitude - params.location.latitude);
          const dLon = toRad(job.location.longitude - params.location.longitude);
          const lat1 = toRad(params.location.latitude);
          const lat2 = toRad(job.location.latitude);
          const h =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const dist = 2 * rKm * Math.asin(Math.min(1, Math.sqrt(h)));
          if (dist <= 25) {
            try {
              return await this.getJobResults(job.jobId);
            } catch {
              // ignore
            }
          }
        }
      }
    }
    for (const job of this.jobs.values()) {
      if (job.status === 'completed') {
        try {
          return await this.getJobResults(job.jobId);
        } catch {
          // ignore
        }
      }
    }
    return null;
  }
}
