import type {
  DataProvenance,
  GeoCoordinate,
  ObservationQuality,
  SpatialCoverage,
  SpatialResolution,
} from './common.ts';

export type EnvironmentalParameter =
  | 'air_temperature_2m'
  | 'air_temperature_min_2m'
  | 'air_temperature_max_2m'
  | 'relative_humidity_2m'
  | 'solar_radiation_sw_down'
  | 'wind_speed_2m'
  | 'evapotranspiration_et0'
  | 'precipitation_rate'
  | 'precipitation_total'
  | 'soil_moisture_surface'
  | 'soil_moisture_root_zone'
  | 'soil_ph'
  | 'soil_organic_carbon'
  | 'soil_clay_fraction'
  | 'soil_sand_fraction'
  | 'soil_silt_fraction'
  | 'soil_nitrogen_total'
  | 'soil_bulk_density'
  | 'soil_cec'
  | 'ndvi'
  | 'evi';

export type TemporalAggregation =
  | 'instantaneous'
  | 'hourly'
  | 'daily'
  | 'dekadal'
  | 'monthly'
  | 'seasonal'
  | 'static';

export interface EnvironmentalObservation<TValue = number | null> {
  id: string;
  location: GeoCoordinate;
  spatialCoverage: SpatialCoverage;
  parameter: EnvironmentalParameter | string;
  value: TValue;
  unit: string;
  observationTimestamp: string;
  retrievalTimestamp: string;
  dataSource: DataProvenance;
  spatialResolution?: SpatialResolution;
  quality: ObservationQuality;
  temporalAggregation?: TemporalAggregation;
  metadata?: Record<string, unknown>;
}

export interface ObservationTimeSeries<TValue = number | null> {
  parameter: EnvironmentalParameter | string;
  unit: string;
  temporalAggregation: TemporalAggregation;
  location: GeoCoordinate;
  spatialCoverage: SpatialCoverage;
  dataSource: DataProvenance;
  spatialResolution?: SpatialResolution;
  observations: EnvironmentalObservation<TValue>[];
}
