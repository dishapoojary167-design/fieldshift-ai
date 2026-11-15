import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClimateTrendSummary,
  DateRange,
  EcostressJobRecord,
  EcostressProviderCapabilitiesPayload,
  EcostressResultPayload,
  FarmBoundary,
  GeoCoordinates,
  HlsJobRecord,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
  Phase4EnvironmentalAnalytics,
  Phase5FarmIntelligence,
  SoilDepthInterval,
  SoilMoistureSnapshot,
  SoilProfile,
  WeatherTelemetrySnapshot,
} from '../shared/index.ts';
import { EnvironmentalIntelligenceView } from './components/environmental/EnvironmentalIntelligenceView.tsx';
import {
  extractLatestEcostressView,
  extractLatestHlsView,
  formatShortDate,
} from './components/environmental/environmentalUtils.ts';
import {
  AgriculturalMapViewport,
  type MapViewportCommand,
} from './components/map/AgriculturalMapViewport.tsx';
import { BoundaryToolsPanel } from './components/map/BoundaryToolsPanel.tsx';
import { LayerManagerPanel } from './components/map/LayerManagerPanel.tsx';
import { LocationSearchPanel } from './components/map/LocationSearchPanel.tsx';
import { AiAssistantView } from './components/assistant/AiAssistantView.tsx';
import { CropKnowledgeView } from './components/crops/CropKnowledgeView.tsx';
import { CropRecommendationView } from './components/crops/CropRecommendationView.tsx';
import { RotationPlannerView } from './components/rotation/RotationPlannerView.tsx';
import { SoilIntelligenceView } from './components/soil/SoilIntelligenceView.tsx';
import { WeatherIntelligenceView } from './components/weather/WeatherIntelligenceView.tsx';
import {
  createInitialLayerStates,
  type EnvironmentalLayerId,
  type EnvironmentalLayerState,
  type ParcelTelemetryLayerId,
} from './config/gibsLayers.ts';
import { FarmWorkspaceProvider, useFarmWorkspace } from './context/FarmWorkspaceContext.tsx';
import { apiClient, ApiClientError } from './services/apiClient.ts';

type WorkspaceTab =
  | 'map'
  | 'environmental'
  | 'weather'
  | 'soil'
  | 'crops'
  | 'recommendations'
  | 'rotation'
  | 'assistant';

function getInitialDateRange(): DateRange {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 4);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function getInitialEnvironmentalDateRange(): DateRange {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 44);
  const startIso = start.toISOString().slice(0, 10);
  return {
    startDate: startIso < '2018-07-10' ? '2018-07-10' : startIso,
    endDate: end.toISOString().slice(0, 10),
  };
}

