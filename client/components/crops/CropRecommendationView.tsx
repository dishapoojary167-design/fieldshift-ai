import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
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
  CropIntelligenceRequest,
  CropIntelligenceResult,
  CropKnowledgeProfile,
  CropSuitabilityOption,
  EcostressResultPayload,
  FarmingSystemMode,
  HlsResultPayload,
  LabSoilTestResult,
  PillarFactorWeights,
  PreferencePriority,
  SoilMoistureSnapshot,
  SoilProfile,
  SuitabilityFactorId,
  SuitabilityScoringWeights,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import {
  useFarmWorkspace,
  useSelectedFarmGeometry,
} from '../../context/FarmWorkspaceContext.tsx';
import { apiClient, ApiClientError } from '../../services/apiClient.ts';
import { CropProfileDrawer } from './CropProfileDrawer.tsx';
import { CropRecommendationCard } from './CropRecommendationCard.tsx';
import { CropComparisonChart, FactorScoreChart } from './FactorScoreChart.tsx';

interface CropRecommendationViewProps {
  weatherTelemetry: WeatherTelemetrySnapshot | null;
  climateTrends: ClimateTrendSummary | null;
  soilProfile: SoilProfile | null;
  soilMoisture: SoilMoistureSnapshot | null;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  onReturnToMap: () => void;
}

const LAB_STORAGE_KEY = 'fieldshift-lab-soil-tests-v1';

const DEFAULT_PILLAR_WEIGHTS: PillarFactorWeights = {
  waterAvailability: 40,
  temperature: 16,
  soilPh: 14,
  soilHealth: 18,
  seasonalCompatibility: 12,
};

const PILLAR_LABELS: Array<{ id: keyof PillarFactorWeights; label: string; detail: string }> = [
  { id: 'waterAvailability', label: 'Water Availability', detail: 'Rainfall, SMAP & water duty' },
  { id: 'temperature', label: 'Temperature', detail: 'Mean, min germination & heat stress' },
  { id: 'soilPh', label: 'Soil pH', detail: 'Acidity / alkalinity tolerance' },
  { id: 'soilHealth', label: 'Soil Health', detail: 'USDA texture & organic carbon' },
  { id: 'seasonalCompatibility', label: 'Seasonal Compatibility', detail: 'Kharif / Rabi / Zaid fit' },
];

const DEFAULT_GRANULAR_WEIGHTS: SuitabilityScoringWeights = {
  temperature: 16,
  rainfall: 16,
  soilMoisture: 10,
  soilPh: 14,
  soilTexture: 10,
  organicCarbon: 8,
  waterRequirement: 14,
  growingSeason: 12,
};

const GRANULAR_WEIGHT_LABELS: Array<{ id: SuitabilityFactorId; label: string }> = [
  { id: 'temperature', label: 'Temperature' },
  { id: 'rainfall', label: 'Rainfall' },
  { id: 'soilMoisture', label: 'SMAP Moisture' },
  { id: 'soilPh', label: 'Soil pH' },
  { id: 'soilTexture', label: 'Soil Texture' },
  { id: 'organicCarbon', label: 'Organic Carbon' },
  { id: 'waterRequirement', label: 'Water & Irrigation' },
  { id: 'growingSeason', label: 'Growing Season' },
];

interface BenchmarkPreset {
  id: string;
  label: string;
  state: string;
  zoneId: string;
  latitude: number;
  longitude: number;
}

const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  {
    id: 'maharashtra-marathwada',
    label: 'Aurangabad, Maharashtra (Marathwada)',
    state: 'Maharashtra',
    zoneId: 'acz-09-western-plateau-hills',
    latitude: 19.8762,
    longitude: 75.3433,
  },
  {
    id: 'maharashtra-vidarbha',
    label: 'Nagpur, Maharashtra (Vidarbha)',
    state: 'Maharashtra',
    zoneId: 'acz-09-western-plateau-hills',
    latitude: 21.1458,
    longitude: 79.0882,
  },
  {
    id: 'maharashtra-pune',
    label: 'Pune, Maharashtra (Western Plateau)',
    state: 'Maharashtra',
    zoneId: 'acz-09-western-plateau-hills',
    latitude: 18.5204,
    longitude: 73.8567,
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
    id: 'rj-arid',
    label: 'Jodhpur, Rajasthan (Western Dry)',
    state: 'Rajasthan',
    zoneId: 'acz-14-western-dry',
    latitude: 26.2389,
    longitude: 73.0243,
  },
  {
    id: 'pb-transgangetic',
    label: 'Ludhiana, Punjab (Trans-Gangetic)',
    state: 'Punjab',
    zoneId: 'acz-06-trans-gangetic-plains',
    latitude: 30.901,
    longitude: 75.8573,
  },
];

