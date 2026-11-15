import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateCropSuitability, DEFAULT_SUITABILITY_WEIGHTS } from '../server/engines/CropSuitabilityEngine.ts';
import type { CropKnowledgeProfile, CropEnvironmentalInputs, CropRecommendationPreferences } from '../shared/index.ts';

const mockCrop: CropKnowledgeProfile = {
  id: 'wheat',
  cropName: 'Wheat',
  localNames: ['Gehun'],
  scientificName: 'Triticum aestivum',
  cropFamily: 'Poaceae',
  cropGroup: 'Cereal',
  growingSeasons: { value: ['Rabi'], validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  regionalSuitability: { value: [{ agroClimaticZoneId: 'zone-6', agroClimaticZoneName: 'Central Zone', states: ['Maharashtra'], primarySeason: 'Rabi', typicalSowingWindow: 'Nov-Dec', regionalNotes: '' }], validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  temperatureRequirements: { value: { germinationMinC: 4, optimalMinC: 15, optimalMaxC: 25, heatStressThresholdC: 30, frostSensitivity: 'Low' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  waterRequirements: { value: { category: 'moderate', seasonalMinMm: 450, seasonalMaxMm: 650, droughtTolerance: 'Moderate', waterloggingSensitivity: 'High' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  soilPreferences: { value: { preferredTextures: ['Loam', 'Clay Loam'], indianSoilTypes: ['Alluvial', 'Black'], phMin: 6.0, phMax: 7.5, drainageRequirement: 'Well drained', salinityToleranceNote: '', salinityThresholdEcDsM: 6.0 }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  growingDuration: { value: { minDays: 120, maxDays: 140, maturityNote: '' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  nutrientRequirements: { value: { nitrogenKgHa: [100, 120], phosphorusP2O5KgHa: [50, 60], potassiumK2OKgHa: [40, 50], secondaryAndMicronutrients: '', soilTestCalibrationNote: '' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  irrigationNeeds: { value: { rainfedViability: 'moderate', recommendedIrrigationsRange: [4, 6], criticalGrowthStages: ['CRI', 'Tillering'], managementNote: '' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  nitrogenFixationCharacteristics: { value: { fixesAtmosphericNitrogen: false, symbiontSpecies: null, estimatedFixationKgNHa: null, residualNitrogenCreditKgNHa: null, nodulationAndInoculationNote: '' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  cropRotationCompatibility: { value: { beneficialPrecedingCrops: ['Legume'], beneficialSucceedingCrops: ['Millet'], incompatibleOrCautionSequences: [], agronomicRationale: '' }, validationStatus: 'icar_kvk_verified', validationNote: '', sources: [] },
  unavailableParametersNote: '',
  lastReviewedDate: '2026-01-01',
};

describe('Phase 3C: ECOSTRESS and HLS Advisory Evidence Integration in Crop Recommendations', () => {
  it('includes ET, ESI, NDVI, and NDWI in supporting observations without altering numerical scores or rankings', () => {
    const baseInputs: CropEnvironmentalInputs = {
      targetSeason: 'Rabi',
      temperatureMeanC: 22.0,
      temperatureMaxC: 28.0,
      temperatureMinC: 16.0,
      observedRainfallMm: 120,
      annualRainfallMm: 800,
      soilMoistureM3M3: 0.28,
      soilPh: 6.8,
      soilTexture: 'Clay Loam',
      organicCarbonGKg: 14.0,
      irrigationAvailable: true,
      farmingSystem: 'irrigated',
    };

    const enhancedInputs: CropEnvironmentalInputs = {
      ...baseInputs,
      etDailyWm2: 420.0,
      esiRatio: 0.82,
      ndvi: 0.76,
      ndwi: 0.32,
    };

    const prefs: CropRecommendationPreferences = {
      growingSeason: 'Rabi',
      farmingSystem: 'irrigated',
      irrigationAvailable: true,
    };

    const resultWithoutAdvisory = evaluateCropSuitability({
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: baseInputs,
      preferences: prefs,
      crops: [mockCrop],
    });

    const resultWithAdvisory = evaluateCropSuitability({
      location: { latitude: 19.076, longitude: 72.877 },
      inputs: enhancedInputs,
      preferences: prefs,
      crops: [mockCrop],
    });

    assert.equal(resultWithoutAdvisory.recommendations.length, 1);
    assert.equal(resultWithAdvisory.recommendations.length, 1);

    const recWithout = resultWithoutAdvisory.recommendations[0];
    const recWith = resultWithAdvisory.recommendations[0];

    // Scoring formulas and numerical scores must remain identical
    assert.equal(recWithout.suitabilityScore, recWith.suitabilityScore);
    assert.equal(recWithout.suitabilityBand, recWith.suitabilityBand);

    // Supporting observations must now include etDailyWm2, esiRatio, ndvi, ndwi
    assert.ok(recWith.supportingObservations.some((o) => o.parameter === 'etDailyWm2' && o.observedValue.includes('420.0')));
    assert.ok(recWith.supportingObservations.some((o) => o.parameter === 'esiRatio' && o.observedValue.includes('0.820')));
    assert.ok(recWith.supportingObservations.some((o) => o.parameter === 'ndvi' && o.observedValue.includes('0.760')));
    assert.ok(recWith.supportingObservations.some((o) => o.parameter === 'ndwi' && o.observedValue.includes('0.320')));

    // Verify scoring weights remain unchanged
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.temperature, 0.16);
    assert.equal(DEFAULT_SUITABILITY_WEIGHTS.rainfall, 0.16);
  });
});
