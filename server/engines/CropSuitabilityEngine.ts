import type {
  CropEnvironmentalInputs,
  CropFactorScore,
  CropGrowingSeason,
  CropIntelligenceResult,
  CropKnowledgeProfile,
  CropRecommendationPreferences,
  CropSuitabilityOption,
  DataConfidenceDetail,
  FactorDataSourceType,
  FarmEnvironmentalContext,
  FarmEnvironmentalDataSourceSummary,
  FarmEnvironmentalObservationRecord,
  GeoCoordinates,
  GpmImergRainfallObservation,
  HardConstraintViolation,
  PillarFactorWeights,
  PreferenceAdjustmentNote,
  SeasonalSuitabilityDetail,
  SoilBoundaryContext,
  SoilCompatibilityDetail,
  SpatialProcessingMetadata,
  SuitabilityCategoryLabel,
  SuitabilityFactorId,
  SuitabilityScoringWeights,
  SupportingEnvironmentalObservation,
  WaterRequirementDetail,
} from '../../shared/index.ts';

export const ENGINE_VERSION = 'fieldshift-deterministic-suitability-v1.1';
export const SUITABILITY_VS_YIELD_DISCLAIMER =
  'Suitability scores (0–100) measure agro-environmental and agronomic compatibility against ICAR/KVK crop thresholds. They are NOT crop yield predictions (tonnes/ha), which additionally depend on cultivar genetics, sowing date precision, pest pressure, and field management.';

export const DEFAULT_SUITABILITY_WEIGHTS: SuitabilityScoringWeights = {
  temperature: 0.16,
  rainfall: 0.16,
  soilMoisture: 0.1,
  soilPh: 0.14,
  soilTexture: 0.1,
  organicCarbon: 0.08,
  waterRequirement: 0.14,
  growingSeason: 0.12,
};

interface CropMoistureAndSocRange {
  moistOptMin: number;
  moistOptMax: number;
  moistTolMin: number;
  moistTolMax: number;
  ocOptMinGKg: number;
  ocModMinGKg: number;
  rangeNote: string;
}

const CROP_MOISTURE_AND_SOC_RANGES: Record<string, CropMoistureAndSocRange> = {
  rice: {
    moistOptMin: 0.3,
    moistOptMax: 0.48,
    moistTolMin: 0.22,
    moistTolMax: 0.55,
    ocOptMinGKg: 7.5,
    ocModMinGKg: 5.0,
    rangeNote: 'Lowland/puddled paddy optimal root-zone moisture 0.30–0.48 m³/m³; OC ≥ 7.5 g/kg',
  },
  wheat: {
    moistOptMin: 0.2,
    moistOptMax: 0.35,
    moistTolMin: 0.14,
    moistTolMax: 0.42,
    ocOptMinGKg: 7.5,
    ocModMinGKg: 5.0,
    rangeNote: 'Upland irrigated cereal moisture 0.20–0.35 m³/m³; OC ≥ 7.5 g/kg',
  },
  maize: {
    moistOptMin: 0.22,
    moistOptMax: 0.35,
    moistTolMin: 0.15,
    moistTolMax: 0.41,
    ocOptMinGKg: 7.5,
    ocModMinGKg: 5.0,
    rangeNote: 'Drainage-sensitive cereal moisture 0.22–0.35 m³/m³ (stress > 0.41); OC ≥ 7.5 g/kg',
  },
  soybean: {
    moistOptMin: 0.2,
    moistOptMax: 0.34,
    moistTolMin: 0.14,
    moistTolMax: 0.41,
    ocOptMinGKg: 7.0,
    ocModMinGKg: 4.5,
    rangeNote: 'Vertisol/loam upland moisture 0.20–0.34 m³/m³ (waterlogging > 0.41); OC ≥ 7.0 g/kg',
  },
  chickpea: {
    moistOptMin: 0.16,
    moistOptMax: 0.29,
    moistTolMin: 0.11,
    moistTolMax: 0.37,
    ocOptMinGKg: 6.0,
    ocModMinGKg: 4.0,
    rangeNote: 'Conserved-moisture Rabi pulse 0.16–0.29 m³/m³ (wilt risk > 0.37); OC ≥ 6.0 g/kg',
  },
  pigeonpea: {
    moistOptMin: 0.17,
    moistOptMax: 0.31,
    moistTolMin: 0.11,
    moistTolMax: 0.38,
    ocOptMinGKg: 6.0,
    ocModMinGKg: 4.0,
    rangeNote: 'Deep-rooted pulse 0.17–0.31 m³/m³ (Phytophthora blight > 0.38); OC ≥ 6.0 g/kg',
  },
  groundnut: {
    moistOptMin: 0.16,
    moistOptMax: 0.3,
    moistTolMin: 0.11,
    moistTolMax: 0.37,
    ocOptMinGKg: 6.0,
    ocModMinGKg: 4.0,
    rangeNote: 'Friable sandy-loam pegging moisture 0.16–0.30 m³/m³; OC ≥ 6.0 g/kg',
  },
  'indian-mustard': {
    moistOptMin: 0.16,
    moistOptMax: 0.3,
    moistTolMin: 0.11,
    moistTolMax: 0.38,
    ocOptMinGKg: 6.0,
    ocModMinGKg: 4.0,
    rangeNote: 'Rabi oilseed moisture 0.16–0.30 m³/m³; OC ≥ 6.0 g/kg',
  },
  sorghum: {
    moistOptMin: 0.14,
    moistOptMax: 0.31,
    moistTolMin: 0.09,
    moistTolMax: 0.4,
    ocOptMinGKg: 5.0,
    ocModMinGKg: 3.0,
    rangeNote: 'Semi-arid C4 millet moisture 0.14–0.31 m³/m³; OC ≥ 5.0 g/kg',
  },
  'pearl-millet': {
    moistOptMin: 0.1,
    moistOptMax: 0.26,
    moistTolMin: 0.07,
    moistTolMax: 0.36,
    ocOptMinGKg: 4.5,
    ocModMinGKg: 2.5,
    rangeNote: 'Arid sandy-soil millet moisture 0.10–0.26 m³/m³ (waterlogging > 0.36); OC ≥ 4.5 g/kg',
  },
  'finger-millet': {
    moistOptMin: 0.16,
    moistOptMax: 0.32,
    moistTolMin: 0.1,
    moistTolMax: 0.4,
    ocOptMinGKg: 5.5,
    ocModMinGKg: 3.5,
    rangeNote: 'Rainfed plateau/hill millet moisture 0.16–0.32 m³/m³; OC ≥ 5.5 g/kg',
  },
};

const DEFAULT_MOISTURE_AND_SOC: CropMoistureAndSocRange = {
  moistOptMin: 0.18,
  moistOptMax: 0.33,
  moistTolMin: 0.12,
  moistTolMax: 0.4,
  ocOptMinGKg: 6.5,
  ocModMinGKg: 4.0,
  rangeNote: 'Standard agronomic upland moisture 0.18–0.33 m³/m³; OC ≥ 6.5 g/kg',
};

