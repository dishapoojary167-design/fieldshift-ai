import type { Request, Response } from 'express';
import type {
  EcostressResultPayload,
  FarmIntelligenceRequest,
  FarmIntelligenceResponse,
  HlsResultPayload,
} from '../../shared/index.ts';
import { runPhase5FarmIntelligence } from '../intelligence/index.ts';
import { EcostressEvapotranspirationRepository } from '../repositories/implementations/EcostressEvapotranspirationRepository.ts';
import { HlsVegetationRepository } from '../repositories/implementations/HlsVegetationRepository.ts';
import type {
  IEvapotranspirationRepository,
  IVegetationRepository,
} from '../repositories/interfaces/index.ts';
import { sendSuccess } from '../utils/response.ts';
import { resolveSpatialRequestContext } from '../utils/spatialRequest.ts';

export interface FarmIntelligenceControllerOptions {
  evapotranspirationRepository?: IEvapotranspirationRepository;
  vegetationRepository?: IVegetationRepository;
}

export class FarmIntelligenceController {
  private readonly evapotranspirationRepo: IEvapotranspirationRepository;
  private readonly vegetationRepo: IVegetationRepository;

  constructor(options: FarmIntelligenceControllerOptions = {}) {
    this.evapotranspirationRepo =
      options.evapotranspirationRepository ?? new EcostressEvapotranspirationRepository();
    this.vegetationRepo = options.vegetationRepository ?? new HlsVegetationRepository();
  }

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const body = (req.validated?.body ?? req.body) as FarmIntelligenceRequest;
    const spatial = resolveSpatialRequestContext(
      {
        location: body.location,
        boundary: body.boundary,
        geometry: body.geometry,
        bbox: body.bbox,
        spatialProcessingMode: body.spatialProcessingMode,
      },
      'Phase 5 farm-level intelligence synthesis',
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

    const intelligence = runPhase5FarmIntelligence({
      location: spatial.targetLocation,
      boundaryContext: spatial.boundaryContext,
      ecostressPayload,
      hlsPayload,
      weatherTelemetry: body.weatherTelemetry ?? null,
      soilProfile: body.soilProfile ?? null,
      soilMoisture: body.soilMoisture ?? null,
      labSoilTest: body.labSoilTest ?? null,
      precomputedPhase4: body.phase4Analytics ?? null,
    });

    const response: FarmIntelligenceResponse = {
      location: spatial.targetLocation,
      ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
      spatialProcessing: spatial.spatialProcessing,
      intelligence,
    };

    sendSuccess(res, req, response, 200);
  };
}
