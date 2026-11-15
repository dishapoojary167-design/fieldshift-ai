import type { DataProvenance } from './common.ts';

export type CropSeasonType =
  | 'kharif'
  | 'rabi'
  | 'zaid'
  | 'perennial'
  | 'annual'
  | 'wet'
  | 'dry';

export type ToleranceLevel = 'low' | 'moderate' | 'high';

export type CropCategory =
  | 'cereal'
  | 'millet'
  | 'pulse'
  | 'oilseed'
  | 'fiber'
  | 'cash_crop'
  | 'vegetable'
  | 'fodder';

export interface CropProfile {
  id: string;
  commonName: string;
  scientificName: string;
  localNames: Record<string, string>;
  category: CropCategory;
  nitrogenFixer: boolean;
  rootingDepthCm: [number, number];
  growthDurationDays: [number, number];
  waterRequirementMm: [number, number];
  optimalTemperatureC: [number, number];
  optimalSoilPh: [number, number];
  preferredSoilTextures: string[];
  droughtTolerance: ToleranceLevel;
  heatTolerance: ToleranceLevel;
  waterloggingTolerance: ToleranceLevel;
  regionScopes: string[];
  agronomicNotes?: string;
}

export interface CropCalendarEntry {
  id: string;
  cropId: string;
  countryCode: string;
  regionCode: string;
  agroClimaticZone: string;
  season: CropSeasonType;
  sowingWindowMonths: [number, number];
  harvestingWindowMonths: [number, number];
  sowingWindowLabel: string;
  harvestingWindowLabel: string;
  criticalGrowthStages: string[];
}

export interface RotationRule {
  id: string;
  countryCode: string;
  regionCode: string;
  title: string;
  ruleType:
    | 'nitrogen_replenishment'
    | 'pest_disease_break'
    | 'moisture_conservation'
    | 'root_zone_diversification'
    | 'climate_risk_hedging';
  precedingCategories: CropCategory[];
  recommendedFollowingCategories: CropCategory[];
  excludedImmediateRepeats?: string[];
  rationale: string;
  soilHealthImpact: string;
}

export interface CropRecommendationDriver {
  factor: string;
  signal: 'positive' | 'neutral' | 'caution' | 'risk';
  detail: string;
}

export interface CropRecommendation {
  id: string;
  farmId: string;
  cropId: string;
  cropName: string;
  season: CropSeasonType;
  suitabilityScore: number;
  confidence: number;
  waterBudgetEstimateMm: number;
  drivers: CropRecommendationDriver[];
  climaticRisks: string[];
  agronomicRationale: string;
  provenance: DataProvenance[];
}

export interface RotationSequenceStep {
  stepOrder: number;
  yearOffset: number;
  season: CropSeasonType;
  cropId: string;
  cropName: string;
  agronomicPurpose: string;
  expectedSoilNitrogenImpact: 'enriching' | 'neutral' | 'depleting';
  diseaseBreakBenefit: string;
}

export interface RotationPlan {
  id: string;
  farmId: string;
  regionCode: string;
  horizonSeasons: number;
  steps: RotationSequenceStep[];
  overallSustainabilityScore: number;
  waterResilienceSummary: string;
  soilHealthSummary: string;
  generatedAt: string;
  provenance: DataProvenance[];
}
