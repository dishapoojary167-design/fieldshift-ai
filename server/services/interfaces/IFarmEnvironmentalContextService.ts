import type {
  BoundingBox,
  CropEnvironmentalInputs,
  CropGrowingSeason,
  DateRange,
  EcostressResultPayload,
  FarmEnvironmentalContext,
  GeoCoordinates,
  GeoJsonPolygon,
  HlsResultPayload,
  LabSoilTestResult,
  SoilBoundaryContext,
  SpatialProcessingMode,
} from '../../../shared/index.ts';

export interface AssembleContextOptions {
  location?: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
  dateRange?: DateRange;
  targetSeason?: CropGrowingSeason;
  labSoilTest?: LabSoilTestResult | null;
  existingInputs?: CropEnvironmentalInputs;
  autoFetchMissingFarmData?: boolean;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
}

export interface IFarmEnvironmentalContextService {
  assembleContext(options: AssembleContextOptions): Promise<FarmEnvironmentalContext>;
}
