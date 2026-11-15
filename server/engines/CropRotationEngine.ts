import type {
  CropEnvironmentalInputs,
  CropGrowingSeason,
  CropKnowledgeProfile,
  CropSuitabilityOption,
  GeoCoordinates,
  RegionalRotationRule,
  RotationComparisonWeights,
  RotationEvaluatedSlot,
  RotationPlannerResult,
  RotationPreferences,
  RotationRecommendationSummary,
  RotationSeasonSlotInput,
  RotationSlotTransitionEvaluation,
  RotationStrategyEvaluation,
  RotationStrategyId,
  RotationStrategyIndicators,
  RotationStrategyInput,
  SoilBoundaryContext,
  SpatialProcessingMetadata,
  WaterRequirementCategory,
} from '../../shared/index.ts';
import { evaluateCropSuitability } from './CropSuitabilityEngine.ts';

export const ROTATION_ENGINE_VERSION = 'fieldshift-deterministic-rotation-v1.0';

export const ROTATION_SCOPE_DISCLAIMER =
  'Rotation indicators are deterministic evaluations based on ICAR/KVK crop parameters, published regional rules, and available farm environmental observations. Soil organic carbon, residue, and nitrogen indicators are qualitative or ICAR reference ranges — NOT quantitative yield or multi-year SOC sequestration predictions.';

