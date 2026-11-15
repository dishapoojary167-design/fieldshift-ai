import type { DataProvenance, GeoCoordinate } from './common.ts';
import type { EnvironmentalObservation, EnvironmentalParameter } from './observation.ts';

export interface SoilDepthInterval {
  topCm: number;
  bottomCm: number;
  label: string;
}

export interface SoilObservation extends EnvironmentalObservation<number | null> {
  parameter: Extract<
    EnvironmentalParameter,
    | 'soil_ph'
    | 'soil_organic_carbon'
    | 'soil_clay_fraction'
    | 'soil_sand_fraction'
    | 'soil_silt_fraction'
    | 'soil_nitrogen_total'
    | 'soil_bulk_density'
    | 'soil_cec'
  >;
  depthInterval: SoilDepthInterval;
}

export interface SoilLayerSummary {
  depthInterval: SoilDepthInterval;
  phWater?: number | null;
  organicCarbonGPerKg?: number | null;
  clayPercent?: number | null;
  sandPercent?: number | null;
  siltPercent?: number | null;
  nitrogenGPerKg?: number | null;
  bulkDensityKgPerDm3?: number | null;
  cecCmolPerKg?: number | null;
}

export interface SoilProfileSummary {
  location: GeoCoordinate;
  textureClass?: string;
  drainageClass?: string;
  dominantReferenceSoilGroup?: string;
  layers: SoilLayerSummary[];
  retrievedAt: string;
  dataSource: DataProvenance;
}

export interface RegionalSoilZone {
  id: string;
  countryCode: string;
  regionCode: string;
  zoneName: string;
  faoSoilGroup: string;
  localClassification: string;
  typicalTexture: string;
  drainageCharacteristics: string;
  waterHoldingCapacity: 'low' | 'moderate' | 'high';
  typicalPhRange: [number, number];
  managementNotes: string;
}
