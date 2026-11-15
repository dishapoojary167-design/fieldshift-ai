import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Droplets,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sprout,
  XCircle,
} from 'lucide-react';
import type {
  AgroClimaticRegionsResult,
  ClimateTrendSummary,
  CropEnvironmentalInputs,
  CropGrowingSeason,
  CropKnowledgeProfile,
  FarmingSystemMode,
  LabSoilTestResult,
  PreferencePriority,
  RotationComparisonWeights,
  RotationPlannerResult,
  RotationSeasonSlotInput,
  RotationStrategyEvaluation,
  RotationStrategyId,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import {
  useFarmWorkspace,
  useSelectedFarmGeometry,
} from '../../context/FarmWorkspaceContext.tsx';
import { apiClient, ApiClientError } from '../../services/apiClient.ts';
import {
  CropFamilySequenceStrip,
  RotationWaterChart,
  StrategySubScoreChart,
} from './RotationCharts.tsx';

interface RotationPlannerViewProps {
  weatherTelemetry: WeatherTelemetrySnapshot | null;
  climateTrends: ClimateTrendSummary | null;
  soilProfile: SoilProfile | null;
  soilMoisture: SoilMoistureSnapshot | null;
  onReturnToMap: () => void;
}

const LAB_STORAGE_KEY = 'fieldshift-lab-soil-tests-v1';

const DEFAULT_ROTATION_WEIGHTS: RotationComparisonWeights = {
  diversity: 18,
  waterEfficiency: 18,
  nitrogenAndNutrientBalance: 18,
  soilHealth: 16,
  seasonalAndRegionalFit: 16,
  pestBreakAndRisk: 14,
};

const WEIGHT_LABELS: Array<{ id: keyof RotationComparisonWeights; label: string }> = [
  { id: 'diversity', label: 'Crop Diversity' },
  { id: 'waterEfficiency', label: 'Water Efficiency' },
  { id: 'nitrogenAndNutrientBalance', label: 'N & Nutrient Balance' },
  { id: 'soilHealth', label: 'Soil Health' },
  { id: 'seasonalAndRegionalFit', label: 'Seasonal & Regional Fit' },
  { id: 'pestBreakAndRisk', label: 'Pest Break & Risk' },
];

const BENCHMARK_PRESETS = [
  {
    id: 'mh-marathwada',
    label: 'Aurangabad, Maharashtra (Marathwada)',
    state: 'Maharashtra',
    zoneId: 'acz-09-western-plateau-hills',
    latitude: 19.8762,
    longitude: 75.3433,
  },
  {
    id: 'mh-vidarbha',
    label: 'Nagpur, Maharashtra (Vidarbha)',
    state: 'Maharashtra',
    zoneId: 'acz-09-western-plateau-hills',
    latitude: 21.1458,
    longitude: 79.0882,
  },
  {
    id: 'mp-malwa',
    label: 'Bhopal, Madhya Pradesh (Malwa Vertisol)',
    state: 'Madhya Pradesh',
    zoneId: 'acz-08-central-plateau-hills',
    latitude: 23.2599,
    longitude: 77.4126,
  },
  {
    id: 'pb-transgangetic',
    label: 'Ludhiana, Punjab (Trans-Gangetic)',
    state: 'Punjab',
    zoneId: 'acz-06-trans-gangetic-plains',
    latitude: 30.901,
    longitude: 75.8573,
  },
  {
    id: 'rj-arid',
    label: 'Jodhpur, Rajasthan (Western Dry)',
    state: 'Rajasthan',
    zoneId: 'acz-14-western-dry',
    latitude: 26.2389,
    longitude: 73.0243,
  },
];

function loadSavedLabTestForParcel(parcelKey: string): LabSoilTestResult | null {
  try {
    const raw = window.localStorage.getItem(LAB_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, LabSoilTestResult>;
    return map[parcelKey] ?? null;
  } catch {
    return null;
  }
}

export function RotationPlannerView({
  weatherTelemetry,
  climateTrends,
  soilProfile,
  soilMoisture,
  onReturnToMap,
}: RotationPlannerViewProps) {
  const { dispatch } = useFarmWorkspace();
  const { activeCoordinates, selectedBoundary, selectedBoundaryPayload, markerLabel } =
    useSelectedFarmGeometry();
  const parcelKey = selectedBoundary ? `boundary:${selectedBoundary.id}` : 'marker:default';
  const parcelLabel = selectedBoundary
    ? `${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha)`
    : markerLabel;
  const activeLabTest = useMemo(() => loadSavedLabTestForParcel(parcelKey), [parcelKey]);

  const [regionsData, setRegionsData] = useState<AgroClimaticRegionsResult | null>(null);
  const [catalogCrops, setCatalogCrops] = useState<CropKnowledgeProfile[]>([]);

  // Planner Controls
  const [seasonsCount, setSeasonsCount] = useState<number>(4);
  const [startingSeason, setStartingSeason] = useState<CropGrowingSeason>('Kharif');
  const [currentCrop, setCurrentCrop] = useState<string>('Soybean');
  const [farmingSystem, setFarmingSystem] = useState<FarmingSystemMode | ''>('rainfed');
  const [agroClimaticZoneId, setAgroClimaticZoneId] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [strictRegionFilter, setStrictRegionFilter] = useState<boolean>(true);
  const [waterConservationPriority, setWaterConservationPriority] =
    useState<PreferencePriority>('moderate');
  const [soilImprovementPriority, setSoilImprovementPriority] =
    useState<PreferencePriority>('high');
  const [diversificationPreference, setDiversificationPreference] =
    useState<PreferencePriority>('high');
  const [autoFetchMissingFarmData, setAutoFetchMissingFarmData] = useState<boolean>(true);

  // Configurable Indicator Weights
  const [showWeights, setShowWeights] = useState<boolean>(false);
  const [weights, setWeights] = useState<RotationComparisonWeights>(DEFAULT_ROTATION_WEIGHTS);

  // Result & Editable Sequences State
  const [result, setResult] = useState<RotationPlannerResult | null>(null);
  const [activeStrategyId, setActiveStrategyId] = useState<RotationStrategyId>('alternative_a');
  const [editableSequences, setEditableSequences] = useState<
    Record<string, RotationSeasonSlotInput[]>
  >({});
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([apiClient.getCropRegions(), apiClient.searchCropCatalog({})]).then(
      ([regionsRes, catalogRes]) => {
        if (!active) return;
        if (regionsRes.status === 'fulfilled') setRegionsData(regionsRes.value);
        if (catalogRes.status === 'fulfilled') setCatalogCrops(catalogRes.value.crops);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const preloadedInputs = useMemo<CropEnvironmentalInputs>(() => {
    const inputs: CropEnvironmentalInputs = {};
    if (agroClimaticZoneId) inputs.agroClimaticZoneId = agroClimaticZoneId;
    if (stateFilter) inputs.state = stateFilter;
    if (farmingSystem) {
      inputs.farmingSystem = farmingSystem;
      inputs.irrigationAvailable = farmingSystem !== 'rainfed';
    }

    if (weatherTelemetry) {
      if (weatherTelemetry.summary.meanTempC !== null) {
        inputs.temperatureMeanC = weatherTelemetry.summary.meanTempC;
      }
      if (weatherTelemetry.summary.availableDays > 0) {
        inputs.observedRainfallMm = weatherTelemetry.summary.totalPrecipitationMm;
        inputs.observationDays = weatherTelemetry.summary.availableDays;
      }
    }
    if (
      climateTrends?.annualPrecipitationMm !== null &&
      climateTrends?.annualPrecipitationMm !== undefined
    ) {
      inputs.annualRainfallMm = climateTrends.annualPrecipitationMm;
    }

    if (activeLabTest?.ph !== null && activeLabTest?.ph !== undefined) {
      inputs.soilPh = activeLabTest.ph;
      inputs.soilPhSource = 'measured_lab';
    } else if (
      soilProfile?.surfaceSummary.ph.mean !== null &&
      soilProfile?.surfaceSummary.ph.mean !== undefined
    ) {
      inputs.soilPh = soilProfile.surfaceSummary.ph.mean;
      inputs.soilPhSource = 'modelled_estimate';
    }

    if (activeLabTest?.textureClass) {
      inputs.soilTexture = activeLabTest.textureClass;
      inputs.soilTextureSource = 'measured_lab';
    } else if (soilProfile?.surfaceSummary.textureClass) {
      inputs.soilTexture = soilProfile.surfaceSummary.textureClass;
      inputs.soilTextureSource = 'modelled_estimate';
    }

    if (
      activeLabTest?.organicCarbonGKg !== null &&
      activeLabTest?.organicCarbonGKg !== undefined
    ) {
      inputs.organicCarbonGKg = activeLabTest.organicCarbonGKg;
      inputs.organicCarbonSource = 'measured_lab';
    } else if (
      soilProfile?.surfaceSummary.organicCarbonGKg.mean !== null &&
      soilProfile?.surfaceSummary.organicCarbonGKg.mean !== undefined
    ) {
      inputs.organicCarbonGKg = soilProfile.surfaceSummary.organicCarbonGKg.mean;
      inputs.organicCarbonSource = 'modelled_estimate';
    }

    if (
      soilMoisture?.rootZoneMoistureM3M3 !== null &&
      soilMoisture?.rootZoneMoistureM3M3 !== undefined
    ) {
      inputs.soilMoistureM3M3 = soilMoisture.rootZoneMoistureM3M3;
    }

    return inputs;
  }, [
    agroClimaticZoneId,
    stateFilter,
    farmingSystem,
    weatherTelemetry,
    climateTrends,
    activeLabTest,
    soilProfile,
    soilMoisture,
  ]);

  function syncEditableSequencesFromResult(plannerRes: RotationPlannerResult) {
    const map: Record<string, RotationSeasonSlotInput[]> = {};
    for (const s of plannerRes.strategies) {
      map[s.strategyId] = s.slots.map((slot) => ({
        slotIndex: slot.slotIndex,
        year: slot.year,
        season: slot.season,
        cropId: slot.cropId,
        cropName: slot.cropName,
      }));
    }
    setEditableSequences(map);
    setHasUnsavedEdits(false);
    setActiveStrategyId(plannerRes.recommendation.preferredStrategyId);
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.generateRotation({
        location: activeCoordinates,
        boundary: selectedBoundaryPayload ?? undefined,
        inputs: preloadedInputs,
        currentCrop: currentCrop.trim() || undefined,
        preferences: {
          seasonsCount,
          startingSeason,
          ...(farmingSystem
            ? { farmingSystem, irrigationAvailable: farmingSystem !== 'rainfed' }
            : {}),
          waterConservationPriority,
          soilImprovementPriority,
          diversificationPreference,
        },
        indicatorWeights: weights,
        autoFetchMissingFarmData,
        strictRegionFilter,
      });
      setResult(response);
      syncEditableSequencesFromResult(response);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to generate and compare rotation strategies.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCompareEdited() {
    if (!result) return;
    setLoading(true);
    setError(null);
    try {
      const strategiesPayload = result.strategies.map((s) => ({
        id: s.strategyId,
        label: s.label,
        description: s.description,
        sequence:
          editableSequences[s.strategyId] ??
          s.slots.map((slot) => ({
            slotIndex: slot.slotIndex,
            year: slot.year,
            season: slot.season,
            cropId: slot.cropId,
            cropName: slot.cropName,
          })),
      }));

      const response = await apiClient.compareRotations({
        location: activeCoordinates,
        boundary: selectedBoundaryPayload ?? undefined,
        inputs: preloadedInputs,
        preferences: {
          seasonsCount,
          startingSeason,
          ...(farmingSystem
            ? { farmingSystem, irrigationAvailable: farmingSystem !== 'rainfed' }
            : {}),
          waterConservationPriority,
          soilImprovementPriority,
          diversificationPreference,
        },
        strategies: strategiesPayload,
        indicatorWeights: weights,
        autoFetchMissingFarmData,
        strictRegionFilter,
      });
      setResult(response);
      syncEditableSequencesFromResult(response);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Failed to re-compare custom rotation.',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleSlotChange(
    strategyId: RotationStrategyId,
    slotIndex: number,
    patch: { cropId?: string; season?: CropGrowingSeason },
  ) {
    setEditableSequences((prev) => {
      const currentList = prev[strategyId] ?? [];
      const nextList = currentList.map((item, idx) => {
        if (idx !== slotIndex) return item;
        const matchedCrop = patch.cropId
          ? catalogCrops.find((c) => c.id === patch.cropId)
          : undefined;
        return {
          ...item,
          ...(patch.season ? { season: patch.season } : {}),
          ...(patch.cropId
            ? { cropId: patch.cropId, cropName: matchedCrop?.cropName ?? patch.cropId }
            : {}),
        };
      });
      return { ...prev, [strategyId]: nextList };
    });
    setHasUnsavedEdits(true);
  }

  function handleAddUserDefinedStrategy() {
    if (!result) return;
    const baseSlots =
      editableSequences[activeStrategyId] ??
      result.strategies[0]?.slots.map((s) => ({
        slotIndex: s.slotIndex,
        year: s.year,
        season: s.season,
        cropId: s.cropId,
        cropName: s.cropName,
      })) ??
      [];

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.generateRotation({
          location: activeCoordinates,
          boundary: selectedBoundaryPayload ?? undefined,
          inputs: preloadedInputs,
          currentCrop: currentCrop.trim() || undefined,
          customSequence: baseSlots,
          preferences: {
            seasonsCount,
            startingSeason,
            ...(farmingSystem
              ? { farmingSystem, irrigationAvailable: farmingSystem !== 'rainfed' }
              : {}),
            waterConservationPriority,
            soilImprovementPriority,
            diversificationPreference,
          },
          indicatorWeights: weights,
          autoFetchMissingFarmData,
          strictRegionFilter,
        });
        setResult(response);
        syncEditableSequencesFromResult(response);
        setActiveStrategyId('user_defined');
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'Failed to add custom strategy.');
      } finally {
        setLoading(false);
      }
    })();
  }

  function handleSelectPreset(presetId: string) {
    const preset = BENCHMARK_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    dispatch({
      type: 'SET_MARKER_LOCATION',
      payload: {
        coordinates: { latitude: preset.latitude, longitude: preset.longitude },
        label: preset.label,
      },
    });
    setStateFilter(preset.state);
    setAgroClimaticZoneId(preset.zoneId);
  }

  const activeStrategy: RotationStrategyEvaluation | null = useMemo(() => {
    if (!result) return null;
    return (
      result.strategies.find((s) => s.strategyId === activeStrategyId) ??
      result.strategies[0] ??
      null
    );
  }, [result, activeStrategyId]);

  const weightSum = Object.values(weights).reduce((acc, w) => acc + w, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Configuration Header */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Module 08 · Deterministic Multi-Season Rotation Planner
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Intelligent Crop Rotation &amp; Strategy Comparison
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Parcel: <span className="font-semibold text-slate-800">{parcelLabel}</span> ·{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {activeCoordinates.latitude.toFixed(4)}°, {activeCoordinates.longitude.toFixed(4)}°
              </span>
              {activeLabTest && (
                <>
                  {' '}
                  · <span className="font-medium text-emerald-700">Lab soil calibration active</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onReturnToMap}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5" />
              Select on Map
            </button>
            <button
              type="button"
              onClick={() => setShowWeights((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showWeights ? 'Hide Indicator Weights' : 'Indicator Weights'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleGenerate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? 'Planning…' : 'Generate & Compare Rotations'}
            </button>
          </div>
        </div>

        {/* Regional & Sequence Controls */}
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="rot-preset" className="block text-[11px] font-medium text-slate-600">
              Benchmark Location Preset
            </label>
            <select
              id="rot-preset"
              defaultValue=""
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="" disabled>
                Choose demonstration farm (or keep map pin)…
              </option>
              {BENCHMARK_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rot-zone" className="block text-[11px] font-medium text-slate-600">
              Agro-Climatic Zone
            </label>
            <select
              id="rot-zone"
              value={agroClimaticZoneId}
              onChange={(e) => setAgroClimaticZoneId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="">Any Zone (No Regional Constraint)</option>
              {(regionsData?.zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.zoneNumber}. {z.shortName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rot-state" className="block text-[11px] font-medium text-slate-600">
              State Filter
            </label>
            <select
              id="rot-state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="">Any State</option>
              {(regionsData?.states ?? []).map((st) => (
                <option key={st.state} value={st.state}>
                  {st.state}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rot-seasons" className="block text-[11px] font-medium text-slate-600">
              Planning Horizon (Growing Seasons)
            </label>
            <select
              id="rot-seasons"
              value={seasonsCount}
              onChange={(e) => setSeasonsCount(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value={3}>3 Seasons (1.5 Years)</option>
              <option value={4}>4 Seasons (2 Years)</option>
              <option value={6}>6 Seasons (3 Years)</option>
              <option value={8}>8 Seasons (4 Years)</option>
            </select>
          </div>
        </div>

        {/* Farmer Priorities & Starting Crop */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label htmlFor="rot-start-season" className="block text-[11px] font-medium text-slate-600">
              Starting Season
            </label>
            <select
              id="rot-start-season"
              value={startingSeason}
              onChange={(e) => setStartingSeason(e.target.value as CropGrowingSeason)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="Kharif">Kharif (Monsoon)</option>
              <option value="Rabi">Rabi (Winter)</option>
              <option value="Summer">Summer</option>
              <option value="Zaid">Zaid</option>
            </select>
          </div>

          <div>
            <label htmlFor="rot-current-crop" className="block text-[11px] font-medium text-slate-600">
              Existing Baseline Crop
            </label>
            <select
              id="rot-current-crop"
              value={currentCrop}
              onChange={(e) => setCurrentCrop(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="">Auto-Select Conventional</option>
              {catalogCrops.map((c) => (
                <option key={c.id} value={c.cropName}>
                  {c.cropName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rot-farming" className="block text-[11px] font-medium text-slate-600">
              Irrigation System
            </label>
            <select
              id="rot-farming"
              value={farmingSystem}
              onChange={(e) => setFarmingSystem(e.target.value as FarmingSystemMode | '')}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="rainfed">Rainfed Only</option>
              <option value="supplemental">Supplemental Irrigation</option>
              <option value="irrigated">Irrigated Available</option>
            </select>
          </div>

          <div>
            <label htmlFor="rot-water-prio" className="block text-[11px] font-medium text-slate-600">
              Water Conservation
            </label>
            <select
              id="rot-water-prio"
              value={waterConservationPriority}
              onChange={(e) => setWaterConservationPriority(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High Priority</option>
            </select>
          </div>

          <div>
            <label htmlFor="rot-soil-prio" className="block text-[11px] font-medium text-slate-600">
              Soil Improvement
            </label>
            <select
              id="rot-soil-prio"
              value={soilImprovementPriority}
              onChange={(e) => setSoilImprovementPriority(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High Priority</option>
            </select>
          </div>

          <div>
            <label htmlFor="rot-div-prio" className="block text-[11px] font-medium text-slate-600">
              Diversification
            </label>
            <select
              id="rot-div-prio"
              value={diversificationPreference}
              onChange={(e) => setDiversificationPreference(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High Priority</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-700">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoFetchMissingFarmData}
              onChange={(e) => setAutoFetchMissingFarmData(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
            />
            <span>Auto-fetch missing NASA POWER, SMAP moisture &amp; SoilGrids inputs</span>
          </label>

          {(agroClimaticZoneId || stateFilter) && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={strictRegionFilter}
                onChange={(e) => setStrictRegionFilter(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>Enforce strict regional crop calendar rules for selected zone/state</span>
            </label>
          )}
        </div>

        {/* Configurable Indicator Weights Drawer */}
        {showWeights && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Configurable Rotation Comparison Weights
                </h2>
                <p className="text-[11px] text-slate-600">
                  Weights normalize to 100% when generating or re-comparing rotation strategies.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWeights(DEFAULT_ROTATION_WEIGHTS)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset Defaults
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {WEIGHT_LABELS.map(({ id, label }) => {
                const pct = weightSum > 0 ? Math.round((weights[id] / weightSum) * 100) : 0;
                return (
                  <div key={id} className="rounded border border-slate-200 bg-white p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-slate-800">{label}</span>
                      <span className="font-mono tabular-nums text-slate-600">{pct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={weights[id]}
                      onChange={(e) =>
                        setWeights((prev) => ({ ...prev, [id]: Number(e.target.value) }))
                      }
                      className="mt-1.5 w-full accent-blue-600 cursor-pointer"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {error && (
        <section className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </section>
      )}

      {!result && !loading && (
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <ArrowRightLeft className="mx-auto h-7 w-7 text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900">
            Generate and compare multi-season crop rotation strategies
          </h2>
          <p className="mx-auto mt-1.5 max-w-2xl text-xs text-slate-600">
            Click <span className="font-semibold">Generate &amp; Compare Rotations</span> above to
            evaluate your existing baseline sequence alongside soil-building (Alternative A) and
            water-resilient (Alternative B) rotations across 3 or more growing seasons.
          </p>
        </section>
      )}

      {result && (
        <>
          {/* Scope Disclaimer, Audit & Preferred Strategy Recommendation */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{result.engineVersion}</span>
                  <span>·</span>
                  <span>{result.deterministicNoAiNotice}</span>
                </div>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Preferred Rotation: {result.recommendation.preferredStrategyLabel}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs">
                <div>
                  <span className="text-slate-500">Data Completeness:</span>{' '}
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    {result.dataCompletenessPercent}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Uncertainty:</span>{' '}
                  <span
                    className={`font-semibold capitalize ${
                      result.uncertaintyLevel === 'low'
                        ? 'text-emerald-700'
                        : result.uncertaintyLevel === 'moderate'
                          ? 'text-amber-700'
                          : 'text-rose-700'
                    }`}
                  >
                    {result.uncertaintyLevel}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-800 leading-relaxed">
              {result.recommendation.whyPreferred}
            </p>

            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span>{result.modelScopeDisclaimer}</span>
            </div>

            {/* 4-Column Structured Recommendation Breakdown */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Environmental Advantages
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-700">
                  {result.recommendation.environmentalAdvantages.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Possible Disadvantages
                </h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-700">
                  {result.recommendation.possibleDisadvantages.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                <h3 className="font-semibold text-slate-800">Important Uncertainties</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-700">
                  {result.recommendation.importantUncertainties.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                <h3 className="font-semibold text-blue-800">Data to Improve Plan</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-700">
                  {result.recommendation.informationToImprove.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* Strategy Selector Tabs & Interactive Re-Compare Controls */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 p-1">
                {result.strategies.map((s) => {
                  const isActive = activeStrategy?.strategyId === s.strategyId;
                  const isRecommended =
                    result.recommendation.preferredStrategyId === s.strategyId;
                  return (
                    <button
                      key={s.strategyId}
                      type="button"
                      onClick={() => setActiveStrategyId(s.strategyId)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {s.strategyId === 'existing'
                        ? 'Existing Rotation'
                        : s.strategyId === 'alternative_a'
                          ? 'Alternative A'
                          : s.strategyId === 'alternative_b'
                            ? 'Alternative B'
                            : 'User-Defined'}{' '}
                      <span className="font-mono tabular-nums text-[11px]">
                        ({s.overallScore})
                      </span>
                      {isRecommended ? ' ★' : ''}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!result.strategies.some((s) => s.strategyId === 'user_defined') && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleAddUserDefinedStrategy}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                  >
                    + Add User-Defined Sequence
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading || !hasUnsavedEdits}
                  onClick={() => void handleCompareEdited()}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                    hasUnsavedEdits
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {hasUnsavedEdits ? 'Re-Compare Edited Crops' : 'Modify Any Crop Below'}
                </button>
              </div>
            </div>

            {activeStrategy && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 text-xs">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{activeStrategy.label}</h3>
                    <p className="text-slate-600">{activeStrategy.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
                    <span>
                      Composite:{' '}
                      <strong className="text-slate-900">{activeStrategy.overallScore}/100</strong>
                    </span>
                    <span>
                      Eligibility:{' '}
                      <strong
                        className={
                          activeStrategy.isEligible ? 'text-emerald-700' : 'text-rose-700'
                        }
                      >
                        {activeStrategy.isEligible ? 'Eligible' : 'Constraint Alerts'}
                      </strong>
                    </span>
                    <span>
                      Risk:{' '}
                      <strong
                        className={`uppercase ${
                          activeStrategy.indicators.agronomicRisk.riskLevel === 'low'
                            ? 'text-emerald-700'
                            : activeStrategy.indicators.agronomicRisk.riskLevel === 'moderate'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                        }`}
                      >
                        {activeStrategy.indicators.agronomicRisk.riskLevel}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Rotation Timeline & Editable Seasonal Crop Cards */}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {activeStrategy.slots.map((slot, idx) => {
                    const editedSlot = editableSequences[activeStrategy.strategyId]?.[idx];
                    const selectedCropId = editedSlot?.cropId ?? slot.cropId;
                    const selectedSeason = editedSlot?.season ?? slot.season;

                    return (
                      <article
                        key={slot.slotIndex}
                        className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/40 p-3.5 text-xs space-y-2.5"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
                            <span className="font-mono font-semibold text-slate-800">
                              Season {idx + 1} · Year {slot.year}
                            </span>
                            <span
                              className={
                                slot.seasonalMatch ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'
                              }
                            >
                              {slot.seasonalMatch ? 'Season OK' : 'Season Mismatch'}
                            </span>
                          </div>

                          {/* Editable Season & Crop Selectors */}
                          <div className="grid grid-cols-[100px_1fr] gap-1.5">
                            <select
                              aria-label={`Season for slot ${idx + 1}`}
                              value={selectedSeason}
                              onChange={(e) =>
                                handleSlotChange(activeStrategy.strategyId, idx, {
                                  season: e.target.value as CropGrowingSeason,
                                })
                              }
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                            >
                              <option value="Kharif">Kharif</option>
                              <option value="Rabi">Rabi</option>
                              <option value="Summer">Summer</option>
                              <option value="Zaid">Zaid</option>
                            </select>

                            <select
                              aria-label={`Crop for slot ${idx + 1}`}
                              value={selectedCropId}
                              onChange={(e) =>
                                handleSlotChange(activeStrategy.strategyId, idx, {
                                  cropId: e.target.value,
                                })
                              }
                              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-900"
                            >
                              {!catalogCrops.some((c) => c.id === selectedCropId) && (
                                <option value={selectedCropId}>{slot.cropName}</option>
                              )}
                              {catalogCrops.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.cropName}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="text-[11px] text-slate-600">
                            <span>{slot.cropFamily}</span>
                            <span> · </span>
                            <span>{slot.cropGroup}</span>
                            {slot.durationDaysRange && (
                              <>
                                <span> · </span>
                                <span className="font-mono tabular-nums">
                                  {slot.durationDaysRange[0]}–{slot.durationDaysRange[1]}d
                                </span>
                              </>
                            )}
                          </div>

                          <div className="space-y-1 border-t border-slate-200/80 pt-2 text-[11px] text-slate-700">
                            <div className="flex items-center gap-1.5">
                              <Droplets className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                              <span>
                                Water:{' '}
                                {slot.estimatedWaterMmRange
                                  ? `${slot.estimatedWaterMmRange[0]}–${slot.estimatedWaterMmRange[1]} mm`
                                  : 'Unknown'}{' '}
                                (<span className="capitalize">{slot.waterCategory}</span>)
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Sprout className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              <span>
                                {slot.fixesNitrogen
                                  ? `Fixes N (res. credit ${slot.residualNitrogenCreditKgHa ? `${slot.residualNitrogenCreditKgHa[0]}–${slot.residualNitrogenCreditKgHa[1]} kg/ha` : 'documented'})`
                                  : 'Non-legume nutrient consumer'}
                              </span>
                            </div>
                            {slot.sowingWindow && (
                              <p className="text-slate-600">
                                <span className="font-medium text-slate-800">Sow:</span>{' '}
                                {slot.sowingWindow}
                              </p>
                            )}
                            <p className="text-slate-600">
                              <span className="font-medium text-slate-800">Soil:</span>{' '}
                              {slot.soilConstraintNote}
                            </p>
                          </div>

                          {slot.transitionFromPrevious && (
                            <div className="border-t border-slate-200/80 pt-2 text-[11px] space-y-1">
                              <div className="font-medium text-slate-800">
                                Transition from {slot.transitionFromPrevious.previousCropName}:{' '}
                                <span
                                  className={
                                    slot.transitionFromPrevious.sequenceStatus === 'beneficial'
                                      ? 'text-emerald-700'
                                      : slot.transitionFromPrevious.sequenceStatus === 'neutral'
                                        ? 'text-slate-700'
                                        : 'text-rose-700'
                                  }
                                >
                                  {slot.transitionFromPrevious.sequenceStatus}
                                </span>
                              </div>
                              <p className="text-slate-600">
                                {slot.transitionFromPrevious.residueManagementNote}
                              </p>
                              {slot.transitionFromPrevious.durationConflictNote && (
                                <p className="text-amber-800 font-medium">
                                  Duration notice: {slot.transitionFromPrevious.durationConflictNote}
                                </p>
                              )}
                              {slot.transitionFromPrevious.pestCarryoverNote && (
                                <p className="text-rose-800 font-medium">
                                  Pest carryover: {slot.transitionFromPrevious.pestCarryoverNote}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {slot.warnings.length > 0 && (
                          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                            {slot.warnings[0]}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                {/* Soil Impact Indicators for Active Strategy */}
                <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Nitrogen Contribution
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {activeStrategy.indicators.potentialNitrogenContribution.qualitativeIndicator}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {activeStrategy.indicators.potentialNitrogenContribution.note}
                    </p>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Nutrient Balance
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {activeStrategy.indicators.nutrientBalance.qualitativeRating}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {activeStrategy.indicators.nutrientBalance.summary}
                    </p>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Soil Health &amp; Residue
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {activeStrategy.indicators.soilHealthConsiderations.qualitativeIndicator}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {activeStrategy.indicators.soilHealthConsiderations.residueManagementSummary}
                    </p>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Root &amp; Drainage Fit
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {activeStrategy.indicators.seasonalSuitability.summary}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {activeStrategy.indicators.soilHealthConsiderations.rootDiversitySummary}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Crop Family Visualization */}
          {activeStrategy && <CropFamilySequenceStrip strategy={activeStrategy} />}

          {/* Water Requirement & Strategy Sub-Score Charts */}
          {activeStrategy && (
            <RotationWaterChart strategies={result.strategies} activeStrategy={activeStrategy} />
          )}

          <StrategySubScoreChart strategies={result.strategies} />

          {/* Strategy Comparison Matrix */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Full Strategy Comparison Matrix
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Strategy</th>
                    <th className="py-2 pr-3 font-medium text-right">Score</th>
                    <th className="py-2 pr-3 font-medium">Est. Water / Season</th>
                    <th className="py-2 pr-3 font-medium">Crop Diversity</th>
                    <th className="py-2 pr-3 font-medium">N Contribution</th>
                    <th className="py-2 pr-3 font-medium">Nutrient Balance</th>
                    <th className="py-2 pr-3 font-medium">Soil Health</th>
                    <th className="py-2 font-medium">Agronomic Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {result.strategies.map((s) => (
                    <tr key={s.strategyId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-slate-900">
                        {s.label}
                        {!s.isEligible && (
                          <div className="flex items-center gap-1 text-[10px] text-rose-700">
                            <XCircle className="h-3 w-3" />
                            {s.indicators.agronomicRisk.constraintViolations.length} constraint
                            violation(s)
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {s.overallScore}/100
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {s.indicators.estimatedSeasonalWaterDemand.averageMinMmPerSeason !== null
                          ? `${s.indicators.estimatedSeasonalWaterDemand.averageMinMmPerSeason}–${s.indicators.estimatedSeasonalWaterDemand.averageMaxMmPerSeason} mm`
                          : 'Unknown'}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {s.indicators.cropDiversity.diversityRating} (
                        {s.indicators.cropDiversity.uniqueFamiliesCount} families)
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {s.indicators.potentialNitrogenContribution.qualitativeIndicator}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {s.indicators.nutrientBalance.qualitativeRating}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">
                        {s.indicators.soilHealthConsiderations.qualitativeIndicator}
                      </td>
                      <td className="py-2.5 font-semibold uppercase">
                        <span
                          className={
                            s.indicators.agronomicRisk.riskLevel === 'low'
                              ? 'text-emerald-700'
                              : s.indicators.agronomicRisk.riskLevel === 'moderate'
                                ? 'text-amber-700'
                                : 'text-rose-700'
                          }
                        >
                          {s.indicators.agronomicRisk.riskLevel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Regional Agricultural Rules Applied */}
          {result.regionalRulesApplied.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Regional Agricultural Rules Reference
              </h2>
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                {result.regionalRulesApplied.map((rule) => (
                  <div key={rule.id} className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-[11px] font-mono text-slate-500">
                      {rule.regionCode} · {rule.ruleType.replaceAll('_', ' ')}
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">{rule.title}</div>
                    <p className="mt-1 text-slate-600">{rule.rationale}</p>
                    <p className="mt-1 text-[11px] text-emerald-800">{rule.soilHealthImpact}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
