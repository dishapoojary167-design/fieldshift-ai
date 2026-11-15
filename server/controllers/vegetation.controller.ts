import type { Request, Response } from 'express';
import type {
  BoundingBox,
  GeoJsonPolygon,
  HlsJobSubmissionRequest,
  HlsProductId,
  SpatialProcessingMode,
} from '../../shared/index.ts';
import type { IVegetationService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';
import { resolveSpatialRequestContext } from '../utils/spatialRequest.ts';

export class VegetationController {
  private readonly service: IVegetationService;

  constructor(service: IVegetationService) {
    this.service = service;
  }

  getProducts = async (req: Request, res: Response): Promise<void> => {
    const capabilities = this.service.getCapabilities();
    sendSuccess(res, req, capabilities, 200);
  };

  getVegetation = async (req: Request, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? req.query) as {
      latitude?: number;
      longitude?: number;
      polygon?: GeoJsonPolygon;
      bbox?: BoundingBox;
      spatialProcessingMode?: SpatialProcessingMode;
      startDate?: string;
      endDate?: string;
      products?: string;
    };

    const spatial = resolveSpatialRequestContext(
      {
        ...(query.latitude !== undefined && query.longitude !== undefined
          ? { location: { latitude: Number(query.latitude), longitude: Number(query.longitude) } }
          : {}),
        geometry: query.polygon,
        bbox: query.bbox,
        spatialProcessingMode: query.spatialProcessingMode,
      },
      'NASA HLS vegetation lookup',
      { allowPolygonMode: true },
    );

    const todayIso = new Date().toISOString().slice(0, 10);
    const endDate = query.endDate ?? todayIso;
    const defaultStart = new Date(Date.parse(`${endDate}T00:00:00Z`) - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const startDate = query.startDate ?? defaultStart;

    const requestedProducts = query.products
      ? (query.products.split(',').map((p) => p.trim()) as HlsProductId[])
      : undefined;

    const job = await this.service.submitJob({
      location: spatial.targetLocation,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: query.spatialProcessingMode,
      dateRange: { startDate, endDate },
      ...(requestedProducts ? { products: requestedProducts } : {}),
    });

    if (job.status === 'completed') {
      const results = await this.service.getJobResults(job.jobId);
      sendSuccess(res, req, results, 200);
      return;
    }

    sendSuccess(res, req, job, 202);
  };

  submitJob = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.validated?.body ?? req.body) as HlsJobSubmissionRequest;
    const job = await this.service.submitJob(payload);
    sendSuccess(res, req, job, 202);
  };

  getJobStatus = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = (req.validated?.params ?? req.params) as { jobId: string };
    const query = (req.validated?.query ?? req.query) as { refresh?: boolean };
    const status = await this.service.getJobStatus(jobId, { refresh: query.refresh });
    sendSuccess(res, req, status, 200);
  };

  getJobResults = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = (req.validated?.params ?? req.params) as { jobId: string };
    const results = await this.service.getJobResults(jobId);
    sendSuccess(res, req, results, 200);
  };
}

