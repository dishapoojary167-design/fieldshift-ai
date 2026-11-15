import type {
  BoundingBox,
  GeoCoordinate,
  GeoJsonMultiPolygon,
  GeoJsonPolygon,
} from './common.ts';

export type IrrigationType =
  | 'rainfed'
  | 'drip'
  | 'sprinkler'
  | 'canal'
  | 'borewell'
  | 'mixed'
  | 'unknown';

export interface FarmLocation {
  coordinate: GeoCoordinate;
  countryCode: string;
  countryName: string;
  regionCode: string;
  regionName: string;
  district?: string;
  locality?: string;
  agroClimaticZone?: string;
}

export interface FarmBoundary {
  id: string;
  name: string;
  geometry: GeoJsonPolygon | GeoJsonMultiPolygon;
  centroid: GeoCoordinate;
  bbox: BoundingBox;
  areaHectares: number;
  perimeterMeters?: number;
  crs: 'EPSG:4326';
}

export interface FarmPlot {
  id: string;
  name: string;
  location: FarmLocation;
  boundary?: FarmBoundary;
  irrigationType: IrrigationType;
  soilTextureClass?: string;
  currentCropId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegionDescriptor {
  countryCode: string;
  countryName: string;
  regionCode: string;
  regionName: string;
  center: GeoCoordinate;
  bbox: BoundingBox;
  defaultZoom: number;
  agroClimaticZones: string[];
  primarySeasons: string[];
  climateSummary: string;
  isDefaultDemo?: boolean;
}
