import type { DateRange, GeoCoordinate, SpatialCoverage } from './common.ts';
import type {
  EnvironmentalObservation,
  EnvironmentalParameter,
  TemporalAggregation,
} from './observation.ts';

export interface WeatherObservation extends EnvironmentalObservation<number | null> {
  parameter: Extract<
    EnvironmentalParameter,
    | 'air_temperature_2m'
    | 'air_temperature_min_2m'
    | 'air_temperature_max_2m'
    | 'relative_humidity_2m'
    | 'solar_radiation_sw_down'
    | 'wind_speed_2m'
    | 'evapotranspiration_et0'
  >;
}

export interface RainfallObservation extends EnvironmentalObservation<number | null> {
  parameter: Extract<
    EnvironmentalParameter,
    'precipitation_rate' | 'precipitation_total'
  >;
  anomalyPercent?: number;
}

export interface SoilMoistureObservation extends EnvironmentalObservation<number | null> {
  parameter: Extract<
    EnvironmentalParameter,
    'soil_moisture_surface' | 'soil_moisture_root_zone'
  >;
  depthCm?: { topCm: number; bottomCm: number };
  percentileRank?: number;
}

export interface EnvironmentalDataQuery {
  location: GeoCoordinate;
  spatialCoverage?: SpatialCoverage;
  dateRange: DateRange;
  parameters: (EnvironmentalParameter | string)[];
  temporalAggregation: TemporalAggregation;
}

export interface SatelliteImageryLayer {
  layerId: string;
  title: string;
  subtitle?: string;
  providerId: string;
  tileUrlTemplate: string;
  format: 'image/png' | 'image/jpeg' | 'image/webp';
  projection: 'EPSG:3857' | 'EPSG:4326';
  temporalSupport: boolean;
  defaultDate?: string;
  attribution: string;
  maxZoom: number;
}