const TEXTURE_COMPATIBILITY_MAP: Record<string, string[]> = {
  clay: ['clay loam', 'silty clay', 'silty clay loam'],
  'clay loam': ['loam', 'silty clay loam', 'sandy clay loam', 'clay', 'silt loam'],
  loam: ['clay loam', 'silt loam', 'sandy loam', 'sandy clay loam'],
  'sandy loam': ['loam', 'loamy sand', 'sandy clay loam'],
  'loamy sand': ['sandy loam', 'sand'],
  sand: ['loamy sand', 'sandy loam'],
  'silt loam': ['loam', 'clay loam', 'silty clay loam', 'silt'],
  'silty clay loam': ['clay loam', 'silt loam', 'silty clay'],
  'sandy clay loam': ['clay loam', 'sandy loam', 'loam'],
  'silty clay': ['clay', 'silty clay loam', 'clay loam'],
  'sandy clay': ['clay loam', 'sandy clay loam'],
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function interpolateLinear(
  value: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (x1 === x0) return y1;
  const t = (value - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * Scores values inside an ICAR optimal [min, max] band between 93 (at edges) and 100 (at center),
 * providing deterministic centrality differentiation without penalizing valid optimal values.
 */
function scoreOptimalBand(value: number, optMin: number, optMax: number): number {
  const halfWidth = (optMax - optMin) / 2;
  if (halfWidth <= 0) return 100;
  const center = (optMin + optMax) / 2;
  const normalizedDist = Math.min(1, Math.abs(value - center) / halfWidth);
  return 93 + 7 * (1 - normalizedDist);
}

export function mapPillarWeightsToGranular(
  pillarWeights?: Partial<PillarFactorWeights>,
): Partial<SuitabilityScoringWeights> | undefined {
  if (!pillarWeights) {
    return undefined;
  }

  const hasAny = Object.values(pillarWeights).some((v) => v !== undefined);
  if (!hasAny) {
    return undefined;
  }

  const waterAvail = pillarWeights.waterAvailability;
  const soilHealth = pillarWeights.soilHealth;

  return {
    ...(pillarWeights.temperature !== undefined ? { temperature: pillarWeights.temperature } : {}),
    ...(waterAvail !== undefined
      ? {
          rainfall: waterAvail * 0.4,
          soilMoisture: waterAvail * 0.25,
          waterRequirement: waterAvail * 0.35,
        }
      : {}),
    ...(pillarWeights.soilPh !== undefined ? { soilPh: pillarWeights.soilPh } : {}),
    ...(soilHealth !== undefined
      ? {
          soilTexture: soilHealth * 0.55,
          organicCarbon: soilHealth * 0.45,
        }
      : {}),
    ...(pillarWeights.seasonalCompatibility !== undefined
      ? { growingSeason: pillarWeights.seasonalCompatibility }
      : {}),
  };
}

export function normalizeSuitabilityWeights(
  overrides?: Partial<SuitabilityScoringWeights>,
  pillarOverrides?: Partial<PillarFactorWeights>,
  preferences?: CropRecommendationPreferences,
): SuitabilityScoringWeights {
  const mappedPillars = mapPillarWeightsToGranular(pillarOverrides);
  const merged: SuitabilityScoringWeights = {
    temperature:
      overrides?.temperature ?? mappedPillars?.temperature ?? DEFAULT_SUITABILITY_WEIGHTS.temperature,
    rainfall: overrides?.rainfall ?? mappedPillars?.rainfall ?? DEFAULT_SUITABILITY_WEIGHTS.rainfall,
    soilMoisture:
      overrides?.soilMoisture ?? mappedPillars?.soilMoisture ?? DEFAULT_SUITABILITY_WEIGHTS.soilMoisture,
    soilPh: overrides?.soilPh ?? mappedPillars?.soilPh ?? DEFAULT_SUITABILITY_WEIGHTS.soilPh,
    soilTexture:
      overrides?.soilTexture ?? mappedPillars?.soilTexture ?? DEFAULT_SUITABILITY_WEIGHTS.soilTexture,
    organicCarbon:
      overrides?.organicCarbon ??
      mappedPillars?.organicCarbon ??
      DEFAULT_SUITABILITY_WEIGHTS.organicCarbon,
    waterRequirement:
      overrides?.waterRequirement ??
      mappedPillars?.waterRequirement ??
      DEFAULT_SUITABILITY_WEIGHTS.waterRequirement,
    growingSeason:
      overrides?.growingSeason ??
      mappedPillars?.growingSeason ??
      DEFAULT_SUITABILITY_WEIGHTS.growingSeason,
  };

  if (preferences?.waterConservationPriority === 'high') {
    merged.waterRequirement *= 1.35;
    merged.rainfall *= 1.2;
  }
  if (preferences?.soilImprovementPriority === 'high') {
    merged.organicCarbon *= 1.4;
    merged.soilTexture *= 1.15;
  }

  const sum = Object.values(merged).reduce((acc, w) => acc + Math.max(0, w), 0);
  if (sum <= 0) {
    return { ...DEFAULT_SUITABILITY_WEIGHTS };
  }

  return {
    temperature: Number((Math.max(0, merged.temperature) / sum).toFixed(4)),
    rainfall: Number((Math.max(0, merged.rainfall) / sum).toFixed(4)),
    soilMoisture: Number((Math.max(0, merged.soilMoisture) / sum).toFixed(4)),
    soilPh: Number((Math.max(0, merged.soilPh) / sum).toFixed(4)),
    soilTexture: Number((Math.max(0, merged.soilTexture) / sum).toFixed(4)),
    organicCarbon: Number((Math.max(0, merged.organicCarbon) / sum).toFixed(4)),
    waterRequirement: Number((Math.max(0, merged.waterRequirement) / sum).toFixed(4)),
    growingSeason: Number((Math.max(0, merged.growingSeason) / sum).toFixed(4)),
  };
}

interface ResolvedRainfallEstimate {
  seasonalMm: number | null;
  source: FactorDataSourceType;
  note: string;
  isProvisionalScale: boolean;
}

function resolveSeasonalRainfall(inputs: CropEnvironmentalInputs): ResolvedRainfallEstimate {
  if (inputs.seasonalRainfallMm !== undefined && inputs.seasonalRainfallMm !== null) {
    return {
      seasonalMm: inputs.seasonalRainfallMm,
      source: 'observed_historical',
      note: 'Direct seasonal rainfall observation',
      isProvisionalScale: false,
    };
  }

  const obsMm = inputs.observedRainfallMm;
  const obsDays = inputs.observationDays;

  if (obsMm !== undefined && obsMm !== null && obsDays !== undefined && obsDays !== null) {
    if (obsDays >= 85) {
      return {
        seasonalMm: obsMm,
        source: 'observed_historical',
        note: `Observed cumulative rainfall over ${obsDays} days`,
        isProvisionalScale: false,
      };
    }
    if (obsDays >= 30 && inputs.annualRainfallMm === undefined) {
      const scaled = Number(((obsMm / obsDays) * 110).toFixed(1));
      return {
        seasonalMm: scaled,
        source: 'observed_historical',
        note: `Extrapolated 110-day seasonal equivalent from ${obsMm.toFixed(1)} mm observed over ${obsDays} days`,
        isProvisionalScale: true,
      };
    }
  }

  if (inputs.annualRainfallMm !== undefined && inputs.annualRainfallMm !== null) {
    const seasonFactor =
      inputs.targetSeason === 'Kharif'
        ? 0.75
        : inputs.targetSeason === 'Rabi'
          ? 0.15
          : inputs.targetSeason === 'Zaid' || inputs.targetSeason === 'Summer'
            ? 0.1
            : 0.5;
    const estMm = Number((inputs.annualRainfallMm * seasonFactor).toFixed(1));
    return {
      seasonalMm: estMm,
      source: 'observed_historical',
      note: `Derived ${Math.round(seasonFactor * 100)}% seasonal share from NASA POWER multi-year annual mean (${inputs.annualRainfallMm.toFixed(0)} mm/yr)`,
      isProvisionalScale: true,
    };
  }

  return {
    seasonalMm: null,
    source: 'unavailable',
    note: 'Seasonal rainfall totals unavailable',
    isProvisionalScale: false,
  };
}

function scoreTemperatureFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  weight: number,
): { factor: CropFactorScore; violation?: HardConstraintViolation } {
  const tempReq = crop.temperatureRequirements.value;
  if (!tempReq) {
    return {
      factor: {
        factorId: 'temperature',
        label: 'Temperature',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        cropSuitabilityRange: 'Crop temperature bounds unavailable',
        dataSource: 'unavailable',
        explanation: 'Crop temperature specification is unavailable in knowledge base.',
      },
    };
  }

  const rangeStr = `${tempReq.optimalMinC}–${tempReq.optimalMaxC} °C (min germ ${tempReq.germinationMinC ?? 'N/A'} °C, heat stress >${tempReq.heatStressThresholdC ?? 'N/A'} °C)`;

  if (inputs.temperatureMeanC === undefined || inputs.temperatureMeanC === null) {
    return {
      factor: {
        factorId: 'temperature',
        label: 'Temperature',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: '°C',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation: 'Mean air temperature was not available for this evaluation window.',
      },
    };
  }

  const meanC = inputs.temperatureMeanC;
  const maxC = inputs.temperatureMaxC ?? null;
  const minC = inputs.temperatureMinC ?? null;
  const germMin = tempReq.germinationMinC ?? tempReq.optimalMinC - 6;
  const heatMax = tempReq.heatStressThresholdC ?? tempReq.optimalMaxC + 6;

  let score: number;
  if (meanC >= tempReq.optimalMinC && meanC <= tempReq.optimalMaxC) {
    score = scoreOptimalBand(meanC, tempReq.optimalMinC, tempReq.optimalMaxC);
  } else if (meanC < tempReq.optimalMinC) {
    if (meanC >= germMin) {
      score = interpolateLinear(meanC, germMin, 42, tempReq.optimalMinC, 93);
    } else {
      score = interpolateLinear(meanC, germMin - 5, 0, germMin, 42);
    }
  } else {
    if (meanC <= heatMax) {
      score = interpolateLinear(meanC, tempReq.optimalMaxC, 93, heatMax, 42);
    } else {
      score = interpolateLinear(meanC, heatMax, 42, heatMax + 5, 0);
    }
  }

  let heatNote = '';
  if (maxC !== null && tempReq.heatStressThresholdC !== null && maxC > tempReq.heatStressThresholdC) {
    const excess = maxC - tempReq.heatStressThresholdC;
    const penalty = Math.min(30, excess * 4.5);
    score -= penalty;
    heatNote = ` Peak Tmax ${maxC.toFixed(1)} °C exceeds heat-stress threshold (${tempReq.heatStressThresholdC} °C).`;
  }

  const finalScore = clampScore(score);
  let violation: HardConstraintViolation | undefined;

  if (meanC > heatMax + 4) {
    violation = {
      code: 'EXTREME_TEMPERATURE',
      factorId: 'temperature',
      message: `Mean temperature (${meanC.toFixed(1)} °C) exceeds ${crop.cropName}'s severe heat threshold (>${(heatMax + 4).toFixed(1)} °C).`,
    };
  } else if (meanC < germMin - 4) {
    violation = {
      code: 'EXTREME_TEMPERATURE',
      factorId: 'temperature',
      message: `Mean temperature (${meanC.toFixed(1)} °C) is below ${crop.cropName}'s viable thermal floor (<${(germMin - 4).toFixed(1)} °C).`,
    };
  } else if (
    minC !== null &&
    minC < 0 &&
    tempReq.frostSensitivity.toLowerCase().includes('high')
  ) {
    violation = {
      code: 'EXTREME_TEMPERATURE',
      factorId: 'temperature',
      message: `Sub-zero Tmin (${minC.toFixed(1)} °C) violates frost-free requirement for ${crop.cropName}.`,
    };
  }

  const explanation =
    finalScore >= 80
      ? `Observed mean ${meanC.toFixed(1)} °C aligns cleanly with ${crop.cropName}'s optimal ${tempReq.optimalMinC}–${tempReq.optimalMaxC} °C window.${heatNote}`
      : `Observed mean ${meanC.toFixed(1)} °C falls outside ${crop.cropName}'s optimal ${tempReq.optimalMinC}–${tempReq.optimalMaxC} °C window.${heatNote}`;

  return {
    factor: {
      factorId: 'temperature',
      label: 'Temperature',
      status: 'evaluated',
      score: finalScore,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: `${meanC.toFixed(1)} °C`,
      observedNumeric: meanC,
      unit: '°C',
      cropSuitabilityRange: rangeStr,
      dataSource: 'observed_historical',
      explanation,
    },
    violation,
  };
}

function scoreRainfallFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  resolved: ResolvedRainfallEstimate,
  weight: number,
): { factor: CropFactorScore; violation?: HardConstraintViolation } {
  const waterReq = crop.waterRequirements.value;
  if (!waterReq) {
    return {
      factor: {
        factorId: 'rainfall',
        label: 'Rainfall',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        cropSuitabilityRange: 'Crop water bounds unavailable',
        dataSource: 'unavailable',
        explanation: 'Crop seasonal rainfall requirement is unavailable.',
      },
    };
  }

  const rangeStr = `${waterReq.seasonalMinMm}–${waterReq.seasonalMaxMm} mm/season (${waterReq.category} demand)`;

  if (resolved.seasonalMm === null) {
    return {
      factor: {
        factorId: 'rainfall',
        label: 'Rainfall',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: 'mm',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation:
          'Seasonal rainfall observation is missing or window too brief to evaluate full-season rainfall fit.',
      },
    };
  }

  const rainMm = resolved.seasonalMm;
  const irrigated = inputs.irrigationAvailable === true;
  let score: number;

  if (rainMm >= waterReq.seasonalMinMm && rainMm <= waterReq.seasonalMaxMm) {
    score = scoreOptimalBand(rainMm, waterReq.seasonalMinMm, waterReq.seasonalMaxMm);
  } else if (rainMm < waterReq.seasonalMinMm) {
    const rawDeficitScore =
      rainMm >= waterReq.seasonalMinMm * 0.65
        ? interpolateLinear(rainMm, waterReq.seasonalMinMm * 0.65, 45, waterReq.seasonalMinMm, 93)
        : interpolateLinear(rainMm, waterReq.seasonalMinMm * 0.25, 0, waterReq.seasonalMinMm * 0.65, 45);
    // Available irrigation offsets rainfall shortfall substantially while retaining water-efficiency signal
    score = irrigated ? rawDeficitScore + (96 - rawDeficitScore) * 0.82 : rawDeficitScore;
  } else {
    const highWaterloggingSens = waterReq.waterloggingSensitivity.toLowerCase().includes('high');
    const upperCap = highWaterloggingSens ? waterReq.seasonalMaxMm * 1.55 : waterReq.seasonalMaxMm * 1.9;
    const minScoreAtCap = highWaterloggingSens ? 35 : 70;
    score = interpolateLinear(rainMm, waterReq.seasonalMaxMm, 93, upperCap, minScoreAtCap);
  }

  const finalScore = clampScore(score);
  let violation: HardConstraintViolation | undefined;

  if (!irrigated && inputs.irrigationAvailable === false && rainMm < waterReq.seasonalMinMm * 0.55) {
    violation = {
      code: 'SEVERE_WATER_DEFICIT',
      factorId: 'rainfall',
      message: `Seasonal rainfall (${rainMm.toFixed(0)} mm) is below 55% of ${crop.cropName}'s minimum ${waterReq.seasonalMinMm} mm requirement without irrigation.`,
    };
  }

  const explanation = `${rainMm.toFixed(0)} mm (${resolved.note}) vs. ${crop.cropName}'s ${waterReq.seasonalMinMm}–${waterReq.seasonalMaxMm} mm/season range.${irrigated && rainMm < waterReq.seasonalMinMm ? ' Deficit partially buffered by available irrigation.' : ''}`;

  return {
    factor: {
      factorId: 'rainfall',
      label: 'Rainfall',
      status: 'evaluated',
      score: finalScore,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: `${rainMm.toFixed(0)} mm`,
      observedNumeric: rainMm,
      unit: 'mm',
      cropSuitabilityRange: rangeStr,
      dataSource: resolved.source,
      explanation,
    },
    violation,
  };
}

function scoreSoilMoistureFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  weight: number,
): { factor: CropFactorScore } {
  const ranges = CROP_MOISTURE_AND_SOC_RANGES[crop.id] ?? DEFAULT_MOISTURE_AND_SOC;
  const moisture = inputs.soilMoistureM3M3 ?? inputs.soilMoistureSurfaceM3M3 ?? null;

  if (moisture === null || moisture === undefined) {
    return {
      factor: {
        factorId: 'soilMoisture',
        label: 'Soil Moisture (SMAP)',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: 'm³/m³',
        cropSuitabilityRange: ranges.rangeNote,
        dataSource: 'unavailable',
        explanation: 'NASA SMAP surface/root-zone soil moisture observation is unavailable for this parcel.',
      },
    };
  }

  let score: number;
  if (moisture >= ranges.moistOptMin && moisture <= ranges.moistOptMax) {
    score = scoreOptimalBand(moisture, ranges.moistOptMin, ranges.moistOptMax);
  } else if (moisture < ranges.moistOptMin) {
    score =
      moisture >= ranges.moistTolMin
        ? interpolateLinear(moisture, ranges.moistTolMin, 55, ranges.moistOptMin, 93)
        : interpolateLinear(moisture, Math.max(0.02, ranges.moistTolMin - 0.08), 15, ranges.moistTolMin, 55);
  } else {
    score =
      moisture <= ranges.moistTolMax
        ? interpolateLinear(moisture, ranges.moistOptMax, 93, ranges.moistTolMax, 50)
        : interpolateLinear(moisture, ranges.moistTolMax, 50, Math.min(0.65, ranges.moistTolMax + 0.1), 15);
  }

  const finalScore = clampScore(score);
  const labelPrefix =
    inputs.soilMoistureM3M3 !== null && inputs.soilMoistureM3M3 !== undefined
      ? 'Root-zone'
      : 'Surface';

  const explanation =
    moisture > ranges.moistTolMax
      ? `${labelPrefix} moisture ${moisture.toFixed(3)} m³/m³ indicates excess saturation risk for ${crop.cropName} (optimal ${ranges.moistOptMin.toFixed(2)}–${ranges.moistOptMax.toFixed(2)} m³/m³).`
      : moisture < ranges.moistTolMin
        ? `${labelPrefix} moisture ${moisture.toFixed(3)} m³/m³ indicates dry topsoil/root-zone conditions relative to ${crop.cropName}'s ${ranges.moistOptMin.toFixed(2)}–${ranges.moistOptMax.toFixed(2)} m³/m³ window.`
        : `${labelPrefix} moisture ${moisture.toFixed(3)} m³/m³ fits ${crop.cropName}'s moisture window (${ranges.moistOptMin.toFixed(2)}–${ranges.moistOptMax.toFixed(2)} m³/m³).`;

  return {
    factor: {
      factorId: 'soilMoisture',
      label: 'Soil Moisture (SMAP)',
      status: 'evaluated',
      score: finalScore,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: `${moisture.toFixed(3)} m³/m³`,
      observedNumeric: moisture,
      unit: 'm³/m³',
      cropSuitabilityRange: ranges.rangeNote,
      dataSource: 'satellite_derived',
      explanation,
    },
  };
}

function scoreSoilPhFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  weight: number,
): { factor: CropFactorScore; violation?: HardConstraintViolation } {
  const soilPref = crop.soilPreferences.value;
  if (!soilPref) {
    return {
      factor: {
        factorId: 'soilPh',
        label: 'Soil pH',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: 'pH',
        cropSuitabilityRange: 'Unavailable',
        dataSource: 'unavailable',
        explanation: 'Crop pH bounds unavailable.',
      },
    };
  }

  const rangeStr = `${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)} pH`;
  if (inputs.soilPh === undefined || inputs.soilPh === null) {
    return {
      factor: {
        factorId: 'soilPh',
        label: 'Soil pH',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: 'pH',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation: 'Neither laboratory soil pH nor SoilGrids modelled pH was available.',
      },
    };
  }

  const ph = inputs.soilPh;
  const source: FactorDataSourceType = inputs.soilPhSource ?? 'modelled_estimate';
  let score: number;
  if (ph >= soilPref.phMin && ph <= soilPref.phMax) {
    score = scoreOptimalBand(ph, soilPref.phMin, soilPref.phMax);
  } else if (ph < soilPref.phMin) {
    score = 93 - (soilPref.phMin - ph) * 42;
  } else {
    score = 93 - (ph - soilPref.phMax) * 42;
  }

  const finalScore = clampScore(score);
  let violation: HardConstraintViolation | undefined;
  if (ph < soilPref.phMin - 1.2 || ph > soilPref.phMax + 1.2) {
    violation = {
      code: 'EXTREME_SOIL_PH',
      factorId: 'soilPh',
      message: `Soil pH (${ph.toFixed(1)}) is >1.2 pH units outside ${crop.cropName}'s ${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)} range.`,
    };
  }

  const explanation =
    finalScore === 100
      ? `Soil pH ${ph.toFixed(1)} lies directly within ${crop.cropName}'s optimal ${rangeStr} range.`
      : `Soil pH ${ph.toFixed(1)} deviates from ${crop.cropName}'s optimal ${rangeStr} range.`;

  return {
    factor: {
      factorId: 'soilPh',
      label: 'Soil pH',
      status: 'evaluated',
      score: finalScore,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: `${ph.toFixed(1)} pH`,
      observedNumeric: ph,
      unit: 'pH',
      cropSuitabilityRange: rangeStr,
      dataSource: source,
      explanation,
    },
    violation,
  };
}

function scoreSoilTextureFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  weight: number,
): { factor: CropFactorScore } {
  const soilPref = crop.soilPreferences.value;
  if (!soilPref) {
    return {
      factor: {
        factorId: 'soilTexture',
        label: 'Soil Texture',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        cropSuitabilityRange: 'Unavailable',
        dataSource: 'unavailable',
        explanation: 'Crop texture preference unavailable.',
      },
    };
  }

  const rangeStr = soilPref.preferredTextures.join(' / ');
  if (!inputs.soilTexture) {
    return {
      factor: {
        factorId: 'soilTexture',
        label: 'Soil Texture',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation: 'USDA soil texture class is unavailable from SoilGrids or laboratory records.',
      },
    };
  }

  const observed = inputs.soilTexture.trim();
  const observedNorm = observed.toLowerCase();
  const preferredNorms = soilPref.preferredTextures.map((t) => t.toLowerCase());
  const source: FactorDataSourceType = inputs.soilTextureSource ?? 'modelled_estimate';

  let score: number;
  let note: string;

  if (preferredNorms.includes(observedNorm)) {
    score = 100;
    note = `${observed} is a primary ICAR-recommended soil texture for ${crop.cropName}.`;
  } else {
    const adjacent = TEXTURE_COMPATIBILITY_MAP[observedNorm] ?? [];
    const isAdjacent = preferredNorms.some((p) => adjacent.includes(p));
    if (isAdjacent) {
      score = 75;
      note = `${observed} is adjacent to ${crop.cropName}'s preferred textures (${rangeStr}) and generally manageable.`;
    } else if (
      (observedNorm === 'clay' && !preferredNorms.includes('clay')) ||
      (observedNorm === 'sand' && preferredNorms.includes('clay'))
    ) {
      score = 25;
      note = `${observed} presents drainage or retention conflict against ${crop.cropName}'s preferred textures (${rangeStr}).`;
    } else {
      score = 50;
      note = `${observed} is moderately suitable compared to ${crop.cropName}'s preferred textures (${rangeStr}).`;
    }
  }

  return {
    factor: {
      factorId: 'soilTexture',
      label: 'Soil Texture',
      status: 'evaluated',
      score,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: observed,
      cropSuitabilityRange: rangeStr,
      dataSource: source,
      explanation: note,
    },
  };
}

function scoreOrganicCarbonFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  weight: number,
): { factor: CropFactorScore } {
  const ranges = CROP_MOISTURE_AND_SOC_RANGES[crop.id] ?? DEFAULT_MOISTURE_AND_SOC;
  const rangeStr = `Optimal ≥ ${ranges.ocOptMinGKg.toFixed(1)} g/kg (moderate ≥ ${ranges.ocModMinGKg.toFixed(1)} g/kg)`;

  if (inputs.organicCarbonGKg === undefined || inputs.organicCarbonGKg === null) {
    return {
      factor: {
        factorId: 'organicCarbon',
        label: 'Soil Organic Carbon',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        unit: 'g/kg',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation: 'Soil organic carbon (g/kg) was not available from lab test or SoilGrids.',
      },
    };
  }

  const oc = inputs.organicCarbonGKg;
  const source: FactorDataSourceType = inputs.organicCarbonSource ?? 'modelled_estimate';
  let score: number;

  if (oc >= ranges.ocOptMinGKg) {
    score = 100;
  } else if (oc >= ranges.ocModMinGKg) {
    score = interpolateLinear(oc, ranges.ocModMinGKg, 68, ranges.ocOptMinGKg, 99);
  } else {
    score = interpolateLinear(oc, 0.5, 25, ranges.ocModMinGKg, 68);
  }

  const finalScore = clampScore(score);
  const explanation =
    finalScore >= 85
      ? `Soil organic carbon (${oc.toFixed(1)} g/kg) supports strong fertility and moisture retention for ${crop.cropName}.`
      : `Soil organic carbon (${oc.toFixed(1)} g/kg) is below ${crop.cropName}'s ≥${ranges.ocOptMinGKg.toFixed(1)} g/kg fertility target; FYM/compost incorporation advised.`;

  return {
    factor: {
      factorId: 'organicCarbon',
      label: 'Soil Organic Carbon',
      status: 'evaluated',
      score: finalScore,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: `${oc.toFixed(1)} g/kg`,
      observedNumeric: oc,
      unit: 'g/kg',
      cropSuitabilityRange: rangeStr,
      dataSource: source,
      explanation,
    },
  };
}

