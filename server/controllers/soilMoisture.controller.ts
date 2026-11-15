import type { Request, Response } from 'express';
import type {
  BoundingBox,
  GeoJsonPolygon,
  SpatialProcessingMode,
} from '../../shared/index.ts';
import type { ISoilService } from '../services/index.ts';
import { sendSuccess } from '../utils/response.ts';
import { resolveSpatialRequestContext } from '../utils/spatialRequest.ts';

export class SoilMoistureController {
  private readonly soilService: ISoilService;

  constructor(soilService: ISoilService) {
    this.soilService = soilService;
  }

  getSoilMoisture = async (req: Request, res: Response): Promise<void> => {
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
      'NASA SMAP soil moisture lookup',
    );
    const targetLocation = spatial.targetLocation;
    const dateRange = query.startDate && query.endDate
      ? { startDate: query.startDate, endDate: query.endDate }
      : query.endDate
        ? { startDate: query.endDate, endDate: query.endDate }
        : undefined;

    const snapshot = await this.soilService.getSoilMoisture({
      location: targetLocation,
      boundary: spatial.boundaryContext,
      geometry: spatial.geometry,
      bbox: spatial.bbox,
      spatialProcessingMode: query.spatialProcessingMode,
      dateRange,
    });

    const isAvailable = snapshot.status === 'available' || snapshot.status === 'partial';

    const responsePayload = {
      location: snapshot.location,
      ...(snapshot.boundaryContext ? { boundaryContext: snapshot.boundaryContext } : {}),
      ...(snapshot.spatialProcessing ? { spatialProcessing: snapshot.spatialProcessing } : {}),
      dateRange: snapshot.observationDate
        ? {
            startDate: dateRange?.startDate ?? snapshot.moistureSeries[0]?.date ?? snapshot.observationDate,
            endDate: dateRange?.endDate ?? snapshot.observationDate,
          }
        : dateRange ?? null,
      dataClassification: 'satellite_derived',
      surfaceSoilMoisture: snapshot.surfaceMoistureM3M3,
      rootZoneSoilMoisture: snapshot.rootZoneMoistureM3M3,
      surfaceMoistureDepth: '0–5 cm (Surface layer, SPL3SMP_E)',
      rootZoneMoistureDepth: '0–100 cm (Root-zone depth; SMAP L4 land-model assimilation SPL4SMGP only)',
      observationDate: snapshot.observationDate,
      unit: snapshot.units,
      productIdentifier: 'SPL3SMP_E V006 / SPL4SMGP V007',
      spatialResolution: {
        value: 9,
        unit: 'km',
        label: '9 km × 9 km (EASE-Grid 2.0)',
      },
      qualityInformation: {
        retrievalQualityFlag: isAvailable ? 0 : null,
        qualityFlagDescription: isAvailable
          ? 'Recommended retrieval / nominal high quality (retrieval_qual_flag = 0)'
          : 'Observation unavailable, outside valid range, or flagged with retrieval limitations',
        missingValueIndicator: -9999.0,
        sensorTechnology: 'SMAP L-band Radiometer (1.41 GHz)',
        retrievalMethodology: 'NASA Enhanced L3 Passive Radiometer & L4 Land Surface Model Assimilation',
        confidenceNote: snapshot.retrievalConfidenceNote,
        spatialScaleNote: 'Coarse 9 km regional grid cell; represents regional footprint rather than sub-field microvariations.',
      },
      dataSource: {
        providerId: 'nasa-smap-nsidc',
        providerName: 'NASA National Snow and Ice Data Center (NSIDC) DAAC',
        datasetName: 'SMAP Enhanced L3 Radiometer Global Daily 9 km (SPL3SMP_E V006) & SMAP L4 Global 9 km (SPL4SMGP V007)',
        productVersion: 'V006 (L3) / V007 (L4)',
        doiOrUrl: 'https://nsidc.org/data/spl3smp_e',
        accessMethod: 'NSIDC DAAC / AppEEARS / NASA GIBS WMTS',
        authRequirement: 'Earthdata Login token required for raw HDF5/GeoTIFF; open GIBS WMTS with colormap quantization',
        retrievedAt: snapshot.retrievedAt,
        cached: snapshot.sourceAttribution.cached ?? false,
      },
      moistureSeries: snapshot.moistureSeries.map((pt) => ({
        date: pt.date,
        surfaceMoistureM3M3: pt.surfaceMoistureM3M3,
        surfaceMoistureRangeM3M3: pt.surfaceMoistureRangeM3M3,
        rootZoneMoistureM3M3: pt.rootZoneMoistureM3M3,
        rootZoneMoistureRangeM3M3: pt.rootZoneMoistureRangeM3M3,
        qualityFlag: pt.surfaceMoistureM3M3 !== null ? 0 : 1,
      })),
      status: snapshot.status,
      message: snapshot.message,
      restrictions: [
        'SMAP soil moisture measures volumetric water content (m³/m³) only; it is NOT a complete soil chemistry analysis.',
        'Do NOT infer Nitrogen (N), Phosphorus (P), Potassium (K), Soil pH, or Organic Carbon from SMAP measurements.',
        'Surface soil moisture (0–5 cm) is distinct from root-zone soil moisture (0–100 cm, which requires L4 model assimilation).',
        'Do not claim individual field-level accuracy from a coarse 9 km satellite grid cell.',
      ],
      retrievedAt: snapshot.retrievedAt,
    };

    sendSuccess(res, req, responsePayload, 200);
  };
}
