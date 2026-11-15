import type { DataProvenance, DateRange, GeoCoordinate, SpatialCoverage } from './common.ts';
import type {
  CropCalendarEntry,
  CropProfile,
  CropRecommendation,
  RotationPlan,
  RotationRule,
} from './crop.ts';
import type { FarmPlot, RegionDescriptor } from './farm.ts';
import type { RegionalSoilZone, SoilObservation, SoilProfileSummary } from './soil.ts';
import type {
  EnvironmentalDataQuery,
  RainfallObservation,
  SatelliteImageryLayer,
  SoilMoistureObservation,
  WeatherObservation,
} from './weather.ts';

export type ProviderCategory =
  | 'nasa_weather'
  | 'nasa_rainfall'
  | 'nasa_soil_moisture'
  | 'satellite_imagery'
  | 'soil_characteristics'
  | 'agricultural_knowledge'
  | 'ai_advisory';

export type ProviderImplementationStatus =
  | 'interface_ready'
  | 'configured'
  | 'active'
  | 'unavailable';

export interface ProviderDescriptor {
  id: string;
  name: string;
  category: ProviderCategory;
  status: ProviderImplementationStatus;
  requiresCredentials: boolean;
  credentialsPresent: boolean;
  supportedParameters: string[];
  spatialResolutionLabel: string;
  provenance: DataProvenance;
  plannedModule: string;
}

export interface NasaWeatherProvider {
  readonly descriptor: ProviderDescriptor;
  fetchWeatherTimeSeries(query: EnvironmentalDataQuery): Promise<WeatherObservation[]>;
}

export interface NasaRainfallProvider {
  readonly descriptor: ProviderDescriptor;
  fetchRainfallTimeSeries(query: EnvironmentalDataQuery): Promise<RainfallObservation[]>;
}

export interface NasaSoilMoistureProvider {
  readonly descriptor: ProviderDescriptor;
  fetchSoilMoistureTimeSeries(query: EnvironmentalDataQuery): Promise<SoilMoistureObservation[]>;
}

export interface SatelliteImageryProvider {
  readonly descriptor: ProviderDescriptor;
  listAvailableLayers(coverage?: SpatialCoverage): Promise<SatelliteImageryLayer[]>;
}

export interface SoilCharacteristicsProvider {
  readonly descriptor: ProviderDescriptor;
  fetchSoilProfile(location: GeoCoordinate): Promise<SoilProfileSummary>;
  fetchSoilObservations(location: GeoCoordinate): Promise<SoilObservation[]>;
}

export interface RegionalKnowledgeBundle {
  region: RegionDescriptor;
  crops: CropProfile[];
  calendars: CropCalendarEntry[];
  soilZones: RegionalSoilZone[];
  rotationRules: RotationRule[];
}

export interface AgriculturalKnowledgeProvider {
  readonly descriptor: ProviderDescriptor;
  listRegions(): Promise<RegionDescriptor[]>;
  getRegionKnowledge(countryCode: string, regionCode: string): Promise<RegionalKnowledgeBundle>;
  getCropsForRegion(countryCode: string, regionCode: string): Promise<CropProfile[]>;
  getCropCalendars(countryCode: string, regionCode: string): Promise<CropCalendarEntry[]>;
  getRotationRules(countryCode: string, regionCode: string): Promise<RotationRule[]>;
}

export interface AiAdvisoryInput {
  farm: FarmPlot;
  dateRange: DateRange;
  weatherSummary: WeatherObservation[];
  rainfallSummary: RainfallObservation[];
  soilMoistureSummary: SoilMoistureObservation[];
  soilProfile?: SoilProfileSummary;
  candidateRecommendations: CropRecommendation[];
  rotationPlan?: RotationPlan;
  farmerQuestion?: string;
}

export interface AiAdvisoryOutput {
  summary: string;
  keyActionItems: string[];
  riskWarnings: string[];
  modelId: string;
  generatedAt: string;
}

export interface AiAdvisoryProvider {
  readonly descriptor: ProviderDescriptor;
  generateAdvisory(input: AiAdvisoryInput): Promise<AiAdvisoryOutput>;
}