function scoreWaterRequirementFactor(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  resolvedRain: ResolvedRainfallEstimate,
  weight: number,
): { factor: CropFactorScore; violation?: HardConstraintViolation } {
  const waterReq = crop.waterRequirements.value;
  const irrReq = crop.irrigationNeeds.value;

  if (!waterReq || !irrReq) {
    return {
      factor: {
        factorId: 'waterRequirement',
        label: 'Crop Water & Irrigation Fit',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unavailable',
        cropSuitabilityRange: 'Unavailable',
        dataSource: 'unavailable',
        explanation: 'Crop water demand or rainfed viability metadata is unavailable.',
      },
    };
  }

  const rangeStr = `${waterReq.category.toUpperCase()} demand (${waterReq.seasonalMinMm}–${waterReq.seasonalMaxMm} mm) · Rainfed viability: ${irrReq.rainfedViability}`;

  if (inputs.irrigationAvailable === undefined && resolvedRain.seasonalMm === null) {
    return {
      factor: {
        factorId: 'waterRequirement',
        label: 'Crop Water & Irrigation Fit',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Irrigation & rainfall unspecified',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation:
          'Neither irrigation availability nor seasonal rainfall is known to assess crop water demand balance.',
      },
    };
  }

  let score: number;
  let observedStr: string;
  let explanation: string;
  let violation: HardConstraintViolation | undefined;

  if (inputs.irrigationAvailable === true) {
    observedStr =
      resolvedRain.seasonalMm !== null
        ? `Irrigated + ${resolvedRain.seasonalMm.toFixed(0)} mm rain`
        : 'Irrigated';
    score = waterReq.category === 'low' ? 92 : waterReq.category === 'moderate' ? 96 : 90;
    explanation = `Supplemental irrigation satisfies ${crop.cropName}'s critical moisture stages (${irrReq.criticalGrowthStages.slice(0, 2).join(', ')}).`;
  } else if (inputs.irrigationAvailable === false) {
    observedStr =
      resolvedRain.seasonalMm !== null
        ? `Rainfed only (${resolvedRain.seasonalMm.toFixed(0)} mm)`
        : 'Rainfed only';

    if (irrReq.rainfedViability === 'low') {
      score = 15;
      explanation = `${crop.cropName} has low rainfed viability and requires reliable irrigation.`;
      violation = {
        code: 'SEVERE_WATER_DEFICIT',
        factorId: 'waterRequirement',
        message: `${crop.cropName} has low rainfed viability (${irrReq.recommendedIrrigationsRange ? `${irrReq.recommendedIrrigationsRange[0]}–${irrReq.recommendedIrrigationsRange[1]} irrigations required` : 'irrigated system'}), incompatible with strictly rainfed management.`,
      };
    } else if (irrReq.rainfedViability === 'moderate') {
      const rainRatio =
        resolvedRain.seasonalMm !== null ? resolvedRain.seasonalMm / waterReq.seasonalMinMm : 0.85;
      score = clampScore(55 + (rainRatio - 0.8) * 60);
      explanation = `${crop.cropName} has moderate rainfed viability; yield stability depends on timely rainfall at critical stages.`;
    } else {
      const rainRatio =
        resolvedRain.seasonalMm !== null ? resolvedRain.seasonalMm / waterReq.seasonalMinMm : 1.0;
      score = clampScore(waterReq.category === 'low' ? Math.min(100, 78 + rainRatio * 20) : Math.min(95, 68 + rainRatio * 22));
      explanation = `${crop.cropName} has high rainfed viability (${waterReq.category} seasonal water duty).`;
    }
  } else {
    // Irrigation unspecified, infer cautiously from seasonal rainfall
    const rainMm = resolvedRain.seasonalMm!;
    observedStr = `${rainMm.toFixed(0)} mm rain (irrigation unspecified)`;
    if (rainMm >= waterReq.seasonalMinMm) {
      score = 88;
      explanation = `Estimated rainfall (${rainMm.toFixed(0)} mm) meets ${crop.cropName}'s ${waterReq.seasonalMinMm} mm floor even without confirming irrigation.`;
    } else if (irrReq.rainfedViability === 'low') {
      score = 35;
      explanation = `Rainfall (${rainMm.toFixed(0)} mm) is below ${crop.cropName}'s ${waterReq.seasonalMinMm} mm requirement and irrigation availability is unconfirmed.`;
    } else {
      score = 62;
      explanation = `Rainfall (${rainMm.toFixed(0)} mm) is modest relative to ${crop.cropName}'s demand; verify protective irrigation access.`;
    }
  }

  return {
    factor: {
      factorId: 'waterRequirement',
      label: 'Crop Water & Irrigation Fit',
      status: 'evaluated',
      score,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: observedStr,
      unit: 'mm',
      cropSuitabilityRange: rangeStr,
      dataSource: inputs.irrigationAvailable !== undefined ? 'user_input' : resolvedRain.source,
      explanation,
    },
    violation,
  };
}

function scoreGrowingSeasonFactor(
  crop: CropKnowledgeProfile,
  targetSeason: CropGrowingSeason | undefined,
  weight: number,
): { factor: CropFactorScore; violation?: HardConstraintViolation } {
  const seasons = crop.growingSeasons.value ?? [];
  const rangeStr = seasons.length > 0 ? seasons.join(' / ') : 'Unavailable';

  if (!targetSeason) {
    return {
      factor: {
        factorId: 'growingSeason',
        label: 'Growing Season',
        status: 'missing',
        score: null,
        weight,
        effectiveWeight: 0,
        weightedContribution: null,
        observedValue: 'Unspecified',
        cropSuitabilityRange: rangeStr,
        dataSource: 'unavailable',
        explanation: 'Target growing season (Kharif, Rabi, Zaid, or Summer) was not specified.',
      },
    };
  }

  const matched = seasons.includes(targetSeason);
  if (matched) {
    return {
      factor: {
        factorId: 'growingSeason',
        label: 'Growing Season',
        status: 'evaluated',
        score: 100,
        weight,
        effectiveWeight: weight,
        weightedContribution: null,
        observedValue: targetSeason,
        cropSuitabilityRange: rangeStr,
        dataSource: 'user_input',
        explanation: `${crop.cropName} is an ICAR-documented ${targetSeason} season crop.`,
      },
    };
  }

  return {
    factor: {
      factorId: 'growingSeason',
      label: 'Growing Season',
      status: 'evaluated',
      score: 0,
      weight,
      effectiveWeight: weight,
      weightedContribution: null,
      observedValue: targetSeason,
      cropSuitabilityRange: rangeStr,
      dataSource: 'user_input',
      explanation: `${crop.cropName} is documented for ${rangeStr} only, not ${targetSeason}.`,
    },
    violation: {
      code: 'INCOMPATIBLE_SEASON',
      factorId: 'growingSeason',
      message: `${crop.cropName} is not cultivated in ${targetSeason} (documented seasons: ${rangeStr}).`,
    },
  };
}

function checkRegionConstraint(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  strictRegionFilter: boolean,
): HardConstraintViolation | undefined {
  if (!strictRegionFilter || (!inputs.agroClimaticZoneId && !inputs.state)) {
    return undefined;
  }

  const entries = crop.regionalSuitability.value ?? [];
  if (inputs.agroClimaticZoneId) {
    const zoneMatch = entries.some(
      (e) => e.agroClimaticZoneId.toLowerCase() === inputs.agroClimaticZoneId!.toLowerCase(),
    );
    if (!zoneMatch) {
      return {
        code: 'UNSUPPORTED_REGION',
        factorId: 'region',
        message: `${crop.cropName} has no primary ICAR/KVK regional suitability record for agro-climatic zone '${inputs.agroClimaticZoneId}'.`,
      };
    }
  }

  if (inputs.state) {
    const stateMatch = entries.some((e) =>
      e.states.some((s) => s.toLowerCase() === inputs.state!.toLowerCase()),
    );
    if (!stateMatch) {
      return {
        code: 'UNSUPPORTED_REGION',
        factorId: 'region',
        message: `${crop.cropName} is not listed as a primary ICAR/KVK recommended crop for state '${inputs.state}'.`,
      };
    }
  }

  return undefined;
}

function toSuitabilityCategory(band: CropSuitabilityOption['suitabilityBand']): SuitabilityCategoryLabel {
  switch (band) {
    case 'high':
      return 'Highly Suitable';
    case 'moderate':
      return 'Moderately Suitable';
    case 'marginal':
      return 'Marginally Suitable';
    case 'unsuitable':
      return 'Unsuitable';
    default:
      return 'Insufficient Data';
  }
}

function formatSourceLabel(source: FactorDataSourceType): string {
  switch (source) {
    case 'observed_historical':
      return 'NASA POWER / GPM';
    case 'satellite_derived':
      return 'NASA SMAP / Satellite';
    case 'modelled_estimate':
      return 'ISRIC SoilGrids v2.0';
    case 'measured_lab':
      return 'Laboratory Soil Test';
    case 'user_input':
      return 'Farm / User Input';
    default:
      return 'Unavailable';
  }
}

function findContextRecord(
  environmentalContext: FarmEnvironmentalContext | undefined,
  parameterId: string,
): FarmEnvironmentalObservationRecord | undefined {
  return environmentalContext?.observations.find((o) => o.parameterId === parameterId);
}

