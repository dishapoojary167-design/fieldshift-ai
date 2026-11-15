export interface GeoCoordinate {
  latitude: number;
  longitude: number;
  elevationMeters?: number;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type GeoJsonPosition = [number, number] | [number, number, number];

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: GeoJsonPosition;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: GeoJsonPosition[][];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoJsonPosition[][][];
}

export type GeoJsonGeometry = GeoJsonPoint | GeoJsonPolygon | GeoJsonMultiPolygon;

export interface SpatialCoverage {
  kind: 'point' | 'polygon' | 'multipolygon' | 'bbox' | 'region';
  centroid: GeoCoordinate;
  bbox?: BoundingBox;
  geometry?: GeoJsonGeometry;
  countryCode?: string;
  regionCode?: string;
  adminLevel1?: string;
  adminLevel2?: string;
}

export type DataQualityFlag =
  | 'measured'
  | 'derived'
  | 'interpolated'
  | 'provisional'
  | 'missing'
  | 'invalid';

export interface SpatialResolution {
  value: number;
  unit: 'm' | 'km' | 'deg';
  label: string;
}

export interface DataProvenance {
  providerId: string;
  providerName: string;
  datasetName: string;
  datasetVersion?: string;
  processingLevel?: string;
  endpoint?: string;
  license?: string;
  citation?: string;
}

export interface ObservationQuality {
  flag: DataQualityFlag;
  confidence?: number;
  uncertainty?: number;
  notes?: string;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}
