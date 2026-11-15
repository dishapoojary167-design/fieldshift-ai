import type {
  SoilDepthInterval,
  SoilMoistureRequest,
  SoilMoistureSnapshot,
  SoilProfile,
  SoilProfileRequest,
} from '../../../shared/index.ts';
import { CompositeSoilGridsProvider } from '../../providers/CompositeSoilGridsProvider.ts';
import type { ISoilGridsProvider } from '../../providers/ISoilGridsProvider.ts';
import type { ISoilMoistureProvider } from '../../providers/ISoilMoistureProvider.ts';
import { NasaSmapMoistureProvider } from '../../providers/NasaSmapMoistureProvider.ts';
import { describeWaterRetentionFromTexture } from '../../utils/soilTexture.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';
import type { ISoilRepository } from '../interfaces/index.ts';

export interface SoilRepositoryOptions {
  soilGridsProvider?: ISoilGridsProvider;
  soilMoistureProvider?: ISoilMoistureProvider;
}

export class SoilRepository implements ISoilRepository {
  private readonly soilGridsProvider: ISoilGridsProvider;
  private readonly soilMoistureProvider: ISoilMoistureProvider;

  constructor(options: SoilRepositoryOptions = {}) {
    this.soilGridsProvider = options.soilGridsProvider ?? new CompositeSoilGridsProvider();
    this.soilMoistureProvider = options.soilMoistureProvider ?? new NasaSmapMoistureProvider();
  }

  async fetchSoilProfile(request: SoilProfileRequest): Promise<SoilProfile> {
    const selectedDepthCm: SoilDepthInterval = request.depthCm ?? '0-5';
    const spatial = resolveSpatialRequestContext(
      request,
      'ISRIC SoilGrids soil profile lookup',
    );
    const targetLocation = spatial.targetLocation;
    const result = await this.soilGridsProvider.fetchDepthProfile(targetLocation, {
      boundary: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
    });

    const activeLayer =
      result.depthLayers.find((layer) => layer.depthIntervalCm === selectedDepthCm) ??
      result.depthLayers[0];

    return {
      location: targetLocation,
      boundaryContext: spatial.boundaryContext,
      spatialProcessing: spatial.spatialProcessing,
      selectedDepthCm,
      dataClassification: 'modelled_estimate',
      status: result.status,
      providerUsed: result.providerUsed,
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
      depthLayers: result.depthLayers,
      surfaceSummary: {
        depthIntervalCm: activeLayer.depthIntervalCm,
        textureClass: activeLayer.textureClass,
        ph: activeLayer.ph,
        organicCarbonGKg: activeLayer.organicCarbonGKg,
        nitrogenGKg: activeLayer.nitrogenGKg,
        sandPercent: activeLayer.sandPercent,
        siltPercent: activeLayer.siltPercent,
        clayPercent: activeLayer.clayPercent,
        bulkDensityKgDm3: activeLayer.bulkDensityKgDm3,
        cecCmolKg: activeLayer.cecCmolKg,
        waterRetentionSummary: describeWaterRetentionFromTexture(activeLayer.textureClass),
      },
      uncertaintyMethodology:
        'ISRIC SoilGrids reports 90% prediction intervals via 5th (Q0.05) and 95th (Q0.95) quantile random-forest estimates alongside relative uncertainty index.',
      wmsReferenceLayer: {
        serviceUrl: 'https://maps.isric.org/mapserv?map=/map/phh2o.map',
        layerName: `phh2o_${selectedDepthCm}cm_mean`,
        attribution: 'ISRIC SoilGrids WMS',
      },
      sourceAttribution: result.sourceAttribution,
      caveats: result.caveats,
      retrievedAt: new Date().toISOString(),
    };
  }

  async fetchSoilMoisture(request: SoilMoistureRequest): Promise<SoilMoistureSnapshot> {
    const spatial = resolveSpatialRequestContext(
      request,
      'NASA SMAP soil moisture lookup',
    );
    const targetLocation = spatial.targetLocation;
    const snapshot = await this.soilMoistureProvider.fetchSoilMoisture(targetLocation, {
      boundary: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: request.spatialProcessingMode,
      dateRange: request.dateRange,
    });

    return {
      ...snapshot,
      boundaryContext: snapshot.boundaryContext ?? spatial.boundaryContext,
      spatialProcessing: snapshot.spatialProcessing ?? spatial.spatialProcessing,
    };
  }
}