function buildSupportingObservations(
  inputs: CropEnvironmentalInputs,
  resolvedRain: ResolvedRainfallEstimate,
  gpmImergObservation?: GpmImergRainfallObservation | null,
  environmentalContext?: FarmEnvironmentalContext,
): SupportingEnvironmentalObservation[] {
  const recMeta = (paramId: string, fallbackRes?: string) => {
    const rec = findContextRecord(environmentalContext, paramId);
    if (!rec) {
      return {
        spatialResolution: fallbackRes,
        observationPeriod: environmentalContext?.dateRange
          ? `${environmentalContext.dateRange.startDate} to ${environmentalContext.dateRange.endDate}`
          : undefined,
      };
    }
    return {
      spatialResolution: rec.spatialResolution.label,
      observationPeriod: rec.observationPeriod,
      observationTimestamp: rec.observationTimestamp,
      datasetId: rec.datasetId,
      isRepresentative: rec.isRepresentative,
      representativenessNote: rec.representativenessNote,
      stalenessNote: rec.staleness.isStale
        ? rec.staleness.note ?? 'Stale observation'
        : undefined,
    };
  };

  const soilMoistureValue = inputs.soilMoistureM3M3 ?? inputs.soilMoistureSurfaceM3M3;
  const soilMoistureParamId =
    inputs.soilMoistureRootZoneM3M3 !== undefined && inputs.soilMoistureRootZoneM3M3 !== null
      ? 'soilMoistureRootZoneM3M3'
      : 'soilMoistureSurfaceM3M3';

  const obs: SupportingEnvironmentalObservation[] = [
    {
      parameter: 'temperatureMeanC',
      label: 'Mean Air Temperature (2m)',
      observedValue:
        inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null
          ? `${inputs.temperatureMeanC.toFixed(1)} °C`
          : 'Unavailable',
      unit: '°C',
      status:
        inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null
          ? 'observed_historical'
          : 'unavailable',
      sourceLabel:
        inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null
          ? 'NASA POWER T2M'
          : 'Unavailable',
      ...recMeta('temperatureMeanC', '0.5° × 0.5° (~55 km grid)'),
    },
    {
      parameter: 'seasonalRainfallMm',
      label: 'Seasonal / Climate Rainfall',
      observedValue:
        resolvedRain.seasonalMm !== null ? `${resolvedRain.seasonalMm.toFixed(0)} mm` : 'Unavailable',
      unit: 'mm',
      status: resolvedRain.seasonalMm !== null ? 'available' : 'missing',
      dataSource: resolvedRain.source,
      sourceLabel:
        resolvedRain.seasonalMm !== null ? `NASA POWER (${resolvedRain.note})` : 'Unavailable',
      ...recMeta('observedRainfallMm', '0.5° × 0.5° (~55 km grid)'),
    },
    {
      parameter: 'relativeHumidityPercent',
      label: 'Relative Humidity (2m)',
      observedValue:
        inputs.relativeHumidityPercent !== undefined && inputs.relativeHumidityPercent !== null
          ? `${inputs.relativeHumidityPercent.toFixed(1)} %`
          : 'Unavailable',
      unit: '%',
      status:
        inputs.relativeHumidityPercent !== undefined && inputs.relativeHumidityPercent !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.relativeHumidityPercent !== undefined && inputs.relativeHumidityPercent !== null
          ? 'observed_historical'
          : 'unavailable',
      sourceLabel:
        inputs.relativeHumidityPercent !== undefined && inputs.relativeHumidityPercent !== null
          ? 'NASA POWER RH2M'
          : 'Unavailable',
      ...recMeta('relativeHumidityPercent', '0.5° × 0.5° (~55 km grid)'),
    },
    {
      parameter: 'solarRadiationMjM2Day',
      label: 'Solar Radiation (Insolation)',
      observedValue:
        inputs.solarRadiationMjM2Day !== undefined && inputs.solarRadiationMjM2Day !== null
          ? `${inputs.solarRadiationMjM2Day.toFixed(2)} MJ/m²/day`
          : 'Unavailable',
      unit: 'MJ/m²/day',
      status:
        inputs.solarRadiationMjM2Day !== undefined && inputs.solarRadiationMjM2Day !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.solarRadiationMjM2Day !== undefined && inputs.solarRadiationMjM2Day !== null
          ? 'observed_historical'
          : 'unavailable',
      sourceLabel:
        inputs.solarRadiationMjM2Day !== undefined && inputs.solarRadiationMjM2Day !== null
          ? 'NASA POWER ALLSKY_SFC_SW_DWN'
          : 'Unavailable',
      ...recMeta('solarRadiationMjM2Day', '0.5° × 0.5° (~55 km grid)'),
    },
    {
      parameter: 'windSpeedMs',
      label: 'Wind Speed (2m)',
      observedValue:
        inputs.windSpeedMs !== undefined && inputs.windSpeedMs !== null
          ? `${inputs.windSpeedMs.toFixed(2)} m/s`
          : 'Unavailable',
      unit: 'm/s',
      status:
        inputs.windSpeedMs !== undefined && inputs.windSpeedMs !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.windSpeedMs !== undefined && inputs.windSpeedMs !== null
          ? 'observed_historical'
          : 'unavailable',
      sourceLabel:
        inputs.windSpeedMs !== undefined && inputs.windSpeedMs !== null
          ? 'NASA POWER WS2M'
          : 'Unavailable',
      ...recMeta('windSpeedMs', '0.5° × 0.5° (~55 km grid)'),
    },
    {
      parameter: 'gpmPrecipitationRateMmHr',
      label: 'Satellite Rainfall Rate (GPM IMERG)',
      observedValue:
        inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null
          ? `${inputs.gpmPrecipitationRateMmHr.toFixed(2)} mm/hr`
          : gpmImergObservation?.message
            ? 'Unavailable (NoData)'
            : 'Unavailable',
      unit: 'mm/hr',
      status:
        inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null
          ? 'satellite_derived'
          : 'unavailable',
      sourceLabel:
        inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null
          ? 'NASA GPM IMERG'
          : 'Unavailable',
      ...recMeta('gpmPrecipitationRateMmHr', '0.1° × 0.1° (~11 km grid)'),
    },
    {
      parameter: 'soilMoistureM3M3',
      label: 'Soil Moisture (Surface / Root Zone)',
      observedValue:
        soilMoistureValue !== undefined && soilMoistureValue !== null
          ? `${soilMoistureValue.toFixed(3)} m³/m³`
          : 'Unavailable',
      unit: 'm³/m³',
      status:
        soilMoistureValue !== undefined && soilMoistureValue !== null ? 'available' : 'missing',
      dataSource:
        soilMoistureValue !== undefined && soilMoistureValue !== null
          ? 'satellite_derived'
          : 'unavailable',
      sourceLabel:
        soilMoistureValue !== undefined && soilMoistureValue !== null ? 'NASA SMAP' : 'Unavailable',
      ...recMeta(soilMoistureParamId, '9 km × 9 km (EASE-Grid 2.0)'),
    },
    {
      parameter: 'soilPh',
      label: 'Topsoil pH (0–5 cm)',
      observedValue:
        inputs.soilPh !== undefined && inputs.soilPh !== null
          ? `${inputs.soilPh.toFixed(1)} pH`
          : 'Unavailable',
      unit: 'pH',
      status: inputs.soilPh !== undefined && inputs.soilPh !== null ? 'available' : 'missing',
      dataSource:
        inputs.soilPh !== undefined && inputs.soilPh !== null
          ? (inputs.soilPhSource ?? 'modelled_estimate')
          : 'unavailable',
      sourceLabel:
        inputs.soilPh !== undefined && inputs.soilPh !== null
          ? formatSourceLabel(inputs.soilPhSource ?? 'modelled_estimate')
          : 'Unavailable',
      ...recMeta('soilPh', '250 m × 250 m digital soil map grid'),
    },
    {
      parameter: 'soilTexture',
      label: 'Soil Texture Class',
      observedValue: inputs.soilTexture ? inputs.soilTexture : 'Unavailable',
      status: inputs.soilTexture ? 'available' : 'missing',
      dataSource: inputs.soilTexture
        ? (inputs.soilTextureSource ?? 'modelled_estimate')
        : 'unavailable',
      sourceLabel: inputs.soilTexture
        ? formatSourceLabel(inputs.soilTextureSource ?? 'modelled_estimate')
        : 'Unavailable',
      ...recMeta('soilTexture', '250 m × 250 m digital soil map grid'),
    },
    {
      parameter: 'organicCarbonGKg',
      label: 'Soil Organic Carbon',
      observedValue:
        inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null
          ? `${inputs.organicCarbonGKg.toFixed(1)} g/kg`
          : 'Unavailable',
      unit: 'g/kg',
      status:
        inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null
          ? 'available'
          : 'missing',
      dataSource:
        inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null
          ? (inputs.organicCarbonSource ?? 'modelled_estimate')
          : 'unavailable',
      sourceLabel:
        inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null
          ? formatSourceLabel(inputs.organicCarbonSource ?? 'modelled_estimate')
          : 'Unavailable',
      ...recMeta('organicCarbonGKg', '250 m × 250 m digital soil map grid'),
    },
    {
      parameter: 'etDailyWm2',
      label: 'Daily Evapotranspiration (ET)',
      observedValue:
        inputs.etDailyWm2 !== undefined && inputs.etDailyWm2 !== null
          ? `${inputs.etDailyWm2.toFixed(1)} W/m²`
          : 'Unavailable',
      unit: 'W/m²',
      status: inputs.etDailyWm2 !== undefined && inputs.etDailyWm2 !== null ? 'available' : 'missing',
      dataSource: inputs.etDailyWm2 !== undefined && inputs.etDailyWm2 !== null ? 'satellite_derived' : 'unavailable',
      sourceLabel: inputs.etDailyWm2 !== undefined && inputs.etDailyWm2 !== null ? 'NASA ECOSTRESS (ECO_L3T_JET)' : 'Unavailable',
      ...recMeta('etDailyWm2', '70 m × 70 m thermal grid'),
    },
    {
      parameter: 'esiRatio',
      label: 'Evaporative Stress Index (ESI)',
      observedValue:
        inputs.esiRatio !== undefined && inputs.esiRatio !== null
          ? `${inputs.esiRatio.toFixed(3)} Ratio (0–1)`
          : 'Unavailable',
      unit: 'Ratio (0–1)',
      status: inputs.esiRatio !== undefined && inputs.esiRatio !== null ? 'available' : 'missing',
      dataSource: inputs.esiRatio !== undefined && inputs.esiRatio !== null ? 'satellite_derived' : 'unavailable',
      sourceLabel: inputs.esiRatio !== undefined && inputs.esiRatio !== null ? 'NASA ECOSTRESS (ECO_L4T_ESI)' : 'Unavailable',
      ...recMeta('esiRatio', '70 m × 70 m thermal grid'),
    },
    {
      parameter: 'ndvi',
      label: 'Vegetation Index (NDVI)',
      observedValue:
        inputs.ndvi !== undefined && inputs.ndvi !== null
          ? `${inputs.ndvi.toFixed(3)}`
          : 'Unavailable',
      unit: 'Index Ratio (-1 to 1)',
      status: inputs.ndvi !== undefined && inputs.ndvi !== null ? 'available' : 'missing',
      dataSource: inputs.ndvi !== undefined && inputs.ndvi !== null ? 'satellite_derived' : 'unavailable',
      sourceLabel: inputs.ndvi !== undefined && inputs.ndvi !== null ? 'NASA Harmonized Landsat Sentinel-2 (HLS)' : 'Unavailable',
      ...recMeta('ndvi', '30 m × 30 m surface reflectance grid'),
    },
    {
      parameter: 'ndwi',
      label: 'Water Index (NDWI)',
      observedValue:
        inputs.ndwi !== undefined && inputs.ndwi !== null
          ? `${inputs.ndwi.toFixed(3)}`
          : 'Unavailable',
      unit: 'Index Ratio (-1 to 1)',
      status: inputs.ndwi !== undefined && inputs.ndwi !== null ? 'available' : 'missing',
      dataSource: inputs.ndwi !== undefined && inputs.ndwi !== null ? 'satellite_derived' : 'unavailable',
      sourceLabel: inputs.ndwi !== undefined && inputs.ndwi !== null ? 'NASA Harmonized Landsat Sentinel-2 (HLS)' : 'Unavailable',
      ...recMeta('ndwi', '30 m × 30 m surface reflectance grid'),
    },
  ];

  return obs;
}

const OBSERVATION_TO_FACTOR_MAP: Record<string, SuitabilityFactorId> = {
  temperatureMeanC: 'temperature',
  seasonalRainfallMm: 'rainfall',
  soilMoistureM3M3: 'soilMoisture',
  soilPh: 'soilPh',
  soilTexture: 'soilTexture',
  organicCarbonGKg: 'organicCarbon',
};

function enrichObservationsForCrop(
  baseObservations: SupportingEnvironmentalObservation[],
  factorScores: CropFactorScore[],
): SupportingEnvironmentalObservation[] {
  const factorById = new Map(factorScores.map((f) => [f.factorId, f]));

  return baseObservations.map((obs) => {
    if (obs.status === 'missing') {
      return { ...obs, influenceOnRecommendation: 'missing' };
    }
    const factorId = OBSERVATION_TO_FACTOR_MAP[obs.parameter];
    const factor = factorId ? factorById.get(factorId) : undefined;
    if (!factor || factor.status === 'missing' || factor.score === null) {
      return { ...obs, influenceOnRecommendation: 'neutral' };
    }
    const influence: SupportingEnvironmentalObservation['influenceOnRecommendation'] =
      factor.score >= 78 ? 'positive' : factor.score < 55 ? 'limiting' : 'neutral';
    return { ...obs, influenceOnRecommendation: influence };
  });
}

