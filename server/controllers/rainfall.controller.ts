import type { Request, Response } from 'express';
import type {
  BoundingBox,
  GeoJsonPolygon,
  SpatialProcessingMode,
} from '../../shared/index.ts';
import type { IWeatherService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';
import { GpmImergArcGisProvider } from '../providers/GpmImergArcGisProvider.ts';
import { resolveSpatialRequestContext } from '../utils/spatialRequest.ts';

export class RainfallController {
  private readonly gpmProvider: GpmImergArcGisProvider;

  constructor(_weatherService: IWeatherService) {
    this.gpmProvider = new GpmImergArcGisProvider();
  }

  getRainfall = async (req: Request, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? req.query) as {
      latitude?: number;
      longitude?: number;
      polygon?: GeoJsonPolygon;
      bbox?: BoundingBox;
      spatialProcessingMode?: SpatialProcessingMode;
      startDate?: string;
      endDate?: string;
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
      'NASA GPM IMERG rainfall lookup',
    );
    const targetLocation = spatial.targetLocation;
    const endDate = query.endDate ?? new Date().toISOString().slice(0, 10);
    const startDate = query.startDate ?? endDate;

    const gpmObs = await this.gpmProvider.getPointRainfall(targetLocation, endDate, {
      boundary: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: query.spatialProcessingMode,
    });

    const snapshot = {
      location: targetLocation,
      ...(spatial.boundaryContext ? { boundaryContext: spatial.boundaryContext } : {}),
      spatialProcessing: spatial.spatialProcessing,
      dateRange: {
        startDate,
        endDate,
      },
      dataClassification: 'satellite_derived_estimate',
      productIdentifier: 'GPM_3IMERGHHE V07',
      runType: 'Early / Half-Hourly Final',
      spatialResolution: {
        value: 10,
        unit: 'km',
        label: '0.1° × 0.1° (~10 km)',
      },
      units: {
        precipitationRate: 'mm/hr',
        precipitationAccumulation: 'mm/day',
      },
      observation: gpmObs,
      sourceAttribution: {
        providerId: 'nasa-gpm-imerg-gis',
        providerName: 'NASA GES DISC GPM IMERG',
        datasetName: 'GPM IMERG V07 Precipitation',
        url: 'https://gpm.nasa.gov/data/imerg',
        retrievedAt: new Date().toISOString(),
      },
      qualityMetadata: {
        method: 'Satellite passive microwave and infrared precipitation estimate',
        distinction: 'Satellite-derived estimate; does not substitute direct local rain-gauge sensor readings.',
      },
    };

    sendSuccess(res, req, snapshot, 200);
  };
}