function FieldShiftWorkspace() {
  const { state, selectedBoundary, selectedBoundaryPayload, activeCoordinates, dispatch } =
    useFarmWorkspace();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('map');
  const [layers, setLayers] = useState<EnvironmentalLayerState[]>(createInitialLayerStates);
  const [inspectedParcelLayers, setInspectedParcelLayers] = useState<ParcelTelemetryLayerId[]>([]);
  const [mapCommand, setMapCommand] = useState<MapViewportCommand | null>(null);
  const mapSectionRef = useRef<HTMLElement | null>(null);

  const [dateRange, setDateRange] = useState<DateRange>(getInitialDateRange);
  const [trendYears, setTrendYears] = useState<number>(5);
  const [weatherTelemetry, setWeatherTelemetry] = useState<WeatherTelemetrySnapshot | null>(null);
  const [climateTrends, setClimateTrends] = useState<ClimateTrendSummary | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const [soilDepthCm, setSoilDepthCm] = useState<SoilDepthInterval>('0-5');
  const [soilProfile, setSoilProfile] = useState<SoilProfile | null>(null);
  const [soilMoisture, setSoilMoisture] = useState<SoilMoistureSnapshot | null>(null);
  const [soilLoading, setSoilLoading] = useState(false);
  const [soilError, setSoilError] = useState<string | null>(null);

  const [environmentalDateRange, setEnvironmentalDateRange] = useState<DateRange>(
    getInitialEnvironmentalDateRange,
  );
  const [ecostressResult, setEcostressResult] = useState<EcostressResultPayload | null>(null);
  const [hlsResult, setHlsResult] = useState<HlsResultPayload | null>(null);
  const [ecostressCapabilities, setEcostressCapabilities] =
    useState<EcostressProviderCapabilitiesPayload | null>(null);
  const [hlsCapabilities, setHlsCapabilities] = useState<HlsProviderCapabilitiesPayload | null>(
    null,
  );
  const [ecostressJob, setEcostressJob] = useState<EcostressJobRecord | null>(null);
  const [hlsJob, setHlsJob] = useState<HlsJobRecord | null>(null);
  const [environmentalLoading, setEnvironmentalLoading] = useState(false);
  const [environmentalError, setEnvironmentalError] = useState<string | null>(null);
  const [environmentalAnalytics, setEnvironmentalAnalytics] =
    useState<Phase4EnvironmentalAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [farmIntelligence, setFarmIntelligence] =
    useState<Phase5FarmIntelligence | null>(null);
  const [farmIntelligenceLoading, setFarmIntelligenceLoading] = useState(false);
  const environmentalAbortRef = useRef<AbortController | null>(null);

  const fetchWeatherForActiveFarm = useCallback(
    async (overrideRange?: DateRange, overrideYears?: number) => {
      const targetRange = overrideRange ?? dateRange;
      const targetYears = overrideYears ?? trendYears;

      setWeatherLoading(true);
      setWeatherError(null);
      try {
        const [telemetryRes, trendsRes] = await Promise.all([
          apiClient.getWeatherTelemetry({
            location: activeCoordinates,
            boundary: selectedBoundaryPayload ?? undefined,
            dateRange: targetRange,
            includeGpmImerg: true,
          }),
          apiClient.getClimateTrends({
            latitude: activeCoordinates.latitude,
            longitude: activeCoordinates.longitude,
            years: targetYears,
          }),
        ]);
        setWeatherTelemetry(telemetryRes);
        setClimateTrends(trendsRes);
      } catch (err) {
        if (err instanceof ApiClientError) {
          setWeatherError(err.message);
        } else {
          setWeatherError('Failed to retrieve NASA weather observations.');
        }
      } finally {
        setWeatherLoading(false);
      }
    },
    [activeCoordinates, selectedBoundaryPayload, dateRange, trendYears],
  );

  const fetchSoilForActiveFarm = useCallback(
    async (overrideDepth?: SoilDepthInterval) => {
      const targetDepth = overrideDepth ?? soilDepthCm;
      const boundaryPayload = selectedBoundaryPayload ?? undefined;

      setSoilLoading(true);
      setSoilError(null);
      try {
        const [profileRes, moistureRes] = await Promise.all([
          apiClient.getSoilProfile({
            location: activeCoordinates,
            boundary: boundaryPayload,
            depthCm: targetDepth,
          }),
          apiClient.getSoilMoisture({
            location: activeCoordinates,
            boundary: boundaryPayload,
          }),
        ]);
        setSoilProfile(profileRes);
        setSoilMoisture(moistureRes);
      } catch (err) {
        if (err instanceof ApiClientError) {
          setSoilError(err.message);
        } else {
          setSoilError('Failed to retrieve SoilGrids and NASA SMAP soil data.');
        }
      } finally {
        setSoilLoading(false);
      }
    },
    [activeCoordinates, selectedBoundaryPayload, soilDepthCm],
  );

  const fetchEnvironmentalForActiveFarm = useCallback(
    async (overrideRange?: DateRange) => {
      const targetRange = overrideRange ?? environmentalDateRange;
      environmentalAbortRef.current?.abort();
      const controller = new AbortController();
      environmentalAbortRef.current = controller;

      setEnvironmentalLoading(true);
      setEnvironmentalError(null);
      setEcostressJob(null);
      setHlsJob(null);

      try {
        if (!ecostressCapabilities || !hlsCapabilities) {
          const [ecoCapsSettled, hlsCapsSettled] = await Promise.allSettled([
            ecostressCapabilities
              ? Promise.resolve(ecostressCapabilities)
              : apiClient.getEcostressProducts(),
            hlsCapabilities ? Promise.resolve(hlsCapabilities) : apiClient.getHlsProducts(),
          ]);
          if (controller.signal.aborted) return;
          if (ecoCapsSettled.status === 'fulfilled') {
            setEcostressCapabilities(ecoCapsSettled.value);
          }
          if (hlsCapsSettled.status === 'fulfilled') {
            setHlsCapabilities(hlsCapsSettled.value);
          }
        }

        const spatialMode = selectedBoundaryPayload ? 'polygon' : 'auto';
        const [ecoSettled, hlsSettled] = await Promise.allSettled([
          apiClient.fetchEcostressForFarm(
            {
              location: activeCoordinates,
              boundary: selectedBoundaryPayload ?? undefined,
              geometry: selectedBoundaryPayload?.geometry,
              bbox: selectedBoundaryPayload?.bbox,
              spatialProcessingMode: spatialMode,
              dateRange: targetRange,
            },
            {
              signal: controller.signal,
              onJobUpdate: (job) => {
                if (!controller.signal.aborted) setEcostressJob(job);
              },
            },
          ),
          apiClient.fetchHlsForFarm(
            {
              location: activeCoordinates,
              boundary: selectedBoundaryPayload ?? undefined,
              geometry: selectedBoundaryPayload?.geometry,
              bbox: selectedBoundaryPayload?.bbox,
              spatialProcessingMode: spatialMode,
              dateRange: targetRange,
            },
            {
              signal: controller.signal,
              onJobUpdate: (job) => {
                if (!controller.signal.aborted) setHlsJob(job);
              },
            },
          ),
        ]);

        if (controller.signal.aborted) return;

        const errorMessages: string[] = [];
        if (ecoSettled.status === 'fulfilled') {
          setEcostressResult(ecoSettled.value);
        } else {
          const reason = ecoSettled.reason;
          if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
            errorMessages.push(
              `ECOSTRESS: ${
                reason instanceof Error ? reason.message : 'Unable to retrieve ECOSTRESS ET/ESI.'
              }`,
            );
          }
        }

        if (hlsSettled.status === 'fulfilled') {
          setHlsResult(hlsSettled.value);
        } else {
          const reason = hlsSettled.reason;
          if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
            errorMessages.push(
              `Landsat/HLS: ${
                reason instanceof Error
                  ? reason.message
                  : 'Unable to retrieve Landsat/HLS reflectance.'
              }`,
            );
          }
        }

        if (errorMessages.length > 0) {
          setEnvironmentalError(errorMessages.join(' | '));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setEnvironmentalError(
          err instanceof ApiClientError
            ? err.message
            : 'Failed to retrieve NASA ECOSTRESS & Landsat/HLS environmental observations.',
        );
      } finally {
        if (!controller.signal.aborted) {
          setEnvironmentalLoading(false);
        }
      }
    },
    [
      activeCoordinates,
      selectedBoundaryPayload,
      environmentalDateRange,
      ecostressCapabilities,
      hlsCapabilities,
    ],
  );

  // Reset stale parcel-scoped ECOSTRESS/HLS payloads, Phase 4 analytics, and Phase 5 intelligence when target coordinates or boundary changes
  useEffect(() => {
    environmentalAbortRef.current?.abort();
    setEcostressResult(null);
    setHlsResult(null);
    setEcostressJob(null);
    setHlsJob(null);
    setEnvironmentalError(null);
    setEnvironmentalAnalytics(null);
    setFarmIntelligence(null);
  }, [activeCoordinates.latitude, activeCoordinates.longitude, selectedBoundary?.id]);

  // Evaluate Phase 4 environmental quality, multi-temporal, stress, confidence, and alerts whenever ECOSTRESS or HLS payloads update
  useEffect(() => {
    if (!ecostressResult && !hlsResult) {
      setEnvironmentalAnalytics(null);
      setFarmIntelligence(null);
      return;
    }

    let cancelled = false;
    setAnalyticsLoading(true);
    void apiClient
      .analyzeEnvironmental({
        location: activeCoordinates,
        boundary: selectedBoundaryPayload ?? undefined,
        geometry: selectedBoundaryPayload?.geometry,
        bbox: selectedBoundaryPayload?.bbox,
        spatialProcessingMode: selectedBoundaryPayload ? 'polygon' : 'auto',
        dateRange: environmentalDateRange,
        ecostressResult,
        hlsResult,
        autoFetchCompletedResults: false,
      })
      .then((res) => {
        if (!cancelled) {
          setEnvironmentalAnalytics(res.analytics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnvironmentalAnalytics(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    ecostressResult,
    hlsResult,
    activeCoordinates.latitude,
    activeCoordinates.longitude,
    selectedBoundaryPayload,
    environmentalDateRange,
  ]);

  // Synthesize Phase 5 Farm-Level Posture, 7-14d Trend Projections, and Action Recommendations once satellite payloads & Phase 4 analytics settle
  useEffect(() => {
    if (!ecostressResult && !hlsResult) {
      setFarmIntelligence(null);
      return;
    }
    if (analyticsLoading) {
      return;
    }

    let cancelled = false;
    setFarmIntelligenceLoading(true);
    void apiClient
      .getFarmIntelligenceSummary({
        location: activeCoordinates,
        boundary: selectedBoundaryPayload ?? undefined,
        geometry: selectedBoundaryPayload?.geometry,
        bbox: selectedBoundaryPayload?.bbox,
        spatialProcessingMode: selectedBoundaryPayload ? 'polygon' : 'auto',
        dateRange: environmentalDateRange,
        ecostressResult,
        hlsResult,
        weatherTelemetry,
        soilProfile,
        soilMoisture,
        phase4Analytics: environmentalAnalytics ?? undefined,
        autoFetchCompletedResults: false,
      })
      .then((res) => {
        if (!cancelled) {
          setFarmIntelligence(res.intelligence);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFarmIntelligence(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFarmIntelligenceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    ecostressResult,
    hlsResult,
    environmentalAnalytics,
    analyticsLoading,
    weatherTelemetry,
    soilProfile,
    soilMoisture,
    activeCoordinates.latitude,
    activeCoordinates.longitude,
    selectedBoundaryPayload,
    environmentalDateRange,
  ]);

  // Automatically load initial observed telemetry when switching to Weather tab or moving target pin/polygon
  useEffect(() => {
    if (activeTab === 'weather') {
      void fetchWeatherForActiveFarm();
    }
  }, [activeTab, activeCoordinates.latitude, activeCoordinates.longitude, selectedBoundary?.id]);

  // Automatically load SoilGrids & SMAP soil moisture when switching to Soil Intelligence tab or moving target pin/polygon
  useEffect(() => {
    if (activeTab === 'soil') {
      void fetchSoilForActiveFarm();
    }
  }, [activeTab, activeCoordinates.latitude, activeCoordinates.longitude, selectedBoundary?.id]);

  // Automatically load ECOSTRESS & Landsat/HLS satellite observations when switching to Satellites & ET tab
  useEffect(() => {
    if (activeTab === 'environmental') {
      void fetchEnvironmentalForActiveFarm();
    }
    return () => {
      environmentalAbortRef.current?.abort();
    };
  }, [activeTab, activeCoordinates.latitude, activeCoordinates.longitude, selectedBoundary?.id]);

  const scrollToMapSection = useCallback(() => {
    requestAnimationFrame(() => {
      mapSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  function handleFocusCoordinates(coordinates: GeoCoordinates, zoom = 13) {
    setActiveTab('map');
    setMapCommand({ type: 'focus', coordinates, zoom, nonce: Date.now() });
    scrollToMapSection();
  }

  function handleFitBoundary(boundary: FarmBoundary) {
    setActiveTab('map');
    setMapCommand({ type: 'fit_boundary', boundary, nonce: Date.now() });
    scrollToMapSection();
  }

  function handleToggleLayer(id: EnvironmentalLayerId) {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, enabled: !layer.enabled } : layer)),
    );
  }

  function handleChangeOpacity(id: EnvironmentalLayerId, opacity: number) {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, opacity } : layer)),
    );
  }

  function handleChangeDate(id: EnvironmentalLayerId, date: string) {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, date } : layer)),
    );
  }

  function handleToggleParcelLayerLegend(id: ParcelTelemetryLayerId) {
    setInspectedParcelLayers((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handlePrimaryAction() {
    setActiveTab('map');
    if (state.mode === 'drawing') {
      if (state.draftVertices.length >= 3) {
        dispatch({ type: 'FINISH_DRAWING' });
      } else {
        dispatch({ type: 'CANCEL_DRAWING' });
      }
    } else {
      dispatch({ type: 'START_DRAWING' });
      scrollToMapSection();
    }
  }

  const primaryLabel =
    state.mode === 'drawing'
      ? state.draftVertices.length >= 3
        ? 'Finish Boundary'
        : 'Cancel Drawing'
      : 'Draw Boundary';

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar */}
      <header className="relative z-20 flex items-center justify-between gap-3 sm:gap-6 border-b border-slate-200 bg-white px-3 sm:px-5 py-3 shrink-0">
        <a
          href="/"
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          FieldShift AI
        </a>

        <nav
          aria-label="Workspace navigation"
          className="flex min-w-0 items-center gap-4 sm:gap-6 overflow-x-auto text-sm font-medium"
        >
          <button
            type="button"
            onClick={() => setActiveTab('map')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'map'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Map Workspace
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('environmental')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'environmental'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Satellites &amp; ET
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('weather')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'weather'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Weather &amp; Climate
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('soil')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'soil'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Soil Intelligence
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('crops')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'crops'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Crop Knowledge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('recommendations')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'recommendations'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Recommendations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rotation')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'rotation'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Rotation Planner
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('assistant')}
            className={`whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'assistant'
                ? 'text-blue-600 underline underline-offset-8 decoration-2'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            AI Assistant
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handlePrimaryAction}
            className={`rounded-md px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              state.mode === 'drawing'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {primaryLabel}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      {activeTab === 'map' && (
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
            {/* Location Search & Farm Boundaries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="rounded-lg border border-slate-200 bg-white min-w-0">
                <LocationSearchPanel onFocusCoordinates={handleFocusCoordinates} />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white min-w-0">
                <BoundaryToolsPanel onFitBoundary={handleFitBoundary} />
              </div>
            </div>

            {/* Observed Weather, Soil & Satellite Environmental Quick Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Observed Weather
                  </h2>
                  <button
                    type="button"
                    disabled={weatherLoading}
                    onClick={() => void fetchWeatherForActiveFarm()}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {weatherLoading ? 'Loading…' : 'Fetch NASA Data'}
                  </button>
                </div>
                {weatherTelemetry ? (
                  <div className="mt-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between font-mono tabular-nums">
                      <span className="text-slate-600">Mean Temp</span>
                      <span className="font-semibold text-slate-900">
                        {weatherTelemetry.summary.meanTempC !== null
                          ? `${weatherTelemetry.summary.meanTempC.toFixed(1)} °C`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono tabular-nums">
                      <span className="text-slate-600">
                        Rainfall ({weatherTelemetry.summary.totalDays}d)
                      </span>
                      <span className="font-semibold text-slate-900">
                        {weatherTelemetry.summary.totalPrecipitationMm.toFixed(1)} mm
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('weather')}
                      className="mt-2 text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                    >
                      Open full charts &amp; monthly summaries →
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Fetch NASA POWER &amp; GPM IMERG observations for the active pin or boundary.
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Soil &amp; SMAP Moisture
                  </h2>
                  <button
                    type="button"
                    disabled={soilLoading}
                    onClick={() => void fetchSoilForActiveFarm()}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {soilLoading ? 'Loading…' : 'Fetch Soil Data'}
                  </button>
                </div>
                {soilProfile || soilMoisture ? (
                  <div className="mt-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex items-center justify-between font-mono tabular-nums">
                      <span className="text-slate-600">Topsoil pH (0–5 cm)</span>
                      <span className="font-semibold text-slate-900">
                        {soilProfile?.surfaceSummary.ph.mean !== null &&
                        soilProfile?.surfaceSummary.ph.mean !== undefined
                          ? `${soilProfile.surfaceSummary.ph.mean.toFixed(1)} pH`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono tabular-nums">
                      <span className="text-slate-600">SMAP Surface</span>
                      <span className="font-semibold text-slate-900">
                        {soilMoisture?.surfaceMoistureM3M3 !== null &&
                        soilMoisture?.surfaceMoistureM3M3 !== undefined
                          ? `${soilMoisture.surfaceMoistureM3M3.toFixed(3)} m³/m³`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('soil')}
                      className="mt-2 text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                    >
                      Open Soil Intelligence &amp; Lab Calibration →
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Retrieve ISRIC SoilGrids estimates &amp; NASA SMAP L4 moisture for the active parcel.
                  </p>
                )}
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    ECOSTRESS &amp; Landsat/HLS
                  </h2>
                  <button
                    type="button"
                    disabled={environmentalLoading}
                    onClick={() => void fetchEnvironmentalForActiveFarm()}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {environmentalLoading ? 'Polling…' : 'Fetch Satellites'}
                  </button>
                </div>
                {(() => {
                  const ecoQuick = extractLatestEcostressView(ecostressResult);
                  const hlsQuick = extractLatestHlsView(hlsResult);
                  if (!ecoQuick && !hlsQuick) {
                    return (
                      <p className="mt-2 text-xs text-slate-500">
                        Extract AppEEARS ECOSTRESS ET/ESI (70 m) &amp; Landsat/HLS NDVI/NDWI (30 m)
                        for the active parcel.
                      </p>
                    );
                  }
                  return (
                    <div className="mt-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                        <span className="text-slate-600">
                          ET / ESI
                          {ecoQuick?.etObservationDate
                            ? ` (${formatShortDate(ecoQuick.etObservationDate)})`
                            : ''}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {ecoQuick?.latestEtWm2 !== null && ecoQuick?.latestEtWm2 !== undefined
                            ? `${ecoQuick.latestEtWm2.toFixed(1)} W/m²`
                            : 'Unavailable'}
                          {' · '}
                          {ecoQuick?.latestEsiRatio !== null && ecoQuick?.latestEsiRatio !== undefined
                            ? ecoQuick.latestEsiRatio.toFixed(2)
                            : '—'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 font-mono tabular-nums">
                        <span className="text-slate-600">
                          NDVI / NDWI
                          {hlsQuick?.ndviAcquisitionDate
                            ? ` (${formatShortDate(hlsQuick.ndviAcquisitionDate)})`
                            : ''}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {hlsQuick?.latestNdvi !== null && hlsQuick?.latestNdvi !== undefined
                            ? hlsQuick.latestNdvi.toFixed(2)
                            : 'Unavailable'}
                          {' · '}
                          {hlsQuick?.latestNdwi !== null && hlsQuick?.latestNdwi !== undefined
                            ? hlsQuick.latestNdwi.toFixed(2)
                            : '—'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('environmental')}
                        className="mt-2 text-[11px] font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Open Satellites &amp; ET Dashboard →
                      </button>
                    </div>
                  );
                })()}
              </section>
            </div>

            {/* NASA GIBS Environmental Layer Controls */}
            <div className="rounded-lg border border-slate-200 bg-white min-w-0">
              <LayerManagerPanel
                layers={layers}
                onToggleLayer={handleToggleLayer}
                onChangeOpacity={handleChangeOpacity}
                onChangeDate={handleChangeDate}
                inspectedParcelLayers={inspectedParcelLayers}
                onToggleParcelLayerLegend={handleToggleParcelLayerLegend}
                ecostressResult={ecostressResult}
                hlsResult={hlsResult}
                onOpenEnvironmental={() => setActiveTab('environmental')}
              />
            </div>

            {/* Dedicated Bottom Map Section */}
            <section
              id="farm-map-section"
              ref={mapSectionRef}
              aria-labelledby="farm-map-section-heading"
              className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Interactive Geospatial Workspace
                  </p>
                  <h2
                    id="farm-map-section-heading"
                    className="mt-1 text-lg font-semibold text-slate-900"
                  >
                    Farm Location &amp; Satellite Map
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {selectedBoundary
                      ? `Selected boundary: ${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha)`
                      : `Active pin: ${state.markerLabel}`}{' '}
                    ·{' '}
                    <span className="font-mono tabular-nums text-slate-700">
                      {activeCoordinates.latitude.toFixed(5)}°,{' '}
                      {activeCoordinates.longitude.toFixed(5)}°
                    </span>
                  </p>
                </div>

                {state.mode === 'drawing' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-emerald-700">
                      Drawing mode: click map to place vertices ({state.draftVertices.length} placed)
                    </span>
                    <button
                      type="button"
                      disabled={state.draftVertices.length < 3}
                      onClick={() => dispatch({ type: 'FINISH_DRAWING' })}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      Finish Boundary
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'CANCEL_DRAWING' })}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div className="relative w-full min-w-0 h-[320px] sm:h-[380px] lg:h-[450px] overflow-hidden isolate rounded-md border border-slate-200 bg-slate-100">
                <AgriculturalMapViewport
                  layers={layers}
                  inspectedParcelLayers={inspectedParcelLayers}
                  command={mapCommand}
                  weatherSummary={weatherTelemetry}
                  ecostressResult={ecostressResult}
                  hlsResult={hlsResult}
                  onOpenWeather={() => setActiveTab('weather')}
                  onOpenEnvironmental={() => setActiveTab('environmental')}
                />
              </div>
            </section>
          </div>
        </main>
      )}

      {activeTab === 'environmental' && (
        <main className="flex-1 min-w-0">
          <EnvironmentalIntelligenceView
            ecostressResult={ecostressResult}
            hlsResult={hlsResult}
            ecostressCapabilities={ecostressCapabilities}
            hlsCapabilities={hlsCapabilities}
            ecostressJob={ecostressJob}
            hlsJob={hlsJob}
            environmentalAnalytics={environmentalAnalytics}
            analyticsLoading={analyticsLoading}
            farmIntelligence={farmIntelligence}
            farmIntelligenceLoading={farmIntelligenceLoading}
            loading={environmentalLoading}
            error={environmentalError}
            dateRange={environmentalDateRange}
            onChangeDateRange={setEnvironmentalDateRange}
            onFetchEnvironmental={(range) => void fetchEnvironmentalForActiveFarm(range)}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'weather' && (
        <main className="flex-1 min-w-0">
          <WeatherIntelligenceView
            telemetry={weatherTelemetry}
            trends={climateTrends}
            loading={weatherLoading}
            error={weatherError}
            dateRange={dateRange}
            trendYears={trendYears}
            onChangeDateRange={setDateRange}
            onChangeTrendYears={setTrendYears}
            onFetchWeather={(range, years) => void fetchWeatherForActiveFarm(range, years)}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'soil' && (
        <main className="flex-1 min-w-0">
          <SoilIntelligenceView
            profile={soilProfile}
            moisture={soilMoisture}
            loading={soilLoading}
            error={soilError}
            selectedDepthCm={soilDepthCm}
            onChangeDepthCm={setSoilDepthCm}
            onFetchSoil={(depth) => void fetchSoilForActiveFarm(depth)}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'crops' && (
        <main className="flex-1 min-w-0">
          <CropKnowledgeView
            soilProfile={soilProfile}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'recommendations' && (
        <main className="flex-1 min-w-0">
          <CropRecommendationView
            weatherTelemetry={weatherTelemetry}
            climateTrends={climateTrends}
            soilProfile={soilProfile}
            soilMoisture={soilMoisture}
            ecostressResult={ecostressResult}
            hlsResult={hlsResult}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'rotation' && (
        <main className="flex-1 min-w-0">
          <RotationPlannerView
            weatherTelemetry={weatherTelemetry}
            climateTrends={climateTrends}
            soilProfile={soilProfile}
            soilMoisture={soilMoisture}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}

      {activeTab === 'assistant' && (
        <main className="flex-1 min-w-0">
          <AiAssistantView
            weatherTelemetry={weatherTelemetry}
            climateTrends={climateTrends}
            soilProfile={soilProfile}
            soilMoisture={soilMoisture}
            ecostressResult={ecostressResult}
            hlsResult={hlsResult}
            environmentalAnalytics={environmentalAnalytics}
            farmIntelligence={farmIntelligence}
            onReturnToMap={() => setActiveTab('map')}
          />
        </main>
      )}
    </div>
  );
}

export default function App() {
  return (
    <FarmWorkspaceProvider>
      <FieldShiftWorkspace />
    </FarmWorkspaceProvider>
  );
}