function buildFallbackDataSources(
  inputs: CropEnvironmentalInputs,
  resolvedRain: ResolvedRainfallEstimate,
): FarmEnvironmentalDataSourceSummary[] {
  const sources: FarmEnvironmentalDataSourceSummary[] = [];

  if (
    inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null ||
    resolvedRain.seasonalMm !== null
  ) {
    sources.push({
      id: 'nasa-power',
      name: 'NASA POWER Daily Weather',
      dataset: 'T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, WS2M',
      spatialResolution: '0.5° × 0.5° (~55 km)',
      role: 'Historical temperature, cumulative rainfall, humidity, solar radiation, and wind speed',
      isFresh: true,
      limitations: 'Coarse ~55 km regional grid; reflects historical observations, not future forecasts.',
    });
  }

  if (inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null) {
    sources.push({
      id: 'nasa-gpm-imerg',
      name: 'NASA GPM IMERG Precipitation',
      dataset: 'GPM_3IMERGDF Late Run',
      spatialResolution: '0.1° × 0.1° (~11 km)',
      role: 'Satellite-derived precipitation rate (mm/hr)',
      isFresh: true,
      limitations: '~11 km satellite footprint snapshot; distinct from seasonal rainfall totals.',
    });
  }

  if (
    (inputs.soilMoistureM3M3 !== undefined && inputs.soilMoistureM3M3 !== null) ||
    (inputs.soilMoistureSurfaceM3M3 !== undefined && inputs.soilMoistureSurfaceM3M3 !== null)
  ) {
    sources.push({
      id: 'nasa-smap',
      name: 'NASA SMAP Soil Moisture',
      dataset: 'SPL3SMP_E / SPL4SMGP',
      spatialResolution: '9 km × 9 km (EASE-Grid 2.0)',
      role: 'Volumetric soil moisture (m³/m³)',
      isFresh: true,
      limitations: '9 km grid moisture only; does not resolve field irrigation heterogeneity or soil NPK/pH.',
    });
  }

  if (inputs.etDailyWm2 !== undefined && inputs.etDailyWm2 !== null || inputs.esiRatio !== undefined && inputs.esiRatio !== null) {
    sources.push({
      id: 'nasa-ecostress',
      name: 'NASA ECOSTRESS Evapotranspiration',
      dataset: 'ECO_L3T_JET / ECO_L4T_ESI',
      spatialResolution: '70 m × 70 m thermal grid',
      role: 'High-resolution evapotranspiration and evaporative stress index',
      isFresh: true,
      limitations: 'Clear-sky thermal observations; cloud-masked pixels excluded.',
    });
  }

  if (inputs.ndvi !== undefined && inputs.ndvi !== null || inputs.ndwi !== undefined && inputs.ndwi !== null) {
    sources.push({
      id: 'nasa-hls',
      name: 'NASA Harmonized Landsat Sentinel-2 (HLS)',
      dataset: 'HLSL30 / HLSS30 Surface Reflectance (NDVI, NDWI)',
      spatialResolution: '30 m × 30 m surface reflectance grid',
      role: 'Vegetation greenness (NDVI) and canopy water index (NDWI)',
      isFresh: true,
      limitations: 'Cloud/shadow filtered via Fmask QA; optical observations require clear skies.',
    });
  }

  const soilSource =
    inputs.soilPhSource ?? inputs.soilTextureSource ?? inputs.organicCarbonSource;
  if (
    inputs.soilPh !== undefined && inputs.soilPh !== null ||
    inputs.soilTexture ||
    (inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null)
  ) {
    const isLab = soilSource === 'measured_lab';
    const isUser = soilSource === 'user_input';
    sources.push({
      id: isLab ? 'farm-lab-test' : isUser ? 'user-field-input' : 'isric-soilgrids',
      name: isLab
        ? 'Verified Laboratory Soil Test'
        : isUser
          ? 'Farm / User Field Input'
          : 'ISRIC SoilGrids REST v2.0',
      dataset: isLab
        ? 'Point Field Laboratory Analysis'
        : isUser
          ? 'Manual Field Entry'
          : 'ISRIC SoilGrids 2020 (pH, USDA Texture, SOC)',
      spatialResolution: isLab || isUser ? 'Point field sample' : '250 m × 250 m digital soil map',
      role: 'Topsoil pH, USDA texture, and soil organic carbon',
      isFresh: true,
      limitations: isLab
        ? 'Valid for sampled depth and horizon.'
        : isUser
          ? 'User-entered field parameter.'
          : 'Modelled 250 m spatial estimate; verify with local laboratory soil testing.',
    });
  }

  return sources;
}

function buildSoilCompatibility(
  crop: CropKnowledgeProfile,
  phFactor: CropFactorScore,
  textureFactor: CropFactorScore,
  ocFactor: CropFactorScore,
): SoilCompatibilityDetail {
  const soilPref = crop.soilPreferences.value;
  return {
    summary:
      phFactor.status === 'missing' && textureFactor.status === 'missing'
        ? `Soil profile data unavailable to verify ${crop.cropName}'s ${soilPref ? `${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)} pH` : ''} preference.`
        : `${phFactor.explanation} ${textureFactor.explanation}`.trim(),
    phFit: phFactor.explanation,
    textureFit: textureFactor.explanation,
    soilHealthNote: ocFactor.explanation,
    drainageNote: soilPref?.drainageRequirement ?? 'Standard drainage requirements apply.',
  };
}

function buildSeasonalSuitability(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
  seasonFactor: CropFactorScore,
): SeasonalSuitabilityDetail {
  const documentedSeasons = crop.growingSeasons.value ?? [];
  const targetSeason = inputs.targetSeason ?? null;
  const matchesTargetSeason = targetSeason ? documentedSeasons.includes(targetSeason) : true;
  const regionalEntries = crop.regionalSuitability.value ?? [];

  const matchedRegionEntry =
    regionalEntries.find(
      (e) =>
        (!inputs.agroClimaticZoneId ||
          e.agroClimaticZoneId.toLowerCase() === inputs.agroClimaticZoneId.toLowerCase()) &&
        (!inputs.state || e.states.some((s) => s.toLowerCase() === inputs.state!.toLowerCase())) &&
        (!targetSeason || e.primarySeason === targetSeason),
    ) ??
    regionalEntries.find((e) => !targetSeason || e.primarySeason === targetSeason) ??
    regionalEntries[0];

  const duration = crop.growingDuration.value;

  return {
    targetSeason,
    matchesTargetSeason,
    documentedSeasons,
    sowingWindow: matchedRegionEntry?.typicalSowingWindow ?? null,
    durationDaysRange: duration ? [duration.minDays, duration.maxDays] : null,
    summary: matchedRegionEntry
      ? `${seasonFactor.explanation} Typical sowing window: ${matchedRegionEntry.typicalSowingWindow}.`
      : seasonFactor.explanation,
  };
}

function buildWaterRequirementDetail(
  crop: CropKnowledgeProfile,
  preferences: CropRecommendationPreferences,
): WaterRequirementDetail {
  const waterReq = crop.waterRequirements.value;
  const irrReq = crop.irrigationNeeds.value;
  const category = waterReq?.category ?? 'moderate';

  let conservationFitNote =
    category === 'low'
      ? `Strong fit for water conservation (${waterReq?.seasonalMinMm ?? 0}–${waterReq?.seasonalMaxMm ?? 0} mm seasonal duty).`
      : category === 'moderate'
        ? `Moderate seasonal water requirement (${waterReq?.seasonalMinMm ?? 0}–${waterReq?.seasonalMaxMm ?? 0} mm).`
        : `High seasonal water demand (${waterReq?.seasonalMinMm ?? 0}–${waterReq?.seasonalMaxMm ?? 0} mm); less suitable when conserving water.`;

  if (preferences.waterConservationPriority === 'high' && category === 'high') {
    conservationFitNote += ' Conflicts with high water conservation priority.';
  }

  return {
    category,
    seasonalMinMm: waterReq?.seasonalMinMm ?? null,
    seasonalMaxMm: waterReq?.seasonalMaxMm ?? null,
    rainfedViability: irrReq?.rainfedViability ?? 'unknown',
    droughtTolerance: waterReq?.droughtTolerance ?? 'Unspecified',
    waterloggingSensitivity: waterReq?.waterloggingSensitivity ?? 'Unspecified',
    conservationFitNote,
  };
}

function computePreferenceAdjustments(
  crop: CropKnowledgeProfile,
  allCrops: CropKnowledgeProfile[],
  preferences: CropRecommendationPreferences,
): { adjustments: PreferenceAdjustmentNote[]; advantages: string[]; cautions: string[] } {
  const adjustments: PreferenceAdjustmentNote[] = [];
  const advantages: string[] = [];
  const cautions: string[] = [];

  const waterCategory = crop.waterRequirements.value?.category ?? 'moderate';
  if (preferences.waterConservationPriority === 'high') {
    if (waterCategory === 'low') {
      adjustments.push({
        factor: 'Water Conservation Priority',
        delta: 5,
        reason: `${crop.cropName} is a low-water crop aligned with high water conservation priority.`,
      });
      advantages.push(
        `Water Conservation Alignment (+5): Low seasonal water duty fits water-saving goals.`,
      );
    } else if (waterCategory === 'high') {
      adjustments.push({
        factor: 'Water Conservation Priority',
        delta: -8,
        reason: `${crop.cropName} has high seasonal water demand, penalized under high water conservation priority.`,
      });
      cautions.push(
        `Water Conservation Trade-off (-8): High seasonal water requirement conflicts with conservation priority.`,
      );
    }
  }

  const fixesN = Boolean(crop.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen);
  if (preferences.soilImprovementPriority === 'high') {
    if (fixesN) {
      adjustments.push({
        factor: 'Soil Improvement Priority',
        delta: 6,
        reason: `${crop.cropName} fixes atmospheric nitrogen and improves soil organic matter status.`,
      });
      advantages.push(
        `Soil Improvement Alignment (+6): Atmospheric nitrogen fixation builds soil fertility.`,
      );
    } else if (crop.cropGroup === 'Cereal') {
      adjustments.push({
        factor: 'Soil Improvement Priority',
        delta: -3,
        reason: `${crop.cropName} is a nutrient-extractive cereal without biological N fixation.`,
      });
      cautions.push(
        `Soil Improvement Note (-3): Non-legume cereal requires balanced nutrient replenishment.`,
      );
    }
  }

  const currentCropRaw = preferences.currentCrop?.trim().toLowerCase();
  if (currentCropRaw) {
    const matchedCurrent = allCrops.find(
      (c) =>
        c.id.toLowerCase() === currentCropRaw ||
        c.cropName.toLowerCase() === currentCropRaw ||
        c.localNames.some((n) => n.toLowerCase() === currentCropRaw),
    );
    const currentFamily = matchedCurrent?.cropFamily.toLowerCase();
    const currentGroup = matchedCurrent?.cropGroup;
    const isSameCrop =
      crop.id.toLowerCase() === currentCropRaw ||
      crop.cropName.toLowerCase() === currentCropRaw ||
      (matchedCurrent !== undefined && crop.id === matchedCurrent.id);

    const rotCompat = crop.cropRotationCompatibility.value;
    const beneficialPredecessors = (rotCompat?.beneficialPrecedingCrops ?? []).map((s) =>
      s.toLowerCase(),
    );
    const matchesBeneficial =
      beneficialPredecessors.some((p) => p.includes(currentCropRaw)) ||
      (matchedCurrent !== undefined &&
        beneficialPredecessors.some((p) => p.includes(matchedCurrent.cropName.toLowerCase())));

    const divPref = preferences.diversificationPreference ?? 'moderate';

    if (isSameCrop) {
      const penalty = divPref === 'high' ? -16 : divPref === 'moderate' ? -10 : -4;
      adjustments.push({
        factor: 'Crop Diversification & Rotation',
        delta: penalty,
        reason: `Planting ${crop.cropName} continuously after ${preferences.currentCrop} increases pest, disease, and nutrient depletion risk.`,
      });
      cautions.push(
        `Monoculture Caution (${penalty}): Repeating ${crop.cropName} reduces crop diversification and pest break benefits.`,
      );
    } else if (
      currentFamily &&
      crop.cropFamily.toLowerCase() === currentFamily &&
      divPref !== 'low'
    ) {
      const penalty = divPref === 'high' ? -8 : -4;
      adjustments.push({
        factor: 'Crop Diversification & Rotation',
        delta: penalty,
        reason: `${crop.cropName} shares the ${crop.cropFamily} botanical family with current crop ${preferences.currentCrop}.`,
      });
      cautions.push(
        `Same-Family Rotation Caution (${penalty}): Shares ${crop.cropFamily} family with ${preferences.currentCrop}.`,
      );
    } else if (matchesBeneficial || (currentGroup && crop.cropGroup !== currentGroup)) {
      const bonus = divPref === 'high' ? 7 : divPref === 'moderate' ? 4 : 2;
      adjustments.push({
        factor: 'Crop Diversification & Rotation',
        delta: bonus,
        reason: `${crop.cropName} diversifies away from ${preferences.currentCrop}${fixesN ? ' while contributing biological nitrogen' : ''}.`,
      });
      advantages.push(
        `Diversification & Rotation Fit (+${bonus}): Beneficial succession following ${preferences.currentCrop}.`,
      );
    }
  }

  return { adjustments, advantages, cautions };
}