export const DEFAULT_ROTATION_WEIGHTS: RotationComparisonWeights = {
  diversity: 0.18,
  waterEfficiency: 0.18,
  nitrogenAndNutrientBalance: 0.18,
  soilHealth: 0.16,
  seasonalAndRegionalFit: 0.16,
  pestBreakAndRisk: 0.14,
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeRotationWeights(
  overrides?: Partial<RotationComparisonWeights>,
  preferences?: RotationPreferences,
): RotationComparisonWeights {
  const merged: RotationComparisonWeights = {
    diversity: overrides?.diversity ?? DEFAULT_ROTATION_WEIGHTS.diversity,
    waterEfficiency: overrides?.waterEfficiency ?? DEFAULT_ROTATION_WEIGHTS.waterEfficiency,
    nitrogenAndNutrientBalance:
      overrides?.nitrogenAndNutrientBalance ??
      DEFAULT_ROTATION_WEIGHTS.nitrogenAndNutrientBalance,
    soilHealth: overrides?.soilHealth ?? DEFAULT_ROTATION_WEIGHTS.soilHealth,
    seasonalAndRegionalFit:
      overrides?.seasonalAndRegionalFit ?? DEFAULT_ROTATION_WEIGHTS.seasonalAndRegionalFit,
    pestBreakAndRisk: overrides?.pestBreakAndRisk ?? DEFAULT_ROTATION_WEIGHTS.pestBreakAndRisk,
  };

  if (!overrides?.waterEfficiency && preferences?.waterConservationPriority === 'high') {
    merged.waterEfficiency *= 1.45;
  }
  if (!overrides?.nitrogenAndNutrientBalance && preferences?.soilImprovementPriority === 'high') {
    merged.nitrogenAndNutrientBalance *= 1.35;
    merged.soilHealth *= 1.3;
  }
  if (!overrides?.diversity && preferences?.diversificationPreference === 'high') {
    merged.diversity *= 1.4;
    merged.pestBreakAndRisk *= 1.25;
  }

  const sum = Object.values(merged).reduce((acc, w) => acc + Math.max(0, w), 0);
  if (sum <= 0) {
    return { ...DEFAULT_ROTATION_WEIGHTS };
  }

  return {
    diversity: Number((Math.max(0, merged.diversity) / sum).toFixed(4)),
    waterEfficiency: Number((Math.max(0, merged.waterEfficiency) / sum).toFixed(4)),
    nitrogenAndNutrientBalance: Number(
      (Math.max(0, merged.nitrogenAndNutrientBalance) / sum).toFixed(4),
    ),
    soilHealth: Number((Math.max(0, merged.soilHealth) / sum).toFixed(4)),
    seasonalAndRegionalFit: Number(
      (Math.max(0, merged.seasonalAndRegionalFit) / sum).toFixed(4),
    ),
    pestBreakAndRisk: Number((Math.max(0, merged.pestBreakAndRisk) / sum).toFixed(4)),
  };
}

function resolveCropProfile(
  slot: RotationSeasonSlotInput,
  crops: CropKnowledgeProfile[],
): CropKnowledgeProfile | null {
  const targetId = slot.cropId?.trim().toLowerCase();
  const targetName = slot.cropName?.trim().toLowerCase();

  return (
    crops.find(
      (c) =>
        (targetId !== undefined && c.id.toLowerCase() === targetId) ||
        (targetName !== undefined &&
          (c.cropName.toLowerCase() === targetName ||
            c.id.toLowerCase() === targetName ||
            c.localNames.some((n) => n.toLowerCase() === targetName))),
    ) ?? null
  );
}

function cropMatchesRegion(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
): boolean {
  const zoneId = inputs.agroClimaticZoneId?.trim().toLowerCase();
  const state = inputs.state?.trim().toLowerCase();
  if (!zoneId && !state) {
    return true;
  }
  const entries = crop.regionalSuitability.value ?? [];
  if (entries.length === 0) {
    return true;
  }
  return entries.some((entry) => {
    const zoneMatch = !zoneId || entry.agroClimaticZoneId.toLowerCase() === zoneId;
    const stateMatch = !state || entry.states.some((s) => s.toLowerCase() === state);
    return zoneMatch && stateMatch;
  });
}

function resolveSowingWindow(
  crop: CropKnowledgeProfile,
  season: CropGrowingSeason,
  inputs: CropEnvironmentalInputs,
): string | null {
  const entries = crop.regionalSuitability.value ?? [];
  const zoneId = inputs.agroClimaticZoneId?.trim().toLowerCase();
  const state = inputs.state?.trim().toLowerCase();

  const exact = entries.find(
    (e) =>
      e.primarySeason === season &&
      (!zoneId || e.agroClimaticZoneId.toLowerCase() === zoneId) &&
      (!state || e.states.some((s) => s.toLowerCase() === state)),
  );
  if (exact) return exact.typicalSowingWindow;

  const bySeason = entries.find((e) => e.primarySeason === season);
  return bySeason?.typicalSowingWindow ?? entries[0]?.typicalSowingWindow ?? null;
}

function evaluateSoilTextureAndDrainage(
  crop: CropKnowledgeProfile,
  inputs: CropEnvironmentalInputs,
): { fit: 'good' | 'moderate' | 'caution' | 'unknown'; note: string } {
  const soilPref = crop.soilPreferences.value;
  if (!soilPref) {
    return { fit: 'unknown', note: 'Soil preferences unavailable in crop knowledge base.' };
  }

  const notes: string[] = [];
  let fit: 'good' | 'moderate' | 'caution' | 'unknown' = 'unknown';

  const texture = inputs.soilTexture?.trim();
  const ph = inputs.soilPh;
  const moisture = inputs.soilMoistureM3M3 ?? inputs.soilMoistureSurfaceM3M3;

  if (!texture && (ph === undefined || ph === null)) {
    return {
      fit: 'unknown',
      note: `Soil pH and texture unavailable to verify ${crop.cropName} (${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)} pH, ${soilPref.drainageRequirement}).`,
    };
  }

  fit = 'good';

  if (texture) {
    const texLower = texture.toLowerCase();
    const exactMatch = soilPref.preferredTextures.some((t) => t.toLowerCase() === texLower);
    const partialMatch = soilPref.preferredTextures.some(
      (t) => texLower.includes(t.toLowerCase()) || t.toLowerCase().includes(texLower),
    );
    if (exactMatch) {
      notes.push(`Texture "${texture}" is within preferred ${soilPref.preferredTextures.join(', ')}.`);
    } else if (partialMatch) {
      fit = 'moderate';
      notes.push(`Texture "${texture}" is moderately compatible with ${crop.cropName}.`);
    } else {
      fit = 'caution';
      notes.push(
        `Texture "${texture}" differs from preferred ${soilPref.preferredTextures.join(', ')}; ${soilPref.drainageRequirement}`,
      );
    }

    const isHeavyClay = texLower.includes('clay') && !texLower.includes('loam');
    const waterSens = (crop.waterRequirements.value?.waterloggingSensitivity ?? '').toLowerCase();
    if (isHeavyClay && (waterSens.includes('high') || waterSens.includes('sensitive'))) {
      fit = 'caution';
      notes.push(
        `Heavy clay drainage caution: ${crop.cropName} is sensitive to waterlogging; raised-bed/BBF drainage advised.`,
      );
    }
  }

  if (ph !== undefined && ph !== null) {
    if (ph < soilPref.phMin - 0.6 || ph > soilPref.phMax + 0.6) {
      fit = 'caution';
      notes.push(
        `Observed soil pH (${ph.toFixed(1)}) lies outside ${crop.cropName}'s ${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)} range.`,
      );
    } else if (ph < soilPref.phMin || ph > soilPref.phMax) {
      if (fit === 'good') fit = 'moderate';
      notes.push(
        `Observed soil pH (${ph.toFixed(1)}) is marginally outside optimal ${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)}.`,
      );
    } else {
      notes.push(`Soil pH (${ph.toFixed(1)}) matches optimal ${soilPref.phMin.toFixed(1)}–${soilPref.phMax.toFixed(1)}.`);
    }
  }

  if (moisture !== undefined && moisture !== null) {
    const sens = (crop.waterRequirements.value?.waterloggingSensitivity ?? '').toLowerCase();
    if (moisture > 0.42 && sens.includes('high')) {
      fit = 'caution';
      notes.push(`Elevated SMAP moisture (${moisture.toFixed(3)} m³/m³) poses waterlogging stress.`);
    }
  }

  return {
    fit,
    note: notes.join(' ') || soilPref.drainageRequirement,
  };
}

function mapCropGroupToRuleCategory(crop: CropKnowledgeProfile): string {
  return crop.cropGroup.toLowerCase();
}

function evaluateTransition(
  prevSlot: RotationEvaluatedSlot,
  prevProfile: CropKnowledgeProfile | null,
  currProfile: CropKnowledgeProfile | null,
  currCropName: string,
  currFamily: string,
  currSeason: CropGrowingSeason,
): RotationSlotTransitionEvaluation {
  const familyRepeated =
    prevSlot.cropFamily !== 'Unknown' &&
    currFamily !== 'Unknown' &&
    prevSlot.cropFamily.toLowerCase() === currFamily.toLowerCase();
  const cropRepeated =
    prevSlot.cropName.toLowerCase() === currCropName.toLowerCase() ||
    (prevProfile !== null && currProfile !== null && prevProfile.id === currProfile.id);

  let durationConflictNote: string | null = null;
  if (prevSlot.durationDaysRange && prevSlot.season === 'Kharif' && currSeason === 'Rabi') {
    const maxDays = prevSlot.durationDaysRange[1];
    if (maxDays >= 165) {
      durationConflictNote = `${prevSlot.cropName} can require ${prevSlot.durationDaysRange[0]}–${maxDays} days, extending past October and squeezing timely Rabi ${currCropName} sowing unless extra-early cultivars are used.`;
    }
  } else if (prevSlot.durationDaysRange && prevSlot.season === 'Rabi' && currSeason === 'Zaid') {
    const maxDays = prevSlot.durationDaysRange[1];
    if (maxDays >= 140) {
      durationConflictNote = `${prevSlot.cropName} maturity (${maxDays} days max) narrows the pre-monsoon ${currSeason} window for ${currCropName}.`;
    }
  }

  let pestCarryoverNote: string | null = null;
  if (cropRepeated) {
    const cautionText =
      currProfile?.cropRotationCompatibility.value?.incompatibleOrCautionSequences[0] ??
      `Continuous ${currCropName} monocropping elevates host-specific pest and soil-borne pathogen carryover.`;
    pestCarryoverNote = cautionText;
  } else if (familyRepeated) {
    pestCarryoverNote = `Successive ${currFamily} crops (${prevSlot.cropName} → ${currCropName}) share botanical susceptibility to family-level pests, weeds (e.g., Striga/grassy weeds), or root pathogens.`;
  }

  const beneficialPredecessors = (
    currProfile?.cropRotationCompatibility.value?.beneficialPrecedingCrops ?? []
  ).map((s) => s.toLowerCase());
  const matchesBeneficial = beneficialPredecessors.some(
    (p) =>
      p.includes(prevSlot.cropName.toLowerCase()) ||
      (prevProfile !== null && p.includes(prevProfile.id.toLowerCase())) ||
      (prevSlot.cropGroup === 'Pulse' && (p.includes('pulse') || p.includes('legume'))),
  );

  let sequenceStatus: RotationSlotTransitionEvaluation['sequenceStatus'] = 'neutral';
  if (cropRepeated) {
    sequenceStatus = 'incompatible';
  } else if (familyRepeated || durationConflictNote) {
    sequenceStatus = 'caution';
  } else if (matchesBeneficial || prevSlot.fixesNitrogen !== Boolean(currProfile?.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen)) {
    sequenceStatus = 'beneficial';
  }

  let residueManagementNote: string;
  if (prevSlot.fixesNitrogen && !currProfile?.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen) {
    residueManagementNote = `Incorporating low C:N ${prevSlot.cropName} legume haulms/leaf litter mineralizes nitrogen ahead of ${currCropName}.`;
  } else if (
    !prevSlot.fixesNitrogen &&
    currProfile?.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen
  ) {
    residueManagementNote = `High-carbon ${prevSlot.cropName} stover should be retained or composted in situ; ${currCropName} nodulation supplies its own biological N.`;
  } else if (familyRepeated) {
    residueManagementNote = `Similar ${currFamily} crop residues carry shared foliar/stubble pathogen inoculum; deep incorporation or residue removal recommended.`;
  } else {
    residueManagementNote = `Standard residue incorporation between ${prevSlot.cropName} and ${currCropName} maintains surface cover.`;
  }

  return {
    previousCropName: prevSlot.cropName,
    previousCropFamily: prevSlot.cropFamily,
    familyRepeated,
    cropRepeated,
    sequenceStatus,
    durationConflictNote,
    pestCarryoverNote,
    residueManagementNote,
  };
}

export function evaluateRotationStrategy(params: {
  strategy: RotationStrategyInput;
  crops: CropKnowledgeProfile[];
  inputs: CropEnvironmentalInputs;
  preferences: RotationPreferences;
  weights: RotationComparisonWeights;
  regionalRules: RegionalRotationRule[];
  strictRegionFilter: boolean;
  dataCompletenessPercent: number;
}): RotationStrategyEvaluation {
  const {
    strategy,
    crops,
    inputs,
    preferences,
    weights,
    regionalRules,
    strictRegionFilter,
    dataCompletenessPercent,
  } = params;

  const evaluatedSlots: RotationEvaluatedSlot[] = [];
  const profileHistory: Array<CropKnowledgeProfile | null> = [];
  const constraintViolations: string[] = [];
  const riskNotes: string[] = [];

  for (let i = 0; i < strategy.sequence.length; i++) {
    const rawSlot = strategy.sequence[i];
    const profile = resolveCropProfile(rawSlot, crops);
    profileHistory.push(profile);

    const cropId = profile?.id ?? (rawSlot.cropId ?? rawSlot.cropName ?? `custom-${i + 1}`).toLowerCase().replace(/\s+/g, '-');
    const cropName = profile?.cropName ?? rawSlot.cropName ?? rawSlot.cropId ?? `Crop ${i + 1}`;
    const scientificName = profile?.scientificName ?? 'Not in ICAR knowledge base';
    const cropFamily = profile?.cropFamily ?? 'Unknown';
    const cropGroup = profile?.cropGroup ?? 'Unknown';
    const resolved = profile !== null;

    const warnings: string[] = [];
    let seasonalMatch = true;
    let regionalMatch = true;

    if (!profile) {
      seasonalMatch = false;
      regionalMatch = false;
      warnings.push(`"${cropName}" is not present in the validated ICAR crop knowledge base; agronomic constraints cannot be verified.`);
      constraintViolations.push(`Slot ${i + 1} (${rawSlot.season} Y${rawSlot.year}): Unknown crop "${cropName}".`);
    } else {
      const documentedSeasons = profile.growingSeasons.value ?? [];
      seasonalMatch = documentedSeasons.includes(rawSlot.season);
      if (!seasonalMatch) {
        const msg = `Slot ${i + 1} (Y${rawSlot.year} ${rawSlot.season}): ${cropName} is incompatible with ${rawSlot.season} (documented: ${documentedSeasons.join(', ')}).`;
        warnings.push(msg);
        constraintViolations.push(msg);
      }

      regionalMatch = cropMatchesRegion(profile, inputs);
      if (!regionalMatch && strictRegionFilter) {
        const msg = `Slot ${i + 1} (Y${rawSlot.year} ${rawSlot.season}): ${cropName} is outside documented regional suitability for ${inputs.state ?? inputs.agroClimaticZoneId}.`;
        warnings.push(msg);
        constraintViolations.push(msg);
      } else if (!regionalMatch) {
        warnings.push(`${cropName} is not a primary ICAR zone recommendation for ${inputs.state ?? inputs.agroClimaticZoneId}.`);
      }

      const irrigationAvailable = preferences.irrigationAvailable ?? inputs.irrigationAvailable;
      const waterReq = profile.waterRequirements.value;
      if (irrigationAvailable === false && waterReq?.category === 'high') {
        const msg = `Slot ${i + 1} (Y${rawSlot.year} ${rawSlot.season}): High-water ${cropName} (${waterReq.seasonalMinMm}–${waterReq.seasonalMaxMm} mm) conflicts with rainfed-only farming.`;
        warnings.push(msg);
        constraintViolations.push(msg);
      }
    }

    const soilFit = profile
      ? evaluateSoilTextureAndDrainage(profile, inputs)
      : { fit: 'unknown' as const, note: 'Unavailable for uncatalogued crop.' };

    if (soilFit.fit === 'caution') {
      warnings.push(soilFit.note);
      riskNotes.push(`Slot ${i + 1} (${cropName}): ${soilFit.note}`);
    }

    const transition =
      i > 0
        ? evaluateTransition(
            evaluatedSlots[i - 1],
            profileHistory[i - 1],
            profile,
            cropName,
            cropFamily,
            rawSlot.season,
          )
        : null;

    if (transition?.cropRepeated) {
      const msg = `Slot ${i + 1}: Consecutive repeat of ${cropName} after ${transition.previousCropName} increases pest/pathogen carryover.`;
      warnings.push(msg);
      constraintViolations.push(msg);
    } else if (transition?.familyRepeated) {
      const msg = `Slot ${i + 1}: Consecutive ${cropFamily} family (${transition.previousCropName} → ${cropName}) reduces family diversity.`;
      warnings.push(msg);
      riskNotes.push(msg);
    }
    if (transition?.durationConflictNote) {
      warnings.push(transition.durationConflictNote);
      riskNotes.push(`Slot ${i + 1}: ${transition.durationConflictNote}`);
    }

    const durationVal = profile?.growingDuration.value;
    const waterVal = profile?.waterRequirements.value;
    const nFixVal = profile?.nitrogenFixationCharacteristics.value;

    evaluatedSlots.push({
      slotIndex: i,
      year: rawSlot.year,
      season: rawSlot.season,
      cropId,
      cropName,
      scientificName,
      cropFamily,
      cropGroup,
      resolvedInKnowledgeBase: resolved,
      seasonalMatch,
      regionalMatch,
      durationDaysRange: durationVal ? [durationVal.minDays, durationVal.maxDays] : null,
      sowingWindow: profile ? resolveSowingWindow(profile, rawSlot.season, inputs) : null,
      waterCategory: waterVal?.category ?? 'unknown',
      estimatedWaterMmRange: waterVal ? [waterVal.seasonalMinMm, waterVal.seasonalMaxMm] : null,
      fixesNitrogen: Boolean(nFixVal?.fixesAtmosphericNitrogen),
      estimatedNitrogenFixationKgHa: nFixVal?.estimatedFixationKgNHa ?? null,
      residualNitrogenCreditKgHa: nFixVal?.residualNitrogenCreditKgNHa ?? null,
      soilTextureAndDrainageFit: soilFit.fit,
      soilConstraintNote: soilFit.note,
      transitionFromPrevious: transition,
      warnings,
    });
  }

  // Aggregate diversity & legume metrics
  const totalSlots = evaluatedSlots.length;
  const uniqueCropsCount = new Set(evaluatedSlots.map((s) => s.cropId)).size;
  const familiesPresent = Array.from(
    new Set(evaluatedSlots.map((s) => s.cropFamily).filter((f) => f !== 'Unknown')),
  );
  const uniqueFamiliesCount = familiesPresent.length;
  const consecutiveFamilyRepeats = evaluatedSlots.filter(
    (s) => s.transitionFromPrevious?.familyRepeated,
  ).length;
  const consecutiveCropRepeats = evaluatedSlots.filter(
    (s) => s.transitionFromPrevious?.cropRepeated,
  ).length;
  const legumeSlotsCount = evaluatedSlots.filter((s) => s.fixesNitrogen).length;
  const legumeSharePercent = totalSlots > 0 ? Math.round((legumeSlotsCount / totalSlots) * 100) : 0;

  const diversityRating: 'High' | 'Moderate' | 'Low' =
    uniqueFamiliesCount >= 3 || (uniqueFamiliesCount >= 2 && consecutiveFamilyRepeats === 0 && uniqueCropsCount >= 3)
      ? 'High'
      : uniqueFamiliesCount >= 2 && consecutiveCropRepeats === 0
        ? 'Moderate'
        : 'Low';

  // Aggregate documented ICAR seasonal water demand (never fabricated)
  const waterSlots = evaluatedSlots.filter((s) => s.estimatedWaterMmRange !== null);
  const totalMinMm =
    waterSlots.length > 0
      ? waterSlots.reduce((acc, s) => acc + s.estimatedWaterMmRange![0], 0)
      : null;
  const totalMaxMm =
    waterSlots.length > 0
      ? waterSlots.reduce((acc, s) => acc + s.estimatedWaterMmRange![1], 0)
      : null;
  const avgMinMm = totalMinMm !== null ? Math.round(totalMinMm / waterSlots.length) : null;
  const avgMaxMm = totalMaxMm !== null ? Math.round(totalMaxMm / waterSlots.length) : null;

  const avgMidMm = avgMinMm !== null && avgMaxMm !== null ? (avgMinMm + avgMaxMm) / 2 : 550;
  const demandCategory: WaterRequirementCategory =
    avgMidMm <= 420 ? 'low' : avgMidMm <= 700 ? 'moderate' : 'high';

  // Aggregate ICAR-documented biological N fixation residual credit ranges
  const nSlots = evaluatedSlots.filter((s) => s.residualNitrogenCreditKgHa !== null);
  const totalResidualNCreditRangeKgHa: [number, number] | null =
    nSlots.length > 0
      ? [
          nSlots.reduce((acc, s) => acc + s.residualNitrogenCreditKgHa![0], 0),
          nSlots.reduce((acc, s) => acc + s.residualNitrogenCreditKgHa![1], 0),
        ]
      : null;

  const nIndicator: RotationStrategyIndicators['potentialNitrogenContribution']['qualitativeIndicator'] =
    legumeSharePercent >= 40
      ? 'High Biological N Contribution'
      : legumeSlotsCount >= 1
        ? 'Moderate Biological N Contribution'
        : 'Negligible / Extractive';

  const heavyNitrogenFeedersCount = evaluatedSlots.filter(
    (s) => !s.fixesNitrogen && (s.cropGroup === 'Cereal' || s.cropGroup === 'Millet'),
  ).length;
  const soilBuildingCropsCount = legumeSlotsCount;

  const nutrientRating: RotationStrategyIndicators['nutrientBalance']['qualitativeRating'] =
    legumeSlotsCount >= 1 && consecutiveCropRepeats === 0 && legumeSharePercent >= 33
      ? 'Balanced Replenishment'
      : legumeSlotsCount >= 1
        ? 'Moderately Balanced'
        : 'Extractive Depletion Risk';

  const soilHealthIndicator: RotationStrategyIndicators['soilHealthConsiderations']['qualitativeIndicator'] =
    legumeSlotsCount >= 1 && uniqueFamiliesCount >= 2 && consecutiveCropRepeats === 0
      ? 'Soil-Building & Residue Balanced'
      : consecutiveCropRepeats > 0 || (legumeSlotsCount === 0 && heavyNitrogenFeedersCount >= 3)
        ? 'Compaction & SOC Depletion Risk'
        : 'Neutral / Maintenance';

  const compatibleSlots = evaluatedSlots.filter((s) => s.seasonalMatch).length;
  const regionalCompatibleSlots = evaluatedSlots.filter((s) => s.regionalMatch).length;
  const durationConflictCount = evaluatedSlots.filter(
    (s) => s.transitionFromPrevious?.durationConflictNote !== null && s.transitionFromPrevious !== null,
  ).length;

  const pestAndDiseaseCarryoverCount = evaluatedSlots.filter(
    (s) => s.transitionFromPrevious?.pestCarryoverNote !== null && s.transitionFromPrevious !== null,
  ).length;

  const soilCautionCount = evaluatedSlots.filter(
    (s) => s.soilTextureAndDrainageFit === 'caution',
  ).length;

  // Regional rules evaluation
  const rulesTriggered: RotationStrategyEvaluation['rulesTriggered'] = [];
  for (const rule of regionalRules) {
    for (let i = 1; i < profileHistory.length; i++) {
      const prev = profileHistory[i - 1];
      const curr = profileHistory[i];
      if (!prev || !curr) continue;
      const prevCat = mapCropGroupToRuleCategory(prev);
      const currCat = mapCropGroupToRuleCategory(curr);
      if (
        rule.precedingCategories.includes(prevCat) &&
        rule.recommendedFollowingCategories.includes(currCat)
      ) {
        rulesTriggered.push({
          ruleId: rule.id,
          title: rule.title,
          ruleType: rule.ruleType,
          impact: `Applied at Slot ${i}→${i + 1} (${prev.cropName} → ${curr.cropName}): ${rule.rationale}`,
        });
        break;
      }
    }
  }

  // Deterministic sub-scores (0–100) for strategy comparison
  const diversityScore = clampScore(
    (uniqueFamiliesCount / Math.max(1, Math.min(3, totalSlots))) * 50 +
      (uniqueCropsCount / Math.max(1, totalSlots)) * 35 +
      (legumeSlotsCount > 0 ? 15 : 0) -
      consecutiveFamilyRepeats * 14 -
      consecutiveCropRepeats * 22,
  );

  const irrigated = preferences.irrigationAvailable ?? inputs.irrigationAvailable;
  const waterScoreRaw =
    demandCategory === 'low' ? 92 : demandCategory === 'moderate' ? 74 : 42;
  const rainfedPenalty =
    irrigated === false && demandCategory === 'high'
      ? 35
      : irrigated === false && avgMidMm > 600
        ? 15
        : 0;
  const waterEfficiencyScore = clampScore(waterScoreRaw - rainfedPenalty);

  const nitrogenAndNutrientBalanceScore = clampScore(
    (legumeSharePercent >= 45 ? 92 : legumeSharePercent >= 25 ? 78 : legumeSlotsCount >= 1 ? 64 : 28) -
      (heavyNitrogenFeedersCount > totalSlots * 0.7 ? 15 : 0),
  );

  const soilHealthScore = clampScore(
    (soilHealthIndicator === 'Soil-Building & Residue Balanced'
      ? 88
      : soilHealthIndicator === 'Neutral / Maintenance'
        ? 66
        : 36) -
      soilCautionCount * 10 -
      consecutiveCropRepeats * 12,
  );

  const seasonalAndRegionalFitScore = clampScore(
    (compatibleSlots / Math.max(1, totalSlots)) * 65 +
      (regionalCompatibleSlots / Math.max(1, totalSlots)) * 35 -
      durationConflictCount * 10,
  );

  const pestBreakAndRiskScore = clampScore(
    96 -
      consecutiveCropRepeats * 28 -
      consecutiveFamilyRepeats * 15 -
      pestAndDiseaseCarryoverCount * 12 -
      constraintViolations.length * 8,
  );

  const subScores: RotationComparisonWeights = {
    diversity: diversityScore,
    waterEfficiency: waterEfficiencyScore,
    nitrogenAndNutrientBalance: nitrogenAndNutrientBalanceScore,
    soilHealth: soilHealthScore,
    seasonalAndRegionalFit: seasonalAndRegionalFitScore,
    pestBreakAndRisk: pestBreakAndRiskScore,
  };

  // Missing-data confidence penalty so incomplete environmental data never yields inflated 100s
  const missingDataPenalty = dataCompletenessPercent < 70 ? Math.round((70 - dataCompletenessPercent) * 0.15) : 0;

  const weightedTotal =
    subScores.diversity * weights.diversity +
    subScores.waterEfficiency * weights.waterEfficiency +
    subScores.nitrogenAndNutrientBalance * weights.nitrogenAndNutrientBalance +
    subScores.soilHealth * weights.soilHealth +
    subScores.seasonalAndRegionalFit * weights.seasonalAndRegionalFit +
    subScores.pestBreakAndRisk * weights.pestBreakAndRisk;

  const overallScore = clampScore(weightedTotal - missingDataPenalty);

  const riskLevel: 'low' | 'moderate' | 'high' =
    constraintViolations.length > 0 || consecutiveCropRepeats > 0
      ? 'high'
      : pestAndDiseaseCarryoverCount > 0 || durationConflictCount > 0 || soilCautionCount > 0
        ? 'moderate'
        : 'low';

  const isEligible = constraintViolations.length === 0;

  const indicators: RotationStrategyIndicators = {
    estimatedSeasonalWaterDemand: {
      totalMinMm,
      totalMaxMm,
      averageMinMmPerSeason: avgMinMm,
      averageMaxMmPerSeason: avgMaxMm,
      demandCategory,
      estimationNote:
        avgMinMm !== null && avgMaxMm !== null
          ? `ICAR documented crop water reference: ${avgMinMm}–${avgMaxMm} mm/season average (${totalMinMm}–${totalMaxMm} mm across ${waterSlots.length} evaluated seasons). Not a field evapotranspiration forecast.`
          : 'Documented seasonal water demand unavailable for uncatalogued crops.',
    },
    cropDiversity: {
      uniqueCropsCount,
      uniqueFamiliesCount,
      totalSlots,
      familiesPresent,
      consecutiveFamilyRepeats,
      consecutiveCropRepeats,
      legumeSlotsCount,
      legumeSharePercent,
      diversityRating,
      summary: `${uniqueCropsCount} distinct crop(s) across ${uniqueFamiliesCount} botanical family/families (${familiesPresent.join(', ') || 'None'}); ${legumeSlotsCount}/${totalSlots} legume season(s).`,
    },
    potentialNitrogenContribution: {
      legumeCount: legumeSlotsCount,
      totalResidualNCreditRangeKgHa,
      qualitativeIndicator: nIndicator,
      note: totalResidualNCreditRangeKgHa
        ? `Includes ${legumeSlotsCount} N-fixing legume season(s); ICAR reference residual N credit range ${totalResidualNCreditRangeKgHa[0]}–${totalResidualNCreditRangeKgHa[1]} kg N/ha across sequence (depends on nodulation & management).`
        : 'No atmospheric N-fixing legumes included; nitrogen replenishment depends entirely on external organic/mineral inputs.',
    },
    nutrientBalance: {
      qualitativeRating: nutrientRating,
      heavyNitrogenFeedersCount,
      soilBuildingCropsCount,
      summary: `${soilBuildingCropsCount} soil-building N-fixing crop(s) paired with ${heavyNitrogenFeedersCount} nutrient-extractive cereal/millet crop(s).`,
    },
    soilHealthConsiderations: {
      qualitativeIndicator: soilHealthIndicator,
      residueManagementSummary:
        legumeSlotsCount > 0 && heavyNitrogenFeedersCount > 0
          ? 'Alternating cereal/millet stover with low C:N legume residues supports balanced decomposition and avoids continuous monoculture residue tie-up.'
          : legumeSlotsCount === 0
            ? 'Cereal/oilseed-only residues lack N-rich legume biomass; balanced composting or green manuring recommended.'
            : 'Legume-dominant sequence maintains low C:N residues; complement with deep-rooted millets/cereals for structural biomass.',
      soilTextureAndDrainageSummary:
        soilCautionCount > 0
          ? `${soilCautionCount} slot(s) show texture or drainage cautions for observed soil properties.`
          : evaluatedSlots.some((s) => s.soilTextureAndDrainageFit === 'unknown')
            ? 'Soil texture/pH partially unavailable; local drainage check recommended.'
            : 'All evaluated crops align with observed farm soil texture and pH.',
      rootDiversitySummary:
        uniqueFamiliesCount >= 2
          ? 'Combines fibrous cereal/millet surface roots with taproot legumes/oilseeds to explore multiple soil horizons.'
          : 'Uniform root architecture across seasons limits subsoil exploration and compaction alleviation.',
      noFabricatedSocNotice:
        'Qualitative soil health indicator only; soil organic carbon change cannot be quantitatively predicted without multi-year field soil sampling.',
    },
    seasonalSuitability: {
      compatibleSlots,
      totalSlots,
      regionalCompatibleSlots,
      durationConflictCount,
      summary: `${compatibleSlots}/${totalSlots} season-compatible, ${regionalCompatibleSlots}/${totalSlots} regionally documented${durationConflictCount > 0 ? `, ${durationConflictCount} transition window squeeze caution(s)` : ''}.`,
    },
    agronomicRisk: {
      riskLevel,
      pestAndDiseaseCarryoverCount,
      constraintViolations,
      riskNotes,
    },
  };

  return {
    strategyId: strategy.id,
    label: strategy.label,
    description: strategy.description ?? '',
    overallScore,
    isEligible,
    slots: evaluatedSlots,
    indicators,
    subScores,
    rulesTriggered,
  };
}

function buildTimelineTemplate(
  seasonsCount: number,
  startingSeason: CropGrowingSeason,
): Array<{ year: number; season: CropGrowingSeason }> {
  const alternating: CropGrowingSeason[] =
    startingSeason === 'Rabi'
      ? ['Rabi', 'Kharif']
      : startingSeason === 'Summer' || startingSeason === 'Zaid'
        ? [startingSeason, 'Kharif', 'Rabi']
        : ['Kharif', 'Rabi'];

  const timeline: Array<{ year: number; season: CropGrowingSeason }> = [];
  let year = 1;
  for (let i = 0; i < seasonsCount; i++) {
    const season = alternating[i % alternating.length];
    if (i > 0 && season === alternating[0]) {
      year += 1;
    }
    timeline.push({ year, season });
  }
  return timeline;
}

function pickBestCandidateForSlot(params: {
  candidates: CropSuitabilityOption[];
  crops: CropKnowledgeProfile[];
  prevProfile: CropKnowledgeProfile | null;
  avoidSameCrop: boolean;
  avoidSameFamily: boolean;
  preferNitrogenFixer?: boolean;
  preferDifferentFrom?: string[];
  preferLowWater?: boolean;
}): CropKnowledgeProfile {
  const {
    candidates,
    crops,
    prevProfile,
    avoidSameCrop,
    avoidSameFamily,
    preferNitrogenFixer,
    preferDifferentFrom = [],
    preferLowWater,
  } = params;

  const scored = candidates.map((opt) => {
    const profile = crops.find((c) => c.id === opt.cropId)!;
    let adjusted = opt.suitabilityScore;

    if (prevProfile) {
      if (avoidSameCrop && profile.id === prevProfile.id) adjusted -= 45;
      if (avoidSameFamily && profile.cropFamily === prevProfile.cropFamily) adjusted -= 24;
      if (
        prevProfile.growingDuration.value &&
        prevProfile.growingDuration.value.maxDays >= 165
      ) {
        adjusted -= 6;
      }
    }

    if (preferNitrogenFixer && profile.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen) {
      adjusted += 12;
    }
    if (preferLowWater && profile.waterRequirements.value?.category === 'low') {
      adjusted += 14;
    }
    if (preferDifferentFrom.includes(profile.id)) {
      adjusted -= 18;
    }

    // Mild duration penalty for ultra-long Kharif pigeonpea when followed by Rabi
    if (profile.growingDuration.value && profile.growingDuration.value.maxDays >= 165) {
      adjusted -= 4;
    }

    return { profile, adjusted };
  });

  scored.sort((a, b) => b.adjusted - a.adjusted);
  return scored[0]?.profile ?? crops[0];
}

export function generateRotationStrategies(params: {
  location: GeoCoordinates;
  crops: CropKnowledgeProfile[];
  inputs: CropEnvironmentalInputs;
  preferences: RotationPreferences;
  currentCrop?: string;
  existingSequence?: RotationSeasonSlotInput[];
  customSequence?: RotationSeasonSlotInput[];
  strictRegionFilter: boolean;
}): RotationStrategyInput[] {
  const {
    location,
    crops,
    inputs,
    preferences,
    currentCrop,
    existingSequence,
    customSequence,
    strictRegionFilter,
  } = params;

  const seasonsCount = Math.max(3, Math.min(8, preferences.seasonsCount ?? 4));
  const startingSeason = preferences.startingSeason ?? inputs.targetSeason ?? 'Kharif';
  const timeline = buildTimelineTemplate(seasonsCount, startingSeason);

  const evalBySeason = (
    season: CropGrowingSeason,
    waterPrio: RotationPreferences['waterConservationPriority'],
    soilPrio: RotationPreferences['soilImprovementPriority'],
  ): CropSuitabilityOption[] => {
    const res = evaluateCropSuitability({
      location,
      crops,
      strictRegionFilter,
      inputs: {
        ...inputs,
        targetSeason: season,
      },
      preferences: {
        growingSeason: season,
        farmingSystem: preferences.farmingSystem,
        irrigationAvailable: preferences.irrigationAvailable,
        waterConservationPriority: waterPrio ?? 'moderate',
        soilImprovementPriority: soilPrio ?? 'moderate',
        diversificationPreference: 'high',
      },
    });
    if (res.recommendations.length > 0) {
      return res.recommendations;
    }
    // Fallback to relaxed regional filter if strict filter eliminated all options
    const relaxed = evaluateCropSuitability({
      location,
      crops,
      strictRegionFilter: false,
      inputs: {
        ...inputs,
        targetSeason: season,
      },
      preferences: {
        growingSeason: season,
        farmingSystem: preferences.farmingSystem,
        irrigationAvailable: preferences.irrigationAvailable,
        waterConservationPriority: waterPrio ?? 'moderate',
        soilImprovementPriority: soilPrio ?? 'moderate',
        diversificationPreference: 'high',
      },
    });
    return relaxed.recommendations.length > 0 ? relaxed.recommendations : relaxed.excludedCrops;
  };

  const kharifBalanced = evalBySeason('Kharif', preferences.waterConservationPriority, 'high');
  const rabiBalanced = evalBySeason('Rabi', preferences.waterConservationPriority, 'high');
  const summerBalanced = evalBySeason('Summer', preferences.waterConservationPriority, 'moderate');
  const zaidBalanced = evalBySeason('Zaid', preferences.waterConservationPriority, 'moderate');

  const kharifWater = evalBySeason('Kharif', 'high', preferences.soilImprovementPriority);
  const rabiWater = evalBySeason('Rabi', 'high', preferences.soilImprovementPriority);

  const getPool = (season: CropGrowingSeason, mode: 'balanced' | 'water'): CropSuitabilityOption[] => {
    if (season === 'Kharif') return mode === 'water' ? kharifWater : kharifBalanced;
    if (season === 'Rabi') return mode === 'water' ? rabiWater : rabiBalanced;
    if (season === 'Zaid') return zaidBalanced;
    return summerBalanced;
  };

  // 1. Existing Farmer Rotation
  let existingSlots: RotationSeasonSlotInput[];
  if (existingSequence && existingSequence.length >= 3) {
    existingSlots = existingSequence;
  } else {
    const resolvedCurrent = currentCrop
      ? resolveCropProfile({ year: 1, season: startingSeason, cropName: currentCrop, cropId: currentCrop }, crops)
      : null;
    const primaryKharif =
      resolvedCurrent && resolvedCurrent.growingSeasons.value?.includes('Kharif')
        ? resolvedCurrent
        : crops.find((c) => c.id === kharifBalanced[0]?.cropId) ?? crops[0];
    const primaryRabi =
      resolvedCurrent && resolvedCurrent.growingSeasons.value?.includes('Rabi')
        ? resolvedCurrent
        : crops.find((c) => c.id === rabiBalanced[0]?.cropId) ??
          crops.find((c) => c.id === 'chickpea') ??
          crops[0];

    existingSlots = timeline.map((slot, idx) => {
      if (idx === 0 && resolvedCurrent) {
        return {
          slotIndex: idx,
          year: slot.year,
          season: slot.season,
          cropId: resolvedCurrent.id,
          cropName: resolvedCurrent.cropName,
        };
      }
      const chosen =
        slot.season === 'Kharif'
          ? primaryKharif
          : slot.season === 'Rabi'
            ? primaryRabi
            : crops.find((c) => c.id === getPool(slot.season, 'balanced')[0]?.cropId) ?? primaryKharif;
      return {
        slotIndex: idx,
        year: slot.year,
        season: slot.season,
        cropId: chosen.id,
        cropName: chosen.cropName,
      };
    });
  }

  // 2. Alternative Rotation A: Soil-Building & Botanical-Family Diversified
  const altASlots: RotationSeasonSlotInput[] = [];
  let prevA: CropKnowledgeProfile | null = null;
  for (let i = 0; i < timeline.length; i++) {
    const slot = timeline[i];
    const pool = getPool(slot.season, 'balanced');
    const needLegume =
      !prevA?.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen &&
      pool.some((o) => crops.find((c) => c.id === o.cropId)?.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen);

    const picked = pickBestCandidateForSlot({
      candidates: pool,
      crops,
      prevProfile: prevA,
      avoidSameCrop: true,
      avoidSameFamily: true,
      preferNitrogenFixer: needLegume,
      preferDifferentFrom: i >= 2 ? [altASlots[i - 2].cropId ?? ''] : [],
    });
    altASlots.push({
      slotIndex: i,
      year: slot.year,
      season: slot.season,
      cropId: picked.id,
      cropName: picked.cropName,
    });
    prevA = picked;
  }

  // 3. Alternative Rotation B: Water-Conserving & Climate-Resilient (distinct from Alternative A)
  const altBSlots: RotationSeasonSlotInput[] = [];
  let prevB: CropKnowledgeProfile | null = null;
  for (let i = 0; i < timeline.length; i++) {
    const slot = timeline[i];
    const pool = getPool(slot.season, 'water');
    const picked = pickBestCandidateForSlot({
      candidates: pool,
      crops,
      prevProfile: prevB,
      avoidSameCrop: true,
      avoidSameFamily: true,
      preferLowWater: true,
      preferDifferentFrom: [altASlots[i]?.cropId ?? '', ...(i >= 2 ? [altBSlots[i - 2].cropId ?? ''] : [])],
    });
    altBSlots.push({
      slotIndex: i,
      year: slot.year,
      season: slot.season,
      cropId: picked.id,
      cropName: picked.cropName,
    });
    prevB = picked;
  }

  const strategies: RotationStrategyInput[] = [
    {
      id: 'existing',
      label: 'Existing Farmer Rotation',
      description: currentCrop
        ? `Baseline sequence anchored on current crop (${currentCrop}) and conventional seasonal pairing.`
        : 'Conventional regional baseline sequence for benchmarking diversification and resource trade-offs.',
      sequence: existingSlots,
    },
    {
      id: 'alternative_a',
      label: 'Alternative Rotation A (Soil & Family Diversified)',
      description:
        'Alternates botanical families with nitrogen-fixing legumes to disrupt pest carryover and balance nutrient demand.',
      sequence: altASlots,
    },
    {
      id: 'alternative_b',
      label: 'Alternative Rotation B (Water-Resilient Adaptive)',
      description:
        'Emphasizes drought-adapted, low-water crops paired with seasonal legume breaks to reduce moisture stress risk.',
      sequence: altBSlots,
    },
  ];

  if (customSequence && customSequence.length >= 3) {
    strategies.push({
      id: 'user_defined',
      label: 'User-Defined Custom Rotation',
      description: 'Custom multi-season crop sequence specified by the user for evaluation.',
      sequence: customSequence,
    });
  }

  return strategies;
}

function buildRecommendationSummary(
  strategies: RotationStrategyEvaluation[],
  preferences: RotationPreferences,
  missingDataWarnings: string[],
  inputs: CropEnvironmentalInputs,
): RotationRecommendationSummary {
  const sorted = [...strategies].sort((a, b) => {
    if (a.isEligible !== b.isEligible) {
      return a.isEligible ? -1 : 1;
    }
    return b.overallScore - a.overallScore;
  });

  const best = sorted[0];
  const runnerUp = sorted[1];

  const priorityFocus: string[] = [];
  if (preferences.waterConservationPriority === 'high') {
    priorityFocus.push('high water conservation priority');
  }
  if (preferences.soilImprovementPriority === 'high') {
    priorityFocus.push('high soil improvement priority');
  }
  if (preferences.diversificationPreference === 'high') {
    priorityFocus.push('high crop diversification preference');
  }
  if (preferences.farmingSystem) {
    priorityFocus.push(`${preferences.farmingSystem} farming system`);
  }

  const whyPreferred = best.isEligible
    ? `${best.label} achieved the highest composite indicator score (${best.overallScore}/100)${priorityFocus.length > 0 ? ` aligned with ${priorityFocus.join(', ')}` : ''}, featuring ${best.indicators.cropDiversity.uniqueFamiliesCount} botanical families, ${best.indicators.cropDiversity.legumeSlotsCount} legume break(s), and ${best.indicators.agronomicRisk.riskLevel} agronomic risk.`
    : `${best.label} ranked highest (${best.overallScore}/100) among evaluated options, though all candidate sequences carry constraint cautions that require management attention.`;

  const environmentalAdvantages: string[] = [
    best.indicators.cropDiversity.summary,
    best.indicators.potentialNitrogenContribution.note,
    best.indicators.soilHealthConsiderations.residueManagementSummary,
    best.indicators.estimatedSeasonalWaterDemand.estimationNote,
  ];
  if (runnerUp && best.strategyId !== runnerUp.strategyId) {
    environmentalAdvantages.push(
      `Outperforms ${runnerUp.label} by ${best.overallScore - runnerUp.overallScore} composite points on configured multi-season indicators.`,
    );
  }

  const possibleDisadvantages: string[] = [
    ...best.indicators.agronomicRisk.constraintViolations,
    ...best.indicators.agronomicRisk.riskNotes,
  ];
  if (possibleDisadvantages.length === 0) {
    possibleDisadvantages.push(
      'Switching away from familiar monoculture staples may require local seed sourcing, market linkage verification, and adjusted sowing equipment.',
    );
  }

  const importantUncertainties: string[] = [
    ...missingDataWarnings,
    'Multi-year monsoon onset timing, intra-seasonal dry spells, and regional pest pressure cannot be predicted from historical climate baselines.',
    best.indicators.soilHealthConsiderations.noFabricatedSocNotice,
  ];

  const informationToImprove: string[] = [];
  if (inputs.soilPh === undefined || inputs.soilPh === null || inputs.soilPhSource !== 'measured_lab') {
    informationToImprove.push('Parcel-level laboratory soil test (pH, organic carbon, NPK, electrical conductivity).');
  }
  if (inputs.soilMoistureM3M3 === undefined && inputs.soilMoistureSurfaceM3M3 === undefined) {
    informationToImprove.push('Recent NASA SMAP or field gravimetric root-zone soil moisture readings.');
  }
  if (inputs.seasonalRainfallMm === undefined && inputs.observedRainfallMm === undefined) {
    informationToImprove.push('Multi-season NASA POWER rainfall observations for the specific parcel.');
  }
  if (inputs.irrigationAvailable === undefined) {
    informationToImprove.push('Confirmed borewell/canal supplemental irrigation capacity during dry spells.');
  }
  informationToImprove.push('Local KVK varietal maturity duration (days) and previous field pest/wilt history.');

  return {
    preferredStrategyId: best.strategyId,
    preferredStrategyLabel: best.label,
    whyPreferred,
    environmentalAdvantages,
    possibleDisadvantages,
    importantUncertainties,
    informationToImprove,
  };
}

export interface EvaluateRotationEngineInput {
  location: GeoCoordinates;
  boundary?: SoilBoundaryContext;
  spatialProcessing?: SpatialProcessingMetadata;
  inputs: CropEnvironmentalInputs;
  preferences: RotationPreferences;
  strategies: RotationStrategyInput[];
  weights?: Partial<RotationComparisonWeights>;
  crops: CropKnowledgeProfile[];
  regionalRules: RegionalRotationRule[];
  strictRegionFilter?: boolean;
  extraCaveats?: string[];
}

export function evaluateRotationStrategies(
  params: EvaluateRotationEngineInput,
): RotationPlannerResult {
  const {
    location,
    boundary,
    spatialProcessing,
    inputs,
    preferences,
    strategies,
    crops,
    regionalRules,
    strictRegionFilter = true,
    extraCaveats = [],
  } = params;

  const appliedWeights = normalizeRotationWeights(params.weights, preferences);

  const missingDataWarnings: string[] = [];
  const checks: Array<[boolean, string]> = [
    [
      inputs.temperatureMeanC !== undefined && inputs.temperatureMeanC !== null,
      'Mean air temperature (NASA POWER) is unavailable.',
    ],
    [
      inputs.seasonalRainfallMm !== undefined ||
        inputs.observedRainfallMm !== undefined ||
        inputs.annualRainfallMm !== undefined,
      'Rainfall baseline (NASA POWER) is unavailable.',
    ],
    [
      inputs.soilMoistureM3M3 !== undefined || inputs.soilMoistureSurfaceM3M3 !== undefined,
      'Soil moisture (NASA SMAP) is unavailable.',
    ],
    [
      inputs.soilPh !== undefined && inputs.soilPh !== null,
      'Soil pH (ISRIC SoilGrids / Lab) is unavailable.',
    ],
    [
      Boolean(inputs.soilTexture && inputs.soilTexture.trim().length > 0),
      'Soil texture class is unavailable.',
    ],
    [
      inputs.organicCarbonGKg !== undefined && inputs.organicCarbonGKg !== null,
      'Soil organic carbon is unavailable.',
    ],
    [
      preferences.irrigationAvailable !== undefined || inputs.irrigationAvailable !== undefined,
      'Farm irrigation access (rainfed vs. irrigated) was not specified.',
    ],
  ];

  let availableCount = 0;
  for (const [ok, msg] of checks) {
    if (ok) {
      availableCount += 1;
    } else {
      missingDataWarnings.push(msg);
    }
  }

  const dataCompletenessPercent = Math.round((availableCount / checks.length) * 100);
  const uncertaintyLevel: 'low' | 'moderate' | 'high' =
    dataCompletenessPercent >= 85 ? 'low' : dataCompletenessPercent >= 50 ? 'moderate' : 'high';

  const evaluatedStrategies = strategies.map((strategy) =>
    evaluateRotationStrategy({
      strategy,
      crops,
      inputs,
      preferences,
      weights: appliedWeights,
      regionalRules,
      strictRegionFilter,
      dataCompletenessPercent,
    }),
  );

  const recommendation = buildRecommendationSummary(
    evaluatedStrategies,
    preferences,
    missingDataWarnings,
    inputs,
  );

  return {
    location,
    boundaryContext: boundary,
    spatialProcessing,
    generatedAt: new Date().toISOString(),
    engineVersion: ROTATION_ENGINE_VERSION,
    deterministicNoAiNotice:
      'Deterministic multi-season crop rotation engine over ICAR/KVK crop knowledge and regional rules (independent of Gemini/LLMs).',
    modelScopeDisclaimer: ROTATION_SCOPE_DISCLAIMER,
    evaluatedInputs: inputs,
    preferencesApplied: preferences,
    appliedWeights,
    dataCompletenessPercent,
    uncertaintyLevel,
    missingDataWarnings,
    regionalRulesApplied: regionalRules,
    strategies: evaluatedStrategies,
    recommendation,
    caveats: [
      ROTATION_SCOPE_DISCLAIMER,
      'Economic gross margins, local mandi prices, and seed availability are excluded from deterministic agronomic indicators.',
      ...extraCaveats,
    ],
  };
}