const TEXTURE_OPTIONS = [
  'Clay',
  'Clay Loam',
  'Loam',
  'Sandy Loam',
  'Silt Loam',
  'Silty Clay Loam',
  'Sandy Clay Loam',
  'Loamy Sand',
  'Sand',
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

function coordinatesMatch(
  a: { latitude: number; longitude: number } | undefined | null,
  b: { latitude: number; longitude: number },
): boolean {
  if (!a) return false;
  return Math.abs(a.latitude - b.latitude) < 0.005 && Math.abs(a.longitude - b.longitude) < 0.005;
}

export function CropRecommendationView({
  weatherTelemetry,
  climateTrends,
  soilProfile,
  soilMoisture,
  ecostressResult = null,
  hlsResult = null,
  onReturnToMap,
}: CropRecommendationViewProps) {
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

  // Module 07 User Preferences
  const [growingSeason, setGrowingSeason] = useState<CropGrowingSeason | ''>('Kharif');
  const [farmingSystem, setFarmingSystem] = useState<FarmingSystemMode | ''>('');
  const [currentCrop, setCurrentCrop] = useState<string>('');
  const [waterConservationPriority, setWaterConservationPriority] =
    useState<PreferencePriority>('moderate');
  const [soilImprovementPriority, setSoilImprovementPriority] =
    useState<PreferencePriority>('moderate');
  const [diversificationPreference, setDiversificationPreference] =
    useState<PreferencePriority>('moderate');

  // Regional Context
  const [agroClimaticZoneId, setAgroClimaticZoneId] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [strictRegionFilter, setStrictRegionFilter] = useState<boolean>(true);

  // Configurable Factor Weights (5-Pillar vs 8-Granular)
  const [showWeights, setShowWeights] = useState<boolean>(false);
  const [weightMode, setWeightMode] = useState<'pillar' | 'granular'>('pillar');
  const [pillarWeights, setPillarWeights] = useState<PillarFactorWeights>(DEFAULT_PILLAR_WEIGHTS);
  const [granularWeights, setGranularWeights] =
    useState<SuitabilityScoringWeights>(DEFAULT_GRANULAR_WEIGHTS);

  // Optional Manual / Field Input Overrides (no fabricated defaults)
  const [showInputOverrides, setShowInputOverrides] = useState<boolean>(false);
  const [autoFetchMissingFarmData, setAutoFetchMissingFarmData] = useState<boolean>(true);
  const [manualTempMean, setManualTempMean] = useState<string>('');
  const [manualSeasonalRain, setManualSeasonalRain] = useState<string>('');
  const [manualSoilMoisture, setManualSoilMoisture] = useState<string>('');
  const [manualSoilPh, setManualSoilPh] = useState<string>('');
  const [manualSoilTexture, setManualSoilTexture] = useState<string>('');
  const [manualOrganicCarbon, setManualOrganicCarbon] = useState<string>('');

  // Results & Inspection State
  const [result, setResult] = useState<CropIntelligenceResult | null>(null);
  const [chartCropId, setChartCropId] = useState<string>('');
  const [drawerCrop, setDrawerCrop] = useState<CropSuitabilityOption | null>(null);
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

  // Clear prior farm recommendations when selected coordinates or boundary change
  useEffect(() => {
    setResult(null);
    setDrawerCrop(null);
    setChartCropId('');
    setError(null);
  }, [activeCoordinates.latitude, activeCoordinates.longitude, selectedBoundary?.id]);

  const preloadedInputs = useMemo<CropEnvironmentalInputs>(() => {
    const inputs: CropEnvironmentalInputs = {};
    if (growingSeason) inputs.targetSeason = growingSeason;
    if (agroClimaticZoneId) inputs.agroClimaticZoneId = agroClimaticZoneId;
    if (stateFilter) inputs.state = stateFilter;
    if (farmingSystem) {
      inputs.farmingSystem = farmingSystem;
      inputs.irrigationAvailable = farmingSystem !== 'rainfed';
    }

    const weatherMatchesFarm = coordinatesMatch(weatherTelemetry?.location, activeCoordinates);
    if (weatherTelemetry && weatherMatchesFarm) {
      if (weatherTelemetry.summary.meanTempC !== null) {
        inputs.temperatureMeanC = weatherTelemetry.summary.meanTempC;
      }
      if (weatherTelemetry.summary.maxTempC !== null) {
        inputs.temperatureMaxC = weatherTelemetry.summary.maxTempC;
      }
      if (weatherTelemetry.summary.minTempC !== null) {
        inputs.temperatureMinC = weatherTelemetry.summary.minTempC;
      }
      if (
        weatherTelemetry.summary.availableDays > 0 &&
        weatherTelemetry.dailySeries.some((d) => d.precipitationMmDay !== null)
      ) {
        inputs.observedRainfallMm = weatherTelemetry.summary.totalPrecipitationMm;
        inputs.observationDays = weatherTelemetry.summary.availableDays;
      }
      if (weatherTelemetry.summary.meanRelativeHumidityPercent !== null) {
        inputs.relativeHumidityPercent = weatherTelemetry.summary.meanRelativeHumidityPercent;
      }
      if (weatherTelemetry.summary.meanSolarRadiationMjM2Day !== null) {
        inputs.solarRadiationMjM2Day = weatherTelemetry.summary.meanSolarRadiationMjM2Day;
      }
      if (weatherTelemetry.summary.meanWindSpeedMs !== null) {
        inputs.windSpeedMs = weatherTelemetry.summary.meanWindSpeedMs;
      }
      if (
        weatherTelemetry.gpmImerg?.status === 'available' &&
        weatherTelemetry.gpmImerg.precipitationRateMmHr !== null
      ) {
        inputs.gpmPrecipitationRateMmHr = weatherTelemetry.gpmImerg.precipitationRateMmHr;
      }
    }

    const climateMatchesFarm = coordinatesMatch(climateTrends?.location, activeCoordinates);
    if (
      climateTrends &&
      climateMatchesFarm &&
      climateTrends.annualPrecipitationMm !== null &&
      climateTrends.annualPrecipitationMm !== undefined
    ) {
      inputs.annualRainfallMm = climateTrends.annualPrecipitationMm;
    }

    const soilMatchesFarm = coordinatesMatch(soilProfile?.location, activeCoordinates);
    if (activeLabTest?.ph !== null && activeLabTest?.ph !== undefined) {
      inputs.soilPh = activeLabTest.ph;
      inputs.soilPhSource = 'measured_lab';
    } else if (
      soilProfile &&
      soilMatchesFarm &&
      soilProfile.surfaceSummary.ph.mean !== null &&
      soilProfile.surfaceSummary.ph.mean !== undefined
    ) {
      inputs.soilPh = soilProfile.surfaceSummary.ph.mean;
      inputs.soilPhSource = 'modelled_estimate';
    }

    if (activeLabTest?.textureClass) {
      inputs.soilTexture = activeLabTest.textureClass;
      inputs.soilTextureSource = 'measured_lab';
    } else if (soilProfile && soilMatchesFarm && soilProfile.surfaceSummary.textureClass) {
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
      soilProfile &&
      soilMatchesFarm &&
      soilProfile.surfaceSummary.organicCarbonGKg.mean !== null &&
      soilProfile.surfaceSummary.organicCarbonGKg.mean !== undefined
    ) {
      inputs.organicCarbonGKg = soilProfile.surfaceSummary.organicCarbonGKg.mean;
      inputs.organicCarbonSource = 'modelled_estimate';
    }

    const moistureMatchesFarm = coordinatesMatch(soilMoisture?.location, activeCoordinates);
    if (
      soilMoisture &&
      moistureMatchesFarm &&
      soilMoisture.rootZoneMoistureM3M3 !== null &&
      soilMoisture.rootZoneMoistureM3M3 !== undefined
    ) {
      inputs.soilMoistureM3M3 = soilMoisture.rootZoneMoistureM3M3;
    }
    if (
      soilMoisture &&
      moistureMatchesFarm &&
      soilMoisture.surfaceMoistureM3M3 !== null &&
      soilMoisture.surfaceMoistureM3M3 !== undefined
    ) {
      inputs.soilMoistureSurfaceM3M3 = soilMoisture.surfaceMoistureM3M3;
    }

    // Apply explicit user overrides when entered
    const parsedTemp = Number(manualTempMean);
    if (manualTempMean.trim() !== '' && Number.isFinite(parsedTemp)) {
      inputs.temperatureMeanC = parsedTemp;
    }
    const parsedRain = Number(manualSeasonalRain);
    if (manualSeasonalRain.trim() !== '' && Number.isFinite(parsedRain)) {
      inputs.seasonalRainfallMm = parsedRain;
    }
    const parsedMoisture = Number(manualSoilMoisture);
    if (manualSoilMoisture.trim() !== '' && Number.isFinite(parsedMoisture)) {
      inputs.soilMoistureM3M3 = parsedMoisture;
    }
    const parsedPh = Number(manualSoilPh);
    if (manualSoilPh.trim() !== '' && Number.isFinite(parsedPh)) {
      inputs.soilPh = parsedPh;
      inputs.soilPhSource = 'user_input';
    }
    if (manualSoilTexture.trim() !== '') {
      inputs.soilTexture = manualSoilTexture.trim();
      inputs.soilTextureSource = 'user_input';
    }
    const parsedOc = Number(manualOrganicCarbon);
    if (manualOrganicCarbon.trim() !== '' && Number.isFinite(parsedOc)) {
      inputs.organicCarbonGKg = parsedOc;
      inputs.organicCarbonSource = 'user_input';
    }

    return inputs;
  }, [
    activeCoordinates,
    growingSeason,
    agroClimaticZoneId,
    stateFilter,
    farmingSystem,
    weatherTelemetry,
    climateTrends,
    activeLabTest,
    soilProfile,
    soilMoisture,
    manualTempMean,
    manualSeasonalRain,
    manualSoilMoisture,
    manualSoilPh,
    manualSoilTexture,
    manualOrganicCarbon,
  ]);

  function handleSelectBenchmark(presetId: string) {
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

  async function handleRecommend() {
    setLoading(true);
    setError(null);
    try {
      const payload: CropIntelligenceRequest = {
        location: activeCoordinates,
        boundary: selectedBoundaryPayload ?? undefined,
        inputs: preloadedInputs,
        labSoilTest: activeLabTest,
        preferences: {
          ...(growingSeason ? { growingSeason } : {}),
          ...(farmingSystem
            ? {
                farmingSystem,
                irrigationAvailable: farmingSystem !== 'rainfed',
              }
            : {}),
          ...(currentCrop.trim() ? { currentCrop: currentCrop.trim() } : {}),
          waterConservationPriority,
          soilImprovementPriority,
          diversificationPreference,
        },
        autoFetchMissingFarmData,
        ...(weightMode === 'pillar' ? { pillarWeights } : { weights: granularWeights }),
        strictRegionFilter,
        ...(ecostressResult && coordinatesMatch(ecostressResult.location, activeCoordinates)
          ? { ecostressResult }
          : {}),
        ...(hlsResult && coordinatesMatch(hlsResult.location, activeCoordinates)
          ? { hlsResult }
          : {}),
      };

      const response = await apiClient.recommendCrops(payload);
      setResult(response);
      const firstId =
        response.recommendations[0]?.cropId ?? response.excludedCrops[0]?.cropId ?? '';
      setChartCropId(firstId);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to generate crop recommendations.');
      }
    } finally {
      setLoading(false);
    }
  }

  const allEvaluatedCrops = useMemo(() => {
    if (!result) return [];
    return [...result.recommendations, ...result.excludedCrops];
  }, [result]);

  const chartCrop = useMemo(() => {
    return allEvaluatedCrops.find((c) => c.cropId === chartCropId) ?? allEvaluatedCrops[0] ?? null;
  }, [allEvaluatedCrops, chartCropId]);

  const pillarSum = Object.values(pillarWeights).reduce((s, v) => s + v, 0);
  const granularSum = Object.values(granularWeights).reduce((s, v) => s + v, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Header & Primary Evaluation Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Module 07 · Deterministic Multi-Factor Agronomic Scoring
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Explainable Crop Recommendation Engine
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
              onClick={() => setShowInputOverrides((prev) => !prev)}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              {showInputOverrides ? 'Hide Input Overrides' : 'Field / Lab Overrides'}
            </button>
            <button
              type="button"
              onClick={() => setShowWeights((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showWeights ? 'Hide Weights' : 'Factor Weights'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleRecommend()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? 'Evaluating…' : 'Recommend Crops'}
            </button>
          </div>
        </div>

        {/* Benchmark Location Preset + Regional Filters */}
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="rec-preset" className="block text-[11px] font-medium text-slate-600">
              Quick Regional Benchmark Location
            </label>
            <select
              id="rec-preset"
              defaultValue=""
              onChange={(e) => handleSelectBenchmark(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>
                Jump to demonstration farm (or keep map pin)…
              </option>
              {BENCHMARK_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rec-zone" className="block text-[11px] font-medium text-slate-600">
              Agro-Climatic Zone
            </label>
            <select
              id="rec-zone"
              value={agroClimaticZoneId}
              onChange={(e) => setAgroClimaticZoneId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
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
            <label htmlFor="rec-state" className="block text-[11px] font-medium text-slate-600">
              State / Region Filter
            </label>
            <select
              id="rec-state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Any State</option>
              {(regionsData?.states ?? []).map((st) => (
                <option key={st.state} value={st.state}>
                  {st.state}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* User Preferences Grid */}
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div>
            <label htmlFor="rec-season" className="block text-[11px] font-medium text-slate-600">
              Growing Season
            </label>
            <select
              id="rec-season"
              value={growingSeason}
              onChange={(e) => setGrowingSeason(e.target.value as CropGrowingSeason | '')}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Unspecified (Flag Uncertainty)</option>
              <option value="Kharif">Kharif (Monsoon)</option>
              <option value="Rabi">Rabi (Winter)</option>
              <option value="Zaid">Zaid</option>
              <option value="Summer">Summer</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="rec-farming-system"
              className="block text-[11px] font-medium text-slate-600"
            >
              Farming System &amp; Irrigation
            </label>
            <select
              id="rec-farming-system"
              value={farmingSystem}
              onChange={(e) => setFarmingSystem(e.target.value as FarmingSystemMode | '')}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Unspecified (Conservative)</option>
              <option value="rainfed">Rainfed Only (No Irrigation)</option>
              <option value="supplemental">Supplemental Irrigation</option>
              <option value="irrigated">Irrigated Available</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="rec-current-crop"
              className="block text-[11px] font-medium text-slate-600"
            >
              Current / Preceding Crop
            </label>
            <select
              id="rec-current-crop"
              value={currentCrop}
              onChange={(e) => setCurrentCrop(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">None / Fallow / Unspecified</option>
              {catalogCrops.map((c) => (
                <option key={c.id} value={c.cropName}>
                  {c.cropName} ({c.cropGroup})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rec-water-prio" className="block text-[11px] font-medium text-slate-600">
              Water Conservation Priority
            </label>
            <select
              id="rec-water-prio"
              value={waterConservationPriority}
              onChange={(e) => setWaterConservationPriority(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High (Favor Low-Water)</option>
            </select>
          </div>

          <div>
            <label htmlFor="rec-soil-prio" className="block text-[11px] font-medium text-slate-600">
              Soil Improvement Priority
            </label>
            <select
              id="rec-soil-prio"
              value={soilImprovementPriority}
              onChange={(e) => setSoilImprovementPriority(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High (Favor N-Fixers)</option>
            </select>
          </div>

          <div>
            <label htmlFor="rec-div-prio" className="block text-[11px] font-medium text-slate-600">
              Crop Diversification
            </label>
            <select
              id="rec-div-prio"
              value={diversificationPreference}
              onChange={(e) => setDiversificationPreference(e.target.value as PreferencePriority)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High (Avoid Monoculture)</option>
            </select>
          </div>
        </div>

        {/* Strict Region & Auto-fetch Toggles */}
        <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-700">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoFetchMissingFarmData}
              onChange={(e) => setAutoFetchMissingFarmData(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
            />
            <span>Auto-fetch missing NASA POWER, GPM IMERG, SMAP &amp; SoilGrids inputs</span>
          </label>

          {(agroClimaticZoneId || stateFilter) && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={strictRegionFilter}
                onChange={(e) => setStrictRegionFilter(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>Enforce hard regional suitability filter for selected zone/state</span>
            </label>
          )}
        </div>

        {/* Optional Field / Lab Environmental Overrides Drawer */}
        {showInputOverrides && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Optional Field &amp; Lab Environmental Overrides
                </h2>
                <p className="text-[11px] text-slate-600">
                  Leave blank to use live NASA POWER / SMAP / SoilGrids / saved lab data. Blank
                  fields are never fabricated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setManualTempMean('');
                  setManualSeasonalRain('');
                  setManualSoilMoisture('');
                  setManualSoilPh('');
                  setManualSoilTexture('');
                  setManualOrganicCarbon('');
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Clear Overrides
              </button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Mean Temperature (°C)
                </label>
                <input
                  type="number"
                  step="0.1"
                  placeholder={
                    weatherTelemetry?.summary.meanTempC !== null &&
                    weatherTelemetry?.summary.meanTempC !== undefined
                      ? `Telemetry: ${weatherTelemetry.summary.meanTempC.toFixed(1)}`
                      : 'Auto-fetch NASA POWER'
                  }
                  value={manualTempMean}
                  onChange={(e) => setManualTempMean(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Seasonal Rainfall (mm)
                </label>
                <input
                  type="number"
                  step="1"
                  placeholder="Auto-fetch NASA POWER / Climate"
                  value={manualSeasonalRain}
                  onChange={(e) => setManualSeasonalRain(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Root-Zone Soil Moisture (m³/m³)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  placeholder={
                    soilMoisture?.rootZoneMoistureM3M3 !== null &&
                    soilMoisture?.rootZoneMoistureM3M3 !== undefined
                      ? `SMAP: ${soilMoisture.rootZoneMoistureM3M3.toFixed(3)}`
                      : 'Auto-fetch NASA SMAP'
                  }
                  value={manualSoilMoisture}
                  onChange={(e) => setManualSoilMoisture(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Soil pH (0–5 cm / Lab)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="3"
                  max="10.5"
                  placeholder={
                    activeLabTest?.ph !== null && activeLabTest?.ph !== undefined
                      ? `Lab: ${activeLabTest.ph.toFixed(1)}`
                      : soilProfile?.surfaceSummary.ph.mean !== null &&
                          soilProfile?.surfaceSummary.ph.mean !== undefined
                        ? `SoilGrids: ${soilProfile.surfaceSummary.ph.mean.toFixed(1)}`
                        : 'Auto-fetch SoilGrids'
                  }
                  value={manualSoilPh}
                  onChange={(e) => setManualSoilPh(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  USDA Soil Texture Class
                </label>
                <select
                  value={manualSoilTexture}
                  onChange={(e) => setManualSoilTexture(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">Use Lab / SoilGrids Value</option>
                  {TEXTURE_OPTIONS.map((tex) => (
                    <option key={tex} value={tex}>
                      {tex}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Soil Organic Carbon (g/kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Auto-fetch SoilGrids / Lab"
                  value={manualOrganicCarbon}
                  onChange={(e) => setManualOrganicCarbon(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>
            </div>
          </div>
        )}

        {/* Configurable Factor Weights Drawer */}
        {showWeights && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Configurable Factor Weights
                </h2>
                <p className="text-[11px] text-slate-600">
                  Adjust importance across the 5 agronomic pillars or 8 granular dimensions.
                  Normalized automatically to 100%.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setWeightMode('pillar')}
                    className={`rounded px-2.5 py-1 font-medium cursor-pointer ${
                      weightMode === 'pillar'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    5 Core Pillars
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeightMode('granular')}
                    className={`rounded px-2.5 py-1 font-medium cursor-pointer ${
                      weightMode === 'granular'
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    8 Sub-Factors
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPillarWeights(DEFAULT_PILLAR_WEIGHTS);
                    setGranularWeights(DEFAULT_GRANULAR_WEIGHTS);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              </div>
            </div>

            {weightMode === 'pillar' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {PILLAR_LABELS.map(({ id, label, detail }) => {
                  const pct =
                    pillarSum > 0 ? Math.round((pillarWeights[id] / pillarSum) * 100) : 0;
                  return (
                    <div key={id} className="rounded border border-slate-200 bg-white p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">{label}</span>
                        <span className="font-mono tabular-nums text-slate-700">{pct}%</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-500">{detail}</p>
                      <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={pillarWeights[id]}
                        onChange={(e) =>
                          setPillarWeights((prev) => ({ ...prev, [id]: Number(e.target.value) }))
                        }
                        className="mt-2 w-full accent-blue-600 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {GRANULAR_WEIGHT_LABELS.map(({ id, label }) => {
                  const pct =
                    granularSum > 0 ? Math.round((granularWeights[id] / granularSum) * 100) : 0;
                  return (
                    <div key={id} className="rounded border border-slate-200 bg-white p-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800">{label}</span>
                        <span className="font-mono tabular-nums text-slate-600">{pct}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={40}
                        step={1}
                        value={granularWeights[id]}
                        onChange={(e) =>
                          setGranularWeights((prev) => ({
                            ...prev,
                            [id]: Number(e.target.value),
                          }))
                        }
                        className="mt-1.5 w-full accent-blue-600 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            )}
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
          <Sprout className="mx-auto h-7 w-7 text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900">
            Configure preferences &amp; generate explainable crop recommendations
          </h2>
          <p className="mx-auto mt-1.5 max-w-2xl text-xs text-slate-600">
            Select your growing season, farming system (rainfed vs. irrigated), current crop, and
            conservation priorities above, then click <span className="font-semibold">Recommend Crops</span>.
            The engine retrieves live NASA POWER weather, NASA GPM IMERG rainfall, NASA SMAP soil
            moisture, and ISRIC SoilGrids / lab soil measurements to compute deterministic suitability
            scores (0–100).
          </p>
        </section>
      )}

      {result && (
        <>
          {/* Audit Banner, Suitability vs Yield Disclaimer & Environmental Evidence */}
          <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span>{result.engineVersion}</span>
                  <span>·</span>
                  <span>{result.deterministicNoAiNotice}</span>
                </div>
                <h2 className="mt-1 text-base font-semibold text-slate-900">
                  Evaluation Audit &amp; Environmental Evidence
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
                <div>
                  <span className="text-slate-500">Recommended / Rejected:</span>{' '}
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    {result.recommendations.length} / {result.excludedCrops.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Suitability vs Yield Explicit Notice */}
            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span>{result.suitabilityVsYieldDisclaimer}</span>
            </div>

            {/* Environmental Context Window, Validation & Staleness Notices */}
            {result.environmentalContext && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">
                    Farm Environmental Context ·{' '}
                    <span className="font-mono font-normal text-slate-600">
                      {result.environmentalContext.dateRange.startDate} to{' '}
                      {result.environmentalContext.dateRange.endDate}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-600">
                    Historical &amp; Satellite Observations (Not a Forecast)
                  </span>
                </div>

                {result.environmentalContext.growingPeriodContext?.note && (
                  <p className="text-[11px] text-slate-600">
                    {result.environmentalContext.growingPeriodContext.note}
                  </p>
                )}

                {result.environmentalContext.validationSummary && (
                  <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-2 text-[11px] text-slate-600 font-mono tabular-nums">
                    <span>
                      Valid:{' '}
                      <strong className="text-emerald-700">
                        {result.environmentalContext.validationSummary.validCount}
                      </strong>
                    </span>
                    <span>
                      Representative:{' '}
                      <strong className="text-slate-900">
                        {result.environmentalContext.validationSummary.representativeCount}
                      </strong>
                    </span>
                    <span>
                      Stale:{' '}
                      <strong
                        className={
                          result.environmentalContext.validationSummary.staleCount > 0
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }
                      >
                        {result.environmentalContext.validationSummary.staleCount}
                      </strong>
                    </span>
                    <span>
                      Missing:{' '}
                      <strong
                        className={
                          result.environmentalContext.validationSummary.missingCount > 0
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }
                      >
                        {result.environmentalContext.validationSummary.missingCount}
                      </strong>
                    </span>
                    <span>
                      Invalid Rejected:{' '}
                      <strong
                        className={
                          result.environmentalContext.validationSummary.invalidCount > 0
                            ? 'text-rose-700'
                            : 'text-slate-900'
                        }
                      >
                        {result.environmentalContext.validationSummary.invalidCount}
                      </strong>
                    </span>
                  </div>
                )}

                {((result.environmentalContext.staleParameters?.length ?? 0) > 0 ||
                  (result.environmentalContext.invalidParameters?.length ?? 0) > 0 ||
                  (result.environmentalContext.providerWarnings?.length ?? 0) > 0) && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 space-y-1">
                    {result.environmentalContext.staleParameters.length > 0 && (
                      <div>
                        <span className="font-semibold">Stale observations flagged:</span>{' '}
                        {result.environmentalContext.staleParameters.join(', ')}
                      </div>
                    )}
                    {(result.environmentalContext.invalidParameters?.length ?? 0) > 0 && (
                      <div>
                        <span className="font-semibold">Invalid / fill values rejected:</span>{' '}
                        {result.environmentalContext.invalidParameters?.join(', ')}
                      </div>
                    )}
                    {(result.environmentalContext.providerWarnings?.length ?? 0) > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                        {result.environmentalContext.providerWarnings?.map((pw, idx) => (
                          <li key={idx}>{pw}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {result.environmentalContext.coarseResolutionCaveats.length > 0 && (
                  <div className="text-[11px] text-slate-600 space-y-0.5">
                    <div className="font-semibold text-slate-700">
                      Spatial Resolution &amp; Representativeness Caveats
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {result.environmentalContext.coarseResolutionCaveats.map((cav, idx) => (
                        <li key={idx}>{cav}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Missing Data Warnings */}
            {result.missingDataWarnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  Missing Data &amp; Uncertainty Penalties Applied
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-amber-800">
                  {result.missingDataWarnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Environmental Evidence Strip (from top crop or evaluated inputs) */}
            {(result.recommendations[0] ?? result.excludedCrops[0])?.supportingObservations && (
              <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {(
                  result.recommendations[0] ?? result.excludedCrops[0]
                ).supportingObservations.map((obs) => (
                  <div
                    key={obs.parameter}
                    className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-1 text-[11px] text-slate-500">
                      <span className="truncate font-medium text-slate-700">{obs.label}</span>
                      <span
                        className={`text-[10px] font-semibold uppercase ${
                          obs.status === 'available'
                            ? obs.stalenessNote?.toLowerCase().includes('stale')
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {obs.status === 'available'
                          ? obs.stalenessNote?.toLowerCase().includes('stale')
                            ? 'STALE'
                            : 'OK'
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs font-semibold tabular-nums text-slate-900 truncate">
                      {obs.observedValue}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500 truncate">
                      {obs.sourceLabel}
                    </div>
                    {obs.spatialResolution && (
                      <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                        Grid: {obs.spatialResolution}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Data Sources Inventory */}
            {result.environmentalContext && result.environmentalContext.dataSources.length > 0 && (
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Validated Environmental Data Sources
                </h3>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {result.environmentalContext.dataSources.map((src) => (
                    <div
                      key={src.id}
                      className="rounded-md border border-slate-200 bg-white p-2.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-slate-900 truncate">{src.name}</span>
                        <span
                          className={`text-[10px] font-semibold uppercase shrink-0 ${
                            src.isFresh ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {src.isFresh ? 'Fresh' : 'Stale'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-slate-600 truncate">{src.dataset}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                        Resolution: {src.spatialResolution}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500 line-clamp-2">
                        {src.limitations}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Insufficient Essential Data Guard */}
          {result.evaluationStatus === 'insufficient_essential_data' && (
            <section className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-xs text-rose-900 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <XCircle className="h-4 w-4 text-rose-600" />
                Insufficient Essential Data to Normalize Crop Scores
              </div>
              <p>
                Scores (0–100) are withheld when fewer than 2 core environmental/soil parameters
                (temperature, rainfall, soil pH, soil texture) or under 35% weighted parameter
                coverage are available. Enable auto-fetch or enter observed measurements under Field
                / Lab Overrides above.
              </p>
            </section>
          )}

          {/* Ranked Crop Recommendation Cards */}
          {result.recommendations.length > 0 && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
                    Ranked Crop Recommendations ({result.recommendations.length})
                  </h2>
                </div>
                <span className="text-xs text-slate-500">
                  Click any card to update the factor chart, or click Inspect Profile for full
                  agronomic evidence.
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.recommendations.map((crop) => (
                  <CropRecommendationCard
                    key={crop.cropId}
                    crop={crop}
                    isSelected={chartCrop?.cropId === crop.cropId}
                    onSelectForChart={setChartCropId}
                    onOpenProfile={setDrawerCrop}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Factor-Level Scoring & Comparison Charts */}
          {allEvaluatedCrops.length > 0 && (
            <section className="grid gap-5 lg:grid-cols-2">
              {result.recommendations.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-blue-600" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Ranked Suitability vs. Data Confidence
                      </h2>
                    </div>
                    <span className="text-[11px] text-slate-500">Top eligible crops</span>
                  </div>
                  <div className="mt-3">
                    <CropComparisonChart
                      recommendations={result.recommendations}
                      selectedCropId={chartCrop?.cropId}
                      onSelectCrop={setChartCropId}
                    />
                  </div>
                </div>
              )}

              {chartCrop && (
                <div
                  className={`rounded-lg border border-slate-200 bg-white p-5 ${
                    result.recommendations.length === 0 ? 'lg:col-span-2' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Factor-Level Scoring Breakdown: {chartCrop.cropName}
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Score {chartCrop.suitabilityScore}/100 ({chartCrop.suitabilityCategory}) ·
                        Confidence {chartCrop.dataConfidence.score}%
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDrawerCrop(chartCrop)}
                      className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
                    >
                      Open Full Profile
                    </button>
                  </div>
                  <div className="mt-3">
                    <FactorScoreChart
                      factorScores={chartCrop.factorScores}
                      cropName={chartCrop.cropName}
                    />
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Rejected / Excluded Crops Table */}
          {result.excludedCrops.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-rose-600" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Rejected / Unsuitable Crops ({result.excludedCrops.length})
                  </h2>
                </div>
                <span className="text-[11px] text-slate-500">
                  Excluded by deterministic hard eligibility constraints
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Crop</th>
                      <th className="py-2 pr-3 font-medium">Documented Seasons</th>
                      <th className="py-2 pr-3 font-medium">Constraint Code(s)</th>
                      <th className="py-2 pr-3 font-medium">Rejection Reason(s)</th>
                      <th className="py-2 text-right font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.excludedCrops.map((crop) => (
                      <tr key={crop.cropId} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-3 font-medium text-slate-900 whitespace-nowrap">
                          {crop.cropName}
                          <div className="text-[10px] font-normal italic text-slate-500">
                            {crop.cropGroup}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600 whitespace-nowrap">
                          {crop.growingSeasons.join(' / ')}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-rose-700">
                          {crop.hardConstraintsFailed.map((h) => h.code).join(', ')}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-700">
                          {crop.rejectionReasons.join(' ')}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDrawerCrop(crop)}
                            className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <CropProfileDrawer
        crop={drawerCrop}
        suitabilityVsYieldDisclaimer={
          result?.suitabilityVsYieldDisclaimer ??
          'Suitability scores measure environmental compatibility, not yield predictions.'
        }
        onClose={() => setDrawerCrop(null)}
      />
    </div>
  );
}