export interface EvaluateSuitabilityInput {
  location: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  inputs: CropEnvironmentalInputs;
  preferences?: CropRecommendationPreferences;
  weights?: Partial<SuitabilityScoringWeights>;
  pillarWeights?: Partial<PillarFactorWeights>;
  strictRegionFilter?: boolean;
  crops: CropKnowledgeProfile[];
  gpmImergObservation?: GpmImergRainfallObservation | null;
  environmentalContext?: FarmEnvironmentalContext;
  extraCaveats?: string[];
}

export function evaluateCropSuitability(
  params: EvaluateSuitabilityInput,
): CropIntelligenceResult {
  const {
    location,
    boundary,
    spatialProcessing,
    crops,
    gpmImergObservation,
    environmentalContext,
    extraCaveats = [],
  } = params;
  const rawInputs = params.inputs;
  const resolvedFarmingSystem =
    params.preferences?.farmingSystem ??
    rawInputs.farmingSystem ??
    (params.preferences?.irrigationAvailable === true || rawInputs.irrigationAvailable === true
      ? 'irrigated'
      : params.preferences?.irrigationAvailable === false || rawInputs.irrigationAvailable === false
        ? 'rainfed'
        : undefined);
  const resolvedIrrigation =
    params.preferences?.irrigationAvailable ??
    rawInputs.irrigationAvailable ??
    (resolvedFarmingSystem !== undefined ? resolvedFarmingSystem !== 'rainfed' : undefined);
  const resolvedSeason = params.preferences?.growingSeason ?? rawInputs.targetSeason;

  const preferences: CropRecommendationPreferences = {
    growingSeason: resolvedSeason,
    farmingSystem: resolvedFarmingSystem,
    irrigationAvailable: resolvedIrrigation,
    currentCrop: params.preferences?.currentCrop,
    waterConservationPriority: params.preferences?.waterConservationPriority ?? 'moderate',
    soilImprovementPriority: params.preferences?.soilImprovementPriority ?? 'moderate',
    diversificationPreference: params.preferences?.diversificationPreference ?? 'moderate',
  };

  const inputs: CropEnvironmentalInputs = {
    ...rawInputs,
    ...(resolvedSeason ? { targetSeason: resolvedSeason } : {}),
    ...(resolvedIrrigation !== undefined ? { irrigationAvailable: resolvedIrrigation } : {}),
    ...(resolvedFarmingSystem ? { farmingSystem: resolvedFarmingSystem } : {}),
  };

  const strictRegionFilter = params.strictRegionFilter ?? true;
  const appliedWeights = normalizeSuitabilityWeights(
    params.weights,
    params.pillarWeights,
    preferences,
  );
  const resolvedRain = resolveSeasonalRainfall(inputs);
  const supportingObservations = buildSupportingObservations(
    inputs,
    resolvedRain,
    gpmImergObservation,
    environmentalContext,
  );
  const dataSourcesUsed =
    environmentalContext?.dataSources ?? buildFallbackDataSources(inputs, resolvedRain);

  // Determine overall input completeness across the 8 evaluation dimensions
  const coreAvailability = {
    temperature: inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null,
    rainfall: resolvedRain.seasonalMm !== null,
    soilPh: inputs.soilPh !== undefined && inputs.soilPh !== null,
    soilTexture: Boolean(inputs.soilTexture && inputs.soilTexture.trim().length > 0),
    soilMoisture:
      (inputs.soilMoistureM3M3 !== undefined && inputs.soilMoistureM3M3 !== null) ||
      (inputs.soilMoistureSurfaceM3M3 !== undefined && inputs.soilMoistureSurfaceM3M3 !== null),
    organicCarbon: inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null,
    waterRequirement:
      inputs.irrigationAvailable !== undefined || resolvedRain.seasonalMm !== null,
    growingSeason: Boolean(inputs.targetSeason),
  };

  const globalMissingWarnings: string[] = [];
  if (!coreAvailability.temperature) {
    globalMissingWarnings.push('Air temperature (NASA POWER T2M) is missing.');
  }
  if (!coreAvailability.rainfall) {
    globalMissingWarnings.push(
      'Seasonal/annual rainfall (NASA POWER PRECTOTCORR) is missing or window too short.',
    );
  }
  if (!coreAvailability.soilPh) {
    globalMissingWarnings.push('Soil pH (lab test or ISRIC SoilGrids) is missing.');
  }
  if (!coreAvailability.soilTexture) {
    globalMissingWarnings.push('Soil texture class (lab test or ISRIC SoilGrids) is missing.');
  }
  if (!coreAvailability.soilMoisture) {
    globalMissingWarnings.push(
      'Soil moisture (NASA SMAP surface/root-zone m³/m³) is unavailable.',
    );
  }
  if (!coreAvailability.organicCarbon) {
    globalMissingWarnings.push('Soil organic carbon (g/kg) is missing.');
  }
  if (!coreAvailability.growingSeason) {
    globalMissingWarnings.push(
      'Target growing season (Kharif/Rabi/Zaid/Summer) was not specified.',
    );
  }
  if (inputs.irrigationAvailable === undefined) {
    globalMissingWarnings.push(
      'Farm irrigation availability (irrigated vs. rainfed) was not specified; water balance assessed conservatively.',
    );
  }
  if (resolvedRain.isProvisionalScale && resolvedRain.note) {
    globalMissingWarnings.push(`Provisional rainfall estimate: ${resolvedRain.note}.`);
  }

  const availableWeightSum = (Object.keys(appliedWeights) as SuitabilityFactorId[]).reduce(
    (sum, key) => sum + (coreAvailability[key] ? appliedWeights[key] : 0),
    0,
  );
  const dataCompletenessPercent = Math.round(availableWeightSum * 100);
  const missingDataPenaltyPoints = Math.round(Math.max(0, 1 - availableWeightSum) * 14);

  const coreFourCount = [
    coreAvailability.temperature,
    coreAvailability.rainfall,
    coreAvailability.soilPh,
    coreAvailability.soilTexture,
  ].filter(Boolean).length;

  // Hard essential-data safety check: refuse to recommend crops if fewer than 2 core factors exist
  const essentialBaselineMissing = coreFourCount < 2 || dataCompletenessPercent < 35;

  const overallUncertainty: 'low' | 'moderate' | 'high' =
    essentialBaselineMissing ||
    !coreAvailability.temperature ||
    !coreAvailability.rainfall ||
    !coreAvailability.soilPh ||
    !coreAvailability.growingSeason ||
    dataCompletenessPercent < 70
      ? 'high'
      : dataCompletenessPercent < 100 || inputs.irrigationAvailable === undefined
        ? 'moderate'
        : 'low';

  if (essentialBaselineMissing) {
    return {
      location,
      boundaryContext: boundary,
      spatialProcessing: spatialProcessing ?? environmentalContext?.spatialProcessing,
      generatedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      deterministicNoAiNotice:
        'Deterministic rule-and-range suitability engine (no LLM/Gemini inference).',
      suitabilityVsYieldDisclaimer: SUITABILITY_VS_YIELD_DISCLAIMER,
      evaluationStatus: 'insufficient_essential_data',
      evaluatedInputs: inputs,
      preferencesApplied: preferences,
      appliedWeights,
      dataCompletenessPercent,
      uncertaintyLevel: 'high',
      gpmImergObservation,
      environmentalContext,
      missingDataWarnings: [
        'Cannot generate reliable crop recommendations because fewer than 2 core environmental/soil parameters (temperature, rainfall, soil pH, soil texture) were available.',
        ...globalMissingWarnings,
      ],
      recommendations: [],
      excludedCrops: [],
      caveats: [
        'Fetch NASA POWER weather and ISRIC SoilGrids / lab soil measurements or provide observed farm inputs before evaluating crop suitability.',
        ...extraCaveats,
      ],
    };
  }

  const eligibleOptions: CropSuitabilityOption[] = [];
  const excludedOptions: CropSuitabilityOption[] = [];

  for (const crop of crops) {
    const tempEval = scoreTemperatureFactor(crop, inputs, appliedWeights.temperature);
    const rainEval = scoreRainfallFactor(crop, inputs, resolvedRain, appliedWeights.rainfall);
    const moistEval = scoreSoilMoistureFactor(crop, inputs, appliedWeights.soilMoisture);
    const phEval = scoreSoilPhFactor(crop, inputs, appliedWeights.soilPh);
    const textureEval = scoreSoilTextureFactor(crop, inputs, appliedWeights.soilTexture);
    const ocEval = scoreOrganicCarbonFactor(crop, inputs, appliedWeights.organicCarbon);
    const waterEval = scoreWaterRequirementFactor(
      crop,
      inputs,
      resolvedRain,
      appliedWeights.waterRequirement,
    );
    const seasonEval = scoreGrowingSeasonFactor(
      crop,
      inputs.targetSeason,
      appliedWeights.growingSeason,
    );

    const rawFactors: CropFactorScore[] = [
      tempEval.factor,
      rainEval.factor,
      moistEval.factor,
      phEval.factor,
      textureEval.factor,
      ocEval.factor,
      waterEval.factor,
      seasonEval.factor,
    ];

    const violations: HardConstraintViolation[] = [];
    for (const maybeViolation of [
      seasonEval.violation,
      checkRegionConstraint(crop, inputs, strictRegionFilter),
      tempEval.violation,
      phEval.violation,
      rainEval.violation,
      waterEval.violation,
    ]) {
      if (maybeViolation) {
        violations.push(maybeViolation);
      }
    }

    const evaluatedWeightTotal = rawFactors.reduce(
      (sum, f) => sum + (f.status === 'evaluated' ? f.weight : 0),
      0,
    );

    let weightedScoreSum = 0;
    const factorScores: CropFactorScore[] = rawFactors.map((f) => {
      if (f.status === 'missing' || f.score === null || evaluatedWeightTotal <= 0) {
        return {
          ...f,
          effectiveWeight: 0,
          weightedContribution: null,
        };
      }
      const effectiveWeight = Number((f.weight / evaluatedWeightTotal).toFixed(4));
      const weightedContribution = Number((f.score * effectiveWeight).toFixed(2));
      weightedScoreSum += weightedContribution;
      return {
        ...f,
        effectiveWeight,
        weightedContribution,
      };
    });

    const advantages: string[] = [];
    const disadvantages: string[] = [];
    const limitingFactors: string[] = [];
    const cropMissingWarnings: string[] = [];

    for (const f of factorScores) {
      if (f.status === 'missing') {
        cropMissingWarnings.push(`${f.label}: ${f.explanation}`);
      } else if (f.score !== null) {
        if (f.score >= 78) {
          advantages.push(`${f.label} (${f.score}/100): ${f.explanation}`);
        } else if (f.score >= 50) {
          disadvantages.push(`${f.label} (${f.score}/100): ${f.explanation}`);
        } else {
          limitingFactors.push(`${f.label} (${f.score}/100): ${f.explanation}`);
        }
      }
    }

    if (crop.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen) {
      const nFixVal = crop.nitrogenFixationCharacteristics.value;
      advantages.push(
        `Biological Nitrogen Fixation: Fixes atmospheric N via ${nFixVal.symbiontSpecies ?? 'Rhizobium'}, supporting succeeding cereal crops.`,
      );
    }

    const prefEval = computePreferenceAdjustments(crop, crops, preferences);
    advantages.push(...prefEval.advantages);
    disadvantages.push(...prefEval.cautions);

    for (const v of violations) {
      limitingFactors.unshift(`Hard Constraint [${v.code}]: ${v.message}`);
    }

    const prefDeltaSum = prefEval.adjustments.reduce((acc, adj) => acc + adj.delta, 0);
    const hasViolations = violations.length > 0;
    const computedScore = hasViolations
      ? 0
      : clampScore(weightedScoreSum - missingDataPenaltyPoints + prefDeltaSum);

    const suitabilityBand: CropSuitabilityOption['suitabilityBand'] = hasViolations
      ? 'unsuitable'
      : computedScore >= 78
        ? 'high'
        : computedScore >= 60
          ? 'moderate'
          : computedScore >= 40
            ? 'marginal'
            : 'unsuitable';

    const suitabilityCategory = toSuitabilityCategory(suitabilityBand);

    const eligibilityStatus: CropSuitabilityOption['eligibilityStatus'] = hasViolations
      ? 'excluded'
      : overallUncertainty === 'high'
        ? 'provisional_uncertain'
        : computedScore >= 72 && limitingFactors.length === 0
          ? 'recommended'
          : 'conditional';

    const dataConfidenceLevel: DataConfidenceDetail['level'] =
      overallUncertainty === 'low'
        ? 'high'
        : overallUncertainty === 'moderate'
          ? 'moderate'
          : 'low';

    const dataConfidence: DataConfidenceDetail = {
      score: Math.max(10, Math.min(100, dataCompletenessPercent - missingDataPenaltyPoints)),
      level: dataConfidenceLevel,
      completenessPercent: dataCompletenessPercent,
      missingDataPenaltyPoints,
      note:
        missingDataPenaltyPoints > 0
          ? `${dataCompletenessPercent}% weighted parameter coverage; ${missingDataPenaltyPoints}-point uncertainty penalty applied for missing inputs.`
          : '100% weighted environmental and soil parameter coverage.',
    };

    const cropSupportingObservations = enrichObservationsForCrop(
      supportingObservations,
      factorScores,
    );

    const staleObsNotes = (environmentalContext?.observations ?? [])
      .filter((o) => o.staleness.isStale && o.value !== null)
      .map(
        (o) =>
          `Stale ${o.parameterName} (${o.sourceProvider}): ${o.staleness.note ?? `aged ${o.staleness.ageDays} days`}.`,
      );

    const nonRepObsNotes = (environmentalContext?.observations ?? [])
      .filter((o) => !o.isRepresentative && o.value !== null)
      .map((o) => `Spatial representativeness warning for ${o.parameterName}: ${o.representativenessNote}`);

    const uncertainInputsList: string[] = [...cropMissingWarnings];
    if (resolvedRain.isProvisionalScale && resolvedRain.note) {
      uncertainInputsList.push(`Rainfall scale uncertainty: ${resolvedRain.note}.`);
    }
    if ((inputs.soilPhSource ?? 'modelled_estimate') === 'modelled_estimate' && inputs.soilPh !== null && inputs.soilPh !== undefined) {
      uncertainInputsList.push('Soil pH uses ISRIC SoilGrids 250 m modelled estimate rather than a point lab soil test.');
    }
    if ((inputs.soilTextureSource ?? 'modelled_estimate') === 'modelled_estimate' && inputs.soilTexture) {
      uncertainInputsList.push('Soil texture uses ISRIC SoilGrids 250 m modelled classification rather than lab particle-size analysis.');
    }
    if ((inputs.organicCarbonSource ?? 'modelled_estimate') === 'modelled_estimate' && inputs.organicCarbonGKg !== null && inputs.organicCarbonGKg !== undefined) {
      uncertainInputsList.push('Soil organic carbon uses ISRIC SoilGrids 250 m modelled estimate rather than lab test.');
    }
    uncertainInputsList.push(...staleObsNotes, ...nonRepObsNotes);

    const soilCompatibility = buildSoilCompatibility(crop, phEval.factor, textureEval.factor, ocEval.factor);
    const seasonalSuitability = buildSeasonalSuitability(crop, inputs, seasonEval.factor);
    const waterRequirementDetail = buildWaterRequirementDetail(crop, preferences);
    const rejectionReasons = violations.map((v) => v.message);
    const limitations = [
      ...limitingFactors,
      ...disadvantages,
      ...staleObsNotes,
      ...nonRepObsNotes,
      'Coarse satellite/reanalysis grids (NASA POWER ~55 km, GPM ~11 km, SMAP ~9 km) do not measure parcel-level micro-climate or sub-field variability.',
      'Evaluation uses historical and satellite observations, NOT future seasonal weather forecasts.',
    ];

    const summary = hasViolations
      ? `Excluded by ${violations.length} hard constraint(s): ${violations[0].message}`
      : `${crop.cropName} scored ${computedScore}/100 (${suitabilityBand} suitability${overallUncertainty === 'high' ? ', provisional due to missing essential data' : ''}).`;

    const positiveDrivers = factorScores
      .filter((f) => f.status === 'evaluated' && f.score !== null && f.score >= 75)
      .map((f) => `${f.label} (${f.observedValue}, ${formatSourceLabel(f.dataSource)}, score ${f.score}/100)`);

    const limitingDrivers = factorScores
      .filter((f) => f.status === 'evaluated' && f.score !== null && f.score < 60)
      .map((f) => `${f.label} (${f.observedValue}, ${formatSourceLabel(f.dataSource)}, score ${f.score}/100)`);

    const contextualMetrics: string[] = [];
    if (inputs.relativeHumidityPercent !== undefined && inputs.relativeHumidityPercent !== null) {
      contextualMetrics.push(`RH ${inputs.relativeHumidityPercent.toFixed(0)}%`);
    }
    if (inputs.solarRadiationMjM2Day !== undefined && inputs.solarRadiationMjM2Day !== null) {
      contextualMetrics.push(`Solar ${inputs.solarRadiationMjM2Day.toFixed(1)} MJ/m²/day`);
    }
    if (inputs.windSpeedMs !== undefined && inputs.windSpeedMs !== null) {
      contextualMetrics.push(`Wind ${inputs.windSpeedMs.toFixed(1)} m/s`);
    }
    if (inputs.gpmPrecipitationRateMmHr !== undefined && inputs.gpmPrecipitationRateMmHr !== null) {
      contextualMetrics.push(`GPM IMERG ${inputs.gpmPrecipitationRateMmHr.toFixed(2)} mm/hr`);
    }

    const explanationParts = [summary];
    if (positiveDrivers.length > 0) {
      explanationParts.push(`Supporting observations driving suitability: ${positiveDrivers.join('; ')}.`);
    }
    if (limitingDrivers.length > 0) {
      explanationParts.push(`Limiting observations lowering suitability: ${limitingDrivers.join('; ')}.`);
    }
    if (contextualMetrics.length > 0) {
      explanationParts.push(`Additional NASA atmospheric context observed: ${contextualMetrics.join(', ')}.`);
    }
    if (missingDataPenaltyPoints > 0) {
      explanationParts.push(
        `A ${missingDataPenaltyPoints}-point missing-data uncertainty penalty was applied due to ${cropMissingWarnings.length} unavailable input dimension(s).`,
      );
    }
    if (staleObsNotes.length > 0) {
      explanationParts.push(`Stale input notice: ${staleObsNotes.join(' ')}`);
    }
    if (prefEval.adjustments.length > 0) {
      explanationParts.push(
        `User preference alignment: ${prefEval.adjustments.map((a) => `${a.factor} (${a.delta >= 0 ? `+${a.delta}` : a.delta})`).join(', ')}.`,
      );
    }
    explanationParts.push('Note: Suitability reflects environmental fit against historical/satellite observations, not predicted yield or a weather forecast.');

    const option: CropSuitabilityOption = {
      rank: null,
      cropId: crop.id,
      cropName: crop.cropName,
      scientificName: crop.scientificName,
      cropGroup: crop.cropGroup,
      eligibilityStatus,
      suitabilityScore: computedScore,
      suitabilityBand,
      suitabilityCategory,
      dataCompletenessPercent,
      uncertaintyLevel: overallUncertainty,
      dataConfidence,
      waterRequirement: crop.waterRequirements.value?.category ?? 'moderate',
      waterRequirementDetail,
      growingSeasons: crop.growingSeasons.value ?? [],
      seasonalSuitability,
      soilCompatibility,
      factorScores,
      supportingObservations: cropSupportingObservations,
      dataSourcesUsed,
      preferenceAdjustments: prefEval.adjustments,
      hardConstraintsFailed: violations,
      rejectionReasons,
      advantages,
      disadvantages,
      limitingFactors,
      limitations,
      missingDataWarnings: cropMissingWarnings,
      missingOrUncertainInputs: uncertainInputsList,
      climateFitSummary: summary,
      explanation: explanationParts.join(' '),
    };

    if (hasViolations) {
      excludedOptions.push(option);
    } else {
      eligibleOptions.push(option);
    }
  }

  eligibleOptions.sort((a, b) => {
    if (b.suitabilityScore !== a.suitabilityScore) {
      return b.suitabilityScore - a.suitabilityScore;
    }
    return a.cropName.localeCompare(b.cropName);
  });

  const rankedRecommendations = eligibleOptions.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  return {
    location,
    boundaryContext: boundary,
    spatialProcessing: spatialProcessing ?? environmentalContext?.spatialProcessing,
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    deterministicNoAiNotice:
      'Deterministic multi-factor weighted scoring over ICAR/KVK crop knowledge base (independent of Gemini/LLMs).',
    suitabilityVsYieldDisclaimer: SUITABILITY_VS_YIELD_DISCLAIMER,
    evaluationStatus:
      overallUncertainty === 'low' ? 'completed' : 'completed_with_uncertainty',
    evaluatedInputs: inputs,
    preferencesApplied: preferences,
    appliedWeights,
    dataCompletenessPercent,
    uncertaintyLevel: overallUncertainty,
    gpmImergObservation,
    environmentalContext,
    missingDataWarnings: globalMissingWarnings,
    recommendations: rankedRecommendations,
    excludedCrops: excludedOptions,
    caveats: [
      'Suitability scores evaluate environmental & soil fit against published ICAR/KVK parameter ranges and do not account for local market prices, pest outbreaks, or seed availability.',
      SUITABILITY_VS_YIELD_DISCLAIMER,
      ...extraCaveats,
    ],
  };
}
