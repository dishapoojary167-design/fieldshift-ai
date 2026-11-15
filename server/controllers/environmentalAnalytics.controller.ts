import type { Request, Response } from 'express';
import type {
  EcostressResultPayload,
  EnvironmentalAnalyticsRequest,
  EnvironmentalAnalyticsResponse,
  HlsResultPayload,
} from '../../shared/index.ts';
import { runPhase4EnvironmentalAnalytics } from '../analytics/index.ts';
import { EcostressEvapotranspirationRepository } from '../repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { HlsVegetationRepository } from '../repositories/implementations/HlsVegetationRepository.ts';
import type {
  IEvapotranspirationRepository,
  IVegetationRepository,
} from '../repositories/interfaces/index.ts';
import { sendSuccess } from '../utils/response.ts';
import { resolveSpatialRequestContext } from '../utils/spatialRequest.ts';

export interface EnvironmentalAnalyticsControllerOptions {
  evapotranspirationRepository?: IEvapotranspirationRepository;
  vegetationRepository?: IVegetationRepository;
}

export class EnvironmentalAnalyticsController {
  private readonly evapotranspirationRepo: IEvapotranspirationRepository;
  private readonly vegetationRepo: IVegetationRepository;

  constructor(options: EnvironmentalAnalyticsControllerOptions = {}) {
    this.evapotranspirationRepo =
      options.evapotranspirationRepository ?? new EcostressEvapotranspirationRepository();
    this.vegetationRepo = options.vegetationRepository ?? new HlsVegetationRepository();
  }

  analyze = async (req: Request, res: Response): Promise<void> => {
    const body = (req.validated?.body ?? req.body) as EnvironmentalAnalyticsRequest;
    const spatial = resolveSpatialRequestContext(
      {
        location: body.location,
        boundary: body.boundary,
        geometry: body.geometry,
        bbox: body.bbox,
        spatialProcessingMode: body.spatialProcessingMode,
      },
      'Phase 4 environmental analytics evaluation',
      { allowPolygonMode: true },
    );

    const shouldAutoFetch = body.autoFetchCompletedResults !== false;

    let ecostressPayload: EcostressResultPayload | null = body.ecostressResult ?? null;
    if (body.ecostressResult === undefined && shouldAutoFetch) {
      try {
        ecostressPayload =
          (await this.evapotranspirationRepo.getLatestCompletedResult?.({
            location: spatial.targetLocation,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            dateRange: body.dateRange,
          })) ?? null;
      } catch {
        ecostressPayload = null;
      }
    }

    let hlsPayload: HlsResultPayload | null = body.hlsResult ?? null;
    if (body.hlsResult === undefined && shouldAutoFetch) {
      try {
        hlsPayload =
          (await this.vegetationRepo.getLatestCompletedResult?.({
            location: spatial.targetLocation,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            dateRange: body.dateRange,
          })) ?? null;
      } catch {
        hlsPayload = null;
      }
    }

    const analytics = runPhase4EnvironmentalAnalytics({
      ecostressPayload,
      hlsPayload,
      thresholds: body.thresholds,
    });

    const response: EnvironmentalAnalyticsResponse = {
      location: spatial.targetLocation,
      ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
      spatialProcessing: spatial.spatialProcessing,
      hasEcostressData: Boolean(
        ecostressPayload && ecostressPayload.observations.length > 0,
      ),
      hasHlsData: Boolean(hlsPayload && hlsPayload.observations.length > 0),
      ecostressProducts: ecostressPayload?.products ?? [],
      hlsProducts: hlsPayload?.products ?? [],
      analytics,
    };

    sendSuccess(res, req, response, 200);
  };
}
