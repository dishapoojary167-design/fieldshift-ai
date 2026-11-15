import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  Compass,
  Droplets,
  Flame,
  Info,
  Leaf,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  DateRange,
  EcostressJobRecord,
  EcostressProviderCapabilitiesPayload,
  EcostressResultPayload,
  HlsJobRecord,
  HlsProviderCapabilitiesPayload,
  HlsResultPayload,
  Phase4EnvironmentalAnalytics,
  Phase5FarmIntelligence,
} from '../../../shared/index.ts';
import { useSelectedFarmGeometry } from '../../context/FarmWorkspaceContext.tsx';
import {
  EsiTrendChart,
  EtTrendChart,
  NdviTimeSeriesChart,
  NdwiTimeSeriesChart,
} from './EnvironmentalCharts.tsx';
import {
  areDatesDistinct,
  buildEsiSeries,
  buildEtSeries,
  buildNdviSeries,
  buildNdwiSeries,
  extractLatestEcostressView,
  extractLatestHlsView,
  formatHlsSensorName,
  formatQualityLabel,
  formatShortDate,
  formatUtcTimestamp,
  sortEcostressObservationsChronological,
  sortHlsObservationsChronological,
} from './environmentalUtils.ts';

interface EnvironmentalIntelligenceViewProps {
  ecostressResult: EcostressResultPayload | null;
  hlsResult: HlsResultPayload | null;
  ecostressCapabilities: EcostressProviderCapabilitiesPayload | null;
  hlsCapabilities: HlsProviderCapabilitiesPayload | null;
  ecostressJob: EcostressJobRecord | null;
  hlsJob: HlsJobRecord | null;
  environmentalAnalytics?: Phase4EnvironmentalAnalytics | null;
  analyticsLoading?: boolean;
  farmIntelligence?: Phase5FarmIntelligence | null;
  farmIntelligenceLoading?: boolean;
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  onChangeDateRange: (range: DateRange) => void;
  onFetchEnvironmental: (overrideRange?: DateRange) => void;
  onReturnToMap: () => void;
}

function buildPresetDateRange(days: number): DateRange {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function qualityTextColor(status: string | null | undefined): string {
  if (status === 'valid') return 'text-emerald-700';
  if (status === 'stale') return 'text-amber-700';
  if (status === 'cloud_masked' || status === 'shadow_masked' || status === 'water_masked') {
    return 'text-amber-700';
  }
  return 'text-rose-700';
}

export function EnvironmentalIntelligenceView({
  ecostressResult,
  hlsResult,
  ecostressCapabilities,
  hlsCapabilities,
  ecostressJob,
  hlsJob,
  environmentalAnalytics = null,
  analyticsLoading = false,
  farmIntelligence = null,
  farmIntelligenceLoading = false,
  loading,
  error,
  dateRange,
  onChangeDateRange,
  onFetchEnvironmental,
  onReturnToMap,
}: EnvironmentalIntelligenceViewProps) {
  const { activeCoordinates, selectedBoundary, markerLabel } = useSelectedFarmGeometry();
  const [showGlossary, setShowGlossary] = useState(false);

  const parcelLabel = selectedBoundary
    ? `${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha polygon)`
    : `${markerLabel} (Point coordinate)`;

  const ecoSummary = useMemo(() => extractLatestEcostressView(ecostressResult), [ecostressResult]);
  const hlsSummary = useMemo(() => extractLatestHlsView(hlsResult), [hlsResult]);

  const ndviPoints = useMemo(() => buildNdviSeries(hlsResult), [hlsResult]);
  const ndwiPoints = useMemo(() => buildNdwiSeries(hlsResult), [hlsResult]);
  const etPoints = useMemo(() => buildEtSeries(ecostressResult), [ecostressResult]);
  const esiPoints = useMemo(() => buildEsiSeries(ecostressResult), [ecostressResult]);

  const ecoObservationsDesc = useMemo(
    () =>
      ecostressResult
        ? sortEcostressObservationsChronological(ecostressResult.observations).reverse()
        : [],
    [ecostressResult],
  );
  const hlsObservationsDesc = useMemo(
    () =>
      hlsResult ? sortHlsObservationsChronological(hlsResult.observations).reverse() : [],
    [hlsResult],
  );

  const authUnconfigured =
    (ecostressCapabilities && !ecostressCapabilities.authentication.configured) ||
    (hlsCapabilities && !hlsCapabilities.authentication.configured);

  const hasAnyStale =
    Boolean(ecoSummary?.etIsStale) ||
    Boolean(ecoSummary?.esiIsStale) ||
    Boolean(hlsSummary?.ndviIsStale) ||
    Boolean(hlsSummary?.ndwiIsStale) ||
    (ecoSummary?.staleObservations ?? 0) > 0 ||
    (hlsSummary?.staleObservations ?? 0) > 0;

  const timestampsDiffer = areDatesDistinct(
    ecoSummary?.etObservationDate ?? ecoSummary?.esiObservationDate ?? null,
    hlsSummary?.ndviAcquisitionDate ?? hlsSummary?.ndwiAcquisitionDate ?? null,
  );

  function applyPreset(days: number) {
    const next = buildPresetDateRange(days);
    onChangeDateRange(next);
    onFetchEnvironmental(next);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Header & Query Controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              High-Resolution NASA Satellite &amp; Thermal Telemetry
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Environmental Intelligence: ECOSTRESS &amp; Landsat/HLS
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Target: <span className="font-semibold text-slate-800">{parcelLabel}</span> ·{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {activeCoordinates.latitude.toFixed(4)}°, {activeCoordinates.longitude.toFixed(4)}°
              </span>{' '}
              · Extraction Mode:{' '}
              <span className="font-mono font-medium text-slate-800">
                {selectedBoundary ? 'Polygon Raster Stats' : 'Point Coordinate'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGlossary((v) => !v)}
              aria-expanded={showGlossary}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Info className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              {showGlossary ? 'Hide Metric Guide' : 'Farmer Metric Guide'}
            </button>
            <button
              type="button"
              onClick={onReturnToMap}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              View on Map
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => onFetchEnvironmental()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {loading ? 'Querying NASA AppEEARS…' : 'Load ECOSTRESS & HLS Data'}
            </button>
          </div>
        </div>

        {/* Date Window & Presets */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="env-start" className="block text-[11px] font-medium text-slate-600">
                Start Date (ECOSTRESS ≥ 2018-07-10)
              </label>
              <input
                id="env-start"
                type="date"
                min="2018-07-10"
                max={dateRange.endDate}
                value={dateRange.startDate}
                onChange={(e) => onChangeDateRange({ ...dateRange, startDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="env-end" className="block text-[11px] font-medium text-slate-600">
                End Date
              </label>
              <input
                id="env-end"
                type="date"
                min={dateRange.startDate}
                value={dateRange.endDate}
                onChange={(e) => onChangeDateRange({ ...dateRange, endDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {[
              { label: '30 Days', days: 30 },
              { label: '60 Days', days: 60 },
              { label: '90 Days', days: 90 },
              { label: '180 Days', days: 180 },
            ].map((preset) => (
              <button
                key={preset.days}
                type="button"
                disabled={loading}
                onClick={() => applyPreset(preset.days)}
                className="rounded px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white hover:text-slate-900 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Farmer-Friendly Technical Glossary */}
        {showGlossary && (
          <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-900">ECOSTRESS Daily ET (W/m²)</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                Measures latent heat flux leaving plants and soil at 70 m resolution. Reported in{' '}
                <strong className="text-slate-800">W/m²</strong> (energy flux),{' '}
                <strong className="text-slate-800">not mm/day</strong> irrigation volume.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-900">Evaporative Stress Index (ESI)</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                Ratio (0 to 1) of actual ET to potential ET. Values below{' '}
                <strong className="text-rose-700">0.40</strong> signal canopy thermal/moisture stress
                before visible leaf wilting appears.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-900">Landsat/HLS NDVI (-1 to 1)</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                30 m optical canopy greenness and photosynthetic vigor from NASA HLS (Landsat 8/9 +
                Sentinel-2). Bare soil is typically 0.10–0.20; active dense crops reach 0.55–0.85.
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-900">Landsat/HLS NDWI (-1 to 1)</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                Optical canopy/surface wetness index. Reflects{' '}
                <strong className="text-slate-800">leaf/surface moisture</strong>, not subsurface
                root-zone soil water (use NASA SMAP for root-zone m³/m³).
              </p>
            </div>
          </div>
        )}
      </section>

      {/* NASA AppEEARS Credential Advisory when server has no token configured */}
      {authUnconfigured && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <span className="font-semibold">NASA Earthdata / AppEEARS Credentials Notice:</span>{' '}
            Live ECOSTRESS &amp; HLS extraction requires server-side NASA Earthdata / AppEEARS authentication. Check server configuration if extraction jobs return authentication errors; unavailable values will remain unpopulated.
          </div>
        </div>
      )}

      {/* Async Job Status Progress */}
      {loading && (
        <section
          aria-live="polite"
          className="rounded-md border border-blue-200 bg-blue-50/70 p-4 text-xs text-slate-700 space-y-2"
        >
          <div className="flex items-center gap-2 font-medium text-blue-900">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
            Submitting and polling NASA LP DAAC AppEEARS extraction tasks…
          </div>
          <div className="grid gap-2 sm:grid-cols-2 font-mono tabular-nums text-[11px]">
            <div className="rounded border border-blue-200/80 bg-white px-3 py-2">
              ECOSTRESS (70 m):{' '}
              <span className="font-semibold text-slate-900">
                {ecostressJob ? `${ecostressJob.status} (${ecostressJob.upstreamStatus})` : 'initializing…'}
              </span>
              {ecostressJob?.progressPercent !== undefined && ` · ${ecostressJob.progressPercent}%`}
            </div>
            <div className="rounded border border-blue-200/80 bg-white px-3 py-2">
              Landsat/HLS (30 m):{' '}
              <span className="font-semibold text-slate-900">
                {hlsJob ? `${hlsJob.status} (${hlsJob.upstreamStatus})` : 'checking cache / submitting…'}
              </span>
              {hlsJob?.progressPercent !== undefined && ` · ${hlsJob.progressPercent}%`}
            </div>
          </div>
        </section>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => onFetchEnvironmental()}
            className="rounded border border-rose-300 bg-white px-3 py-1 font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
          >
            Retry Query
          </button>
        </div>
      )}

      {/* Empty State before first fetch */}
      {!loading && !ecostressResult && !hlsResult && !error && (
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <Leaf className="mx-auto h-8 w-8 text-emerald-700" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-slate-900">
            No ECOSTRESS or Landsat/HLS Observations Loaded Yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-xl text-xs text-slate-600">
            Query NASA LP DAAC AppEEARS for 70 m thermal evapotranspiration (ECO_L3T_JET / ECO_L4T_ESI) and 30 m Harmonized Landsat Sentinel-2 reflectance (HLSL30 / HLSS30 NDVI &amp; NDWI) across your selected farm parcel.
          </p>
          <button
            type="button"
            onClick={() => onFetchEnvironmental()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Fetch Satellite &amp; ET Observations
          </button>
        </section>
      )}

      {/* Product/Timestamp Separation & Stale Data Notices */}
      {(ecostressResult || hlsResult) && (
        <div className="space-y-2.5">
          {hasAnyStale && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <span className="font-semibold">Stale Observation Warning:</span> One or more latest clear-sky satellite overpasses are older than 45 days or marked stale by quality checks. Interpret current field stress cautiously and widen the date range if newer cloud-free passes are expected.
              </div>
            </div>
          )}

          {timestampsDiffer && (
            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
              <div>
                <span className="font-semibold text-slate-900">
                  Independent Acquisition Timestamps:
                </span>{' '}
                Latest ECOSTRESS overpass (
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatShortDate(ecoSummary?.etObservationDate ?? ecoSummary?.esiObservationDate)}
                </span>
                ) and latest Landsat/HLS scene (
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatShortDate(hlsSummary?.ndviAcquisitionDate ?? hlsSummary?.ndwiAcquisitionDate)}
                </span>
                ) come from distinct missions and dates — they are displayed separately and never combined as simultaneous measurements.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* PHASE 4: DATA QUALITY, CONFIDENCE, TEMPORAL, STRESS & ALERTS      */}
      {/* ================================================================= */}
      {(ecostressResult || hlsResult) && analyticsLoading && !environmentalAnalytics && (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
          Evaluating satellite data quality, multi-temporal trends, and stress screening rules…
        </div>
      )}

      {environmentalAnalytics && (
        <section aria-labelledby="phase4-analytics-heading" className="space-y-4">
          {/* 4D / 4A Data Quality & Confidence Overview */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Phase 4 Validation &amp; Confidence Assessment
                </p>
                <h2
                  id="phase4-analytics-heading"
                  className="mt-0.5 flex items-center gap-2 text-base font-semibold text-slate-900"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  Satellite Data Quality, Confidence &amp; Evidence Strength
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-xs">
                <div>
                  <span className="text-slate-500">Quality: </span>
                  <span className="font-semibold uppercase text-slate-900">
                    {environmentalAnalytics.qualityReport.overallGrade} (
                    {environmentalAnalytics.qualityReport.overallScore0To100}/100)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Confidence: </span>
                  <span className="font-semibold uppercase text-slate-900">
                    {environmentalAnalytics.confidenceAssessment.confidenceLevel} (
                    {environmentalAnalytics.confidenceAssessment.confidenceScore0To100}/100)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Evidence: </span>
                  <span className="font-semibold uppercase text-slate-900">
                    {environmentalAnalytics.confidenceAssessment.evidenceStrength}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  ECOSTRESS (70m) Quality
                </p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900 uppercase">
                  {environmentalAnalytics.qualityReport.ecostress.grade} ·{' '}
                  {environmentalAnalytics.qualityReport.ecostress.score0To100}/100
                </p>
                <p className="font-mono tabular-nums text-[11px] text-slate-600">
                  Usable: {environmentalAnalytics.qualityReport.ecostress.usableScenesCount}/
                  {environmentalAnalytics.qualityReport.ecostress.totalScenes} scenes · Mean Cov:{' '}
                  {environmentalAnalytics.qualityReport.ecostress.meanCoveragePercent !== null
                    ? `${environmentalAnalytics.qualityReport.ecostress.meanCoveragePercent.toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Landsat / HLS (30m) Quality
                </p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900 uppercase">
                  {environmentalAnalytics.qualityReport.hls.grade} ·{' '}
                  {environmentalAnalytics.qualityReport.hls.score0To100}/100
                </p>
                <p className="font-mono tabular-nums text-[11px] text-slate-600">
                  Usable: {environmentalAnalytics.qualityReport.hls.usableScenesCount}/
                  {environmentalAnalytics.qualityReport.hls.totalScenes} scenes · Mean Cov:{' '}
                  {environmentalAnalytics.qualityReport.hls.meanCoveragePercent !== null
                    ? `${environmentalAnalytics.qualityReport.hls.meanCoveragePercent.toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Validation Integrity
                </p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {environmentalAnalytics.qualityReport.totalIssuesCount} flags ·{' '}
                  {environmentalAnalytics.qualityReport.genuineZeroObservationsCount} zero(s) kept
                </p>
                <p className="text-[11px] text-slate-600">
                  Fill values (-999/-9999) and masked scenes excluded; valid 0 readings preserved.
                </p>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Cross-Mission Separation
                </p>
                <p className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {environmentalAnalytics.temporalAnalysis.crossMissionAlignment.acquisitionGapDays !==
                  null
                    ? `${environmentalAnalytics.temporalAnalysis.crossMissionAlignment.acquisitionGapDays}d date offset`
                    : 'Single mission'}
                </p>
                <p className="text-[11px] text-slate-600">
                  ECOSTRESS thermal and HLS optical dates evaluated independently.
                </p>
              </div>
            </div>

            {environmentalAnalytics.confidenceAssessment.uncertaintyExplanations.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-700 space-y-1">
                <p className="font-semibold text-slate-900">
                  Confidence Factors &amp; Uncertainty Limitations
                </p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {environmentalAnalytics.confidenceAssessment.uncertaintyExplanations.map(
                    (note, idx) => (
                      <li key={idx}>{note}</li>
                    ),
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* 4E Monitoring Alerts */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Bell className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Environmental Monitoring Alerts (
                {environmentalAnalytics.monitoringReport.alerts.length})
              </h3>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                Suppressed masked/insufficient: {environmentalAnalytics.monitoringReport.suppressedInvalidOrInsufficientCount} · Deduplicated: {environmentalAnalytics.monitoringReport.deduplicatedCount}
              </span>
            </div>

            {environmentalAnalytics.monitoringReport.alerts.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span>{environmentalAnalytics.monitoringReport.summaryNote}</span>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {environmentalAnalytics.monitoringReport.alerts.map((alert) => {
                  const boxTone =
                    alert.severity === 'critical'
                      ? 'border-rose-200 bg-rose-50/70 text-rose-950'
                      : alert.severity === 'warning'
                        ? 'border-amber-200 bg-amber-50/70 text-amber-950'
                        : 'border-slate-200 bg-slate-50 text-slate-900';
                  return (
                    <article
                      key={alert.id}
                      className={`rounded-md border p-3.5 text-xs space-y-1.5 ${boxTone}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{alert.title}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                          {alert.severity} · {alert.claimType.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed">{alert.farmerExplanation}</p>
                      <p className="font-mono tabular-nums text-[11px] opacity-85">
                        Evidence: {alert.metricEvidence}
                        {alert.observationDates.length > 0
                          ? ` (${alert.observationDates.map((d) => formatShortDate(d)).join(', ')})`
                          : ''}
                      </p>
                      <p className="text-[11px] opacity-90">
                        <strong>Verify:</strong> {alert.recommendedVerification}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4B Multi-Temporal Analysis & Sampling Gaps */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Multi-Temporal Trend &amp; Sampling Gap Analysis
              </h3>
              <p className="text-[11px] text-slate-500">
                Observed clear-sky values are kept strictly separate from linear regression trends (≥{' '}
                {environmentalAnalytics.temporalAnalysis.minimumTrendObservations} scenes &amp; ≥{' '}
                {environmentalAnalytics.temporalAnalysis.minimumTrendSpanDays} days required)
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {(
                [
                  environmentalAnalytics.temporalAnalysis.series.ndvi,
                  environmentalAnalytics.temporalAnalysis.series.ndwi,
                  environmentalAnalytics.temporalAnalysis.series.etDailyWm2,
                  environmentalAnalytics.temporalAnalysis.series.esiRatio,
                ] as const
              ).map((series) => {
                const stats = series.calculatedStatistics;
                const TrendIcon =
                  stats.trendDirection === 'increasing'
                    ? TrendingUp
                    : stats.trendDirection === 'decreasing'
                      ? TrendingDown
                      : Info;
                return (
                  <div
                    key={series.metric}
                    className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{series.label}</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-slate-700">
                        <TrendIcon className="h-3 w-3" aria-hidden="true" />
                        {stats.trendDirection.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <div className="space-y-0.5 font-mono tabular-nums text-[11px] text-slate-700">
                      <p>
                        Observed Scenes: {series.validObservationCount}
                        {series.timeSpanDays !== null ? ` (${series.timeSpanDays}d span)` : ''}
                      </p>
                      <p>
                        Net Change:{' '}
                        {stats.netChange !== null
                          ? `${stats.netChange >= 0 ? '+' : ''}${stats.netChange.toFixed(series.metric === 'etDailyWm2' ? 1 : 3)} ${series.unit}`
                          : 'Unavailable'}
                      </p>
                      {stats.trendEligible && stats.slopePerWeek !== null ? (
                        <p>
                          Trend Slope: {stats.slopePerWeek >= 0 ? '+' : ''}
                          {stats.slopePerWeek.toFixed(series.metric === 'etDailyWm2' ? 1 : 3)} /wk
                        </p>
                      ) : (
                        <p className="font-sans text-[10px] text-amber-800">
                          {stats.trendIneligibilityReason ?? 'Trend ineligible'}
                        </p>
                      )}
                      {series.hasIrregularSamplingGaps && (
                        <p className="font-sans text-[10px] text-amber-800">
                          Irregular sampling gap (&gt;14d) between clear-sky scenes.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4C Explainable Environmental Stress Screening */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Explainable Environmental Stress Screening
              </h3>
              <span className="font-mono text-[11px] uppercase text-slate-700">
                Overall: {environmentalAnalytics.stressReport.overallStatus.replaceAll('_', ' ')}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
              {environmentalAnalytics.stressReport.indicators.map((indicator) => (
                <div
                  key={indicator.id}
                  className="rounded-md border border-slate-200 bg-slate-50/60 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{indicator.title}</span>
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase ${
                        indicator.status === 'observed_concern'
                          ? 'text-rose-700'
                          : indicator.status === 'possible_stress'
                            ? 'text-amber-700'
                            : indicator.status === 'nominal'
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                      }`}
                    >
                      {indicator.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-700">
                    {indicator.agronomicInterpretation}
                  </p>
                  {indicator.directObservations.length > 0 && (
                    <p className="font-mono tabular-nums text-[10px] text-slate-600">
                      Observed: {indicator.directObservations[0]}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500">
                    Guardrail: {indicator.prohibitedInferenceGuardrail}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-slate-500">
              {environmentalAnalytics.stressReport.diagnosticDisclaimer}
            </p>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* PHASE 5: FARM-LEVEL POSTURE, 7-14D TREND PROJECTIONS & ACTION PLAN */}
      {/* ================================================================= */}
      {(ecostressResult || hlsResult) && farmIntelligenceLoading && !farmIntelligence && (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
          Synthesizing parcel-level posture, 7–14 day trend projections, and farmer verification steps…
        </div>
      )}

      {farmIntelligence && (
        <section aria-labelledby="phase5-intelligence-heading" className="space-y-4">
          {/* 5A Overall Parcel Posture & Spatial Scale Context */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Phase 5 Farm-Level Predictive &amp; Actionable Intelligence
                </p>
                <h2
                  id="phase5-intelligence-heading"
                  className="mt-0.5 flex items-center gap-2 text-base font-semibold text-slate-900"
                >
                  <Compass className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  Parcel Decision Posture &amp; Spatial Context
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-xs">
                <span
                  className={`rounded border px-2.5 py-1 text-[11px] font-semibold uppercase ${
                    farmIntelligence.postureStatus === 'attention_needed'
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : farmIntelligence.postureStatus === 'watch'
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : farmIntelligence.postureStatus === 'nominal'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  Posture: {farmIntelligence.postureStatus.replaceAll('_', ' ')}
                </span>
                <span className="text-[11px] text-slate-500">
                  Eligible 7–14d Projections: {farmIntelligence.predictiveInsights.eligibleMetricsCount}/4
                </span>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-800">
              {farmIntelligence.postureSummary}
            </p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Target Scale &amp; Mode
                </p>
                <p className="font-semibold text-slate-900">
                  {farmIntelligence.spatialSummary.parcelLabel}
                </p>
                <p className="font-mono text-[11px] text-slate-600">
                  Mode: {farmIntelligence.spatialSummary.extractionMode.replaceAll('_', ' ')}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  High-Res Satellite Sensors
                </p>
                <p className="font-mono text-[11px] text-slate-700">
                  ECOSTRESS: {farmIntelligence.spatialSummary.ecostressResolution ?? 'Not loaded'}
                </p>
                <p className="font-mono text-[11px] text-slate-700">
                  Landsat/HLS: {farmIntelligence.spatialSummary.hlsResolution ?? 'Not loaded'}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Coarse Climate &amp; Soil Context
                </p>
                <p className="font-mono tabular-nums text-[11px] text-slate-700">
                  Rain: {farmIntelligence.observedConditions.weatherTotalPrecipitationMm !== null
                    ? `${farmIntelligence.observedConditions.weatherTotalPrecipitationMm.toFixed(1)} mm`
                    : 'Not loaded'} · SMAP Root:{' '}
                  {farmIntelligence.observedConditions.smapRootZoneMoistureM3M3 !== null
                    ? `${farmIntelligence.observedConditions.smapRootZoneMoistureM3M3.toFixed(3)} m³/m³`
                    : 'Not loaded'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {farmIntelligence.spatialSummary.smapScaleNote}
                </p>
              </div>
            </div>
          </div>

          {/* 5B Predictive 7–14 Day Trend Insights */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-slate-900">
                7–14 Day Statistical Trend Projections (Non-Forecast)
              </h3>
              <span className="font-mono text-[11px] text-slate-500">
                Requires ≥ {farmIntelligence.predictiveInsights.minimumRequiredObservations} clear-sky scenes &amp; ≥{' '}
                {farmIntelligence.predictiveInsights.minimumRequiredSpanDays}d span
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              {(
                [
                  farmIntelligence.predictiveInsights.insights.ndvi,
                  farmIntelligence.predictiveInsights.insights.ndwi,
                  farmIntelligence.predictiveInsights.insights.esiRatio,
                  farmIntelligence.predictiveInsights.insights.etDailyWm2,
                ] as const
              ).map((insight) => {
                const digits = insight.metric === 'etDailyWm2' ? 1 : 3;
                const p7 = insight.projections.find((p) => p.horizonDays === 7);
                const p14 = insight.projections.find((p) => p.horizonDays === 14);
                return (
                  <div
                    key={insight.metric}
                    className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{insight.label}</span>
                      <span className="font-mono text-[10px] uppercase text-slate-600">
                        {insight.projectionEligible
                          ? `${insight.confidenceLevel} conf.`
                          : 'withheld'}
                      </span>
                    </div>
                    {insight.projectionEligible && p7 && p14 ? (
                      <div className="space-y-1 font-mono tabular-nums text-[11px] text-slate-700">
                        <p>
                          +7d ({p7.targetDate}):{' '}
                          <strong className="text-slate-900">
                            {p7.projectedValue.toFixed(digits)}
                          </strong>{' '}
                          <span className="text-[10px] text-slate-500">
                            [{p7.lowerBound.toFixed(digits)}–{p7.upperBound.toFixed(digits)}]
                          </span>
                        </p>
                        <p>
                          +14d ({p14.targetDate}):{' '}
                          <strong className="text-slate-900">
                            {p14.projectedValue.toFixed(digits)}
                          </strong>{' '}
                          <span className="text-[10px] text-slate-500">
                            [{p14.lowerBound.toFixed(digits)}–{p14.upperBound.toFixed(digits)}]
                          </span>
                        </p>
                        <p className="font-sans text-[10px] leading-snug text-slate-600">
                          {insight.interpretation}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-snug text-amber-800">
                        {insight.ineligibilityReason ?? insight.interpretation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-slate-500">
              {farmIntelligence.predictiveInsights.globalPredictionDisclaimer}
            </p>
          </div>

          {/* 5C Actionable Farmer Verification Plan */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ClipboardCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                Actionable Farmer Verification Steps (
                {farmIntelligence.actionRecommendations.recommendations.length})
              </h3>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                Suppressed inconclusive triggers:{' '}
                {farmIntelligence.actionRecommendations.suppressedGenericOrUnsafeCount}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {farmIntelligence.actionRecommendations.recommendations.map((rec) => {
                const cardBorder =
                  rec.priority === 'high'
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-slate-200 bg-slate-50/60';
                return (
                  <article
                    key={rec.id}
                    className={`rounded-md border p-4 text-xs space-y-2 ${cardBorder}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-slate-900">{rec.title}</h4>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 whitespace-nowrap shrink-0">
                        {rec.priority} priority · {rec.confidence} conf.
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-700">{rec.reason}</p>
                    <p className="font-mono tabular-nums text-[11px] text-slate-800">
                      Evidence: {rec.evidence}
                      {rec.observationDates.length > 0
                        ? ` (${rec.observationDates.map((d) => formatShortDate(d)).join(', ')})`
                        : ''}
                    </p>
                    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-800">
                      <span className="font-semibold text-emerald-800">Next Verification Step: </span>
                      {rec.nextVerificationStep}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Limitation: {rec.limitations}
                    </p>
                    <p className="text-[10px] font-medium text-slate-600">
                      {rec.prohibitedActionsGuardrail}
                    </p>
                  </article>
                );
              })}
            </div>

            {/* Scientific Epistemic Separation Footer */}
            <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700 md:grid-cols-3">
              <p>
                <strong className="text-slate-900">1. Direct Observations: </strong>
                {farmIntelligence.distinctionNotice.observationsLabel}
              </p>
              <p>
                <strong className="text-slate-900">2. Screened Inferences: </strong>
                {farmIntelligence.distinctionNotice.inferencesLabel}
              </p>
              <p>
                <strong className="text-slate-900">3. Trend Projections: </strong>
                {farmIntelligence.distinctionNotice.predictionsLabel}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* SECTION A: NASA ECOSTRESS EVAPOTRANSPIRATION & ESI (70 m)          */}
      {/* ================================================================= */}
      {ecostressResult && (
        <section aria-labelledby="ecostress-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <h2
                id="ecostress-heading"
                className="flex items-center gap-2 text-base font-semibold text-slate-900"
              >
                <Flame className="h-4 w-4 text-orange-600" aria-hidden="true" />
                A. NASA ECOSTRESS Thermal Evapotranspiration &amp; Stress
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Products: <span className="font-mono text-slate-700">{ecostressResult.products.join(', ')}</span> · Resolution:{' '}
                <span className="font-mono text-slate-700">{ecostressResult.spatialResolution.label}</span> · Source:{' '}
                {ecostressResult.sourceAttribution.providerName}
              </p>
            </div>
            <p className="font-mono tabular-nums text-[11px] text-slate-500">
              Retrieved: {formatUtcTimestamp(ecostressResult.retrievedAt)}
              {ecostressResult.sourceAttribution.cached ? ' (cached)' : ''}
            </p>
          </div>

          {/* ECOSTRESS KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Daily Evapotranspiration (ET)
                </p>
                <span className="font-mono text-[10px] text-slate-500">ECO_L3T_JET</span>
              </div>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {ecoSummary?.latestEtWm2 !== null && ecoSummary?.latestEtWm2 !== undefined ? (
                  <>
                    {ecoSummary.latestEtWm2.toFixed(1)}{' '}
                    <span className="text-xs font-normal text-slate-500">W/m²</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p>Acquired: {formatShortDate(ecoSummary?.etObservationDate)}</p>
                <p>
                  Window Mean:{' '}
                  {ecoSummary?.meanEtWm2 !== null && ecoSummary?.meanEtWm2 !== undefined
                    ? `${ecoSummary.meanEtWm2.toFixed(1)} W/m²`
                    : 'Unavailable'}
                </p>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Thermal latent heat flux (W/m², not mm/day water depth).
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Evaporative Stress Index (ESI)
                </p>
                <span className="font-mono text-[10px] text-slate-500">ECO_L4T_ESI</span>
              </div>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {ecoSummary?.latestEsiRatio !== null && ecoSummary?.latestEsiRatio !== undefined ? (
                  <>
                    {ecoSummary.latestEsiRatio.toFixed(3)}{' '}
                    <span className="text-xs font-normal text-slate-500">ratio (0–1)</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p>Acquired: {formatShortDate(ecoSummary?.esiObservationDate)}</p>
                <p>
                  Window Mean:{' '}
                  {ecoSummary?.meanEsiRatio !== null && ecoSummary?.meanEsiRatio !== undefined
                    ? ecoSummary.meanEsiRatio.toFixed(3)
                    : 'Unavailable'}
                </p>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {ecoSummary?.latestEsiRatio !== null && ecoSummary?.latestEsiRatio !== undefined
                  ? ecoSummary.latestEsiRatio < 0.4
                    ? 'Elevated evaporative/thermal stress detected (< 0.40).'
                    : ecoSummary.latestEsiRatio < 0.7
                      ? 'Moderate evaporative demand ratio (0.40–0.70).'
                      : 'Low evaporative stress (≥ 0.70 actual/potential ET).'
                  : 'No valid ESI ratio in window.'}
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Polygon Coverage &amp; Quality
              </p>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {ecoSummary?.etCoveragePercent !== null && ecoSummary?.etCoveragePercent !== undefined ? (
                  <>
                    {ecoSummary.etCoveragePercent.toFixed(1)}
                    <span className="ml-0.5 text-xs font-normal text-slate-500">%</span>
                  </>
                ) : ecoSummary?.meanCoveragePercent !== null && ecoSummary?.meanCoveragePercent !== undefined ? (
                  <>
                    {ecoSummary.meanCoveragePercent.toFixed(1)}
                    <span className="ml-0.5 text-xs font-normal text-slate-500">% avg</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p className={qualityTextColor(ecoSummary?.etQualityStatus)}>
                  Status: {formatQualityLabel(ecoSummary?.etQualityStatus)}
                </p>
                <p>
                  Clear / Cloud / Water: {ecoSummary?.clearSkyObservations ?? 0} /{' '}
                  {ecoSummary?.cloudMaskedObservations ?? 0} / {ecoSummary?.waterMaskedObservations ?? 0}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                ECOSTRESS Metadata
              </p>
              <p className="mt-1.5 font-mono text-sm font-semibold text-slate-900">
                {ecostressResult.spatialResolution.label}
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                <p>DAAC: {ecostressResult.sourceAttribution.daac}</p>
                <p>Task Mode: {ecostressResult.taskType === 'area' ? 'Polygon Area' : 'Point Sample'}</p>
                <p className="font-mono tabular-nums">
                  Retrieved: {formatShortDate(ecostressResult.retrievedAt)}
                </p>
              </div>
            </div>
          </div>

          {/* ECOSTRESS Charts */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <EtTrendChart
              points={etPoints}
              projectedSeries={farmIntelligence?.predictiveInsights.insights.etDailyWm2}
            />
            <EsiTrendChart
              points={esiPoints}
              projectedSeries={farmIntelligence?.predictiveInsights.insights.esiRatio}
            />
          </div>

          {/* ECOSTRESS Dated Observations Log */}
          {ecoObservationsDesc.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  ECOSTRESS Overpass Log ({ecoObservationsDesc.length} scenes)
                </h3>
                <span className="text-[11px] text-slate-500">
                  Cloud-masked and invalid observations remain flagged rather than interpolated
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 pr-3 font-medium">Acquisition Date</th>
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 font-medium">ET Daily (W/m²)</th>
                      <th className="py-2 pr-3 font-medium">ESI (0–1)</th>
                      <th className="py-2 pr-3 font-medium">Coverage (%)</th>
                      <th className="py-2 pr-3 font-medium">Quality Status</th>
                      <th className="py-2 font-medium">Retrieved</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {ecoObservationsDesc.slice(0, 12).map((obs, idx) => (
                      <tr key={`${obs.productId}-${obs.observationTimestamp}-${idx}`}>
                        <td className="py-2 pr-3 text-slate-900">
                          {formatShortDate(obs.observationTimestamp)}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{obs.productId}</td>
                        <td className="py-2 pr-3 text-slate-900">
                          {obs.etDailyWm2 !== null ? obs.etDailyWm2.toFixed(1) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-900">
                          {obs.esiRatio !== null ? obs.esiRatio.toFixed(3) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-700">
                          {obs.coveragePercent !== null ? `${obs.coveragePercent.toFixed(1)}%` : '—'}
                        </td>
                        <td className={`py-2 pr-3 font-sans font-medium ${qualityTextColor(obs.qualityStatus)}`}>
                          {formatQualityLabel(obs.qualityStatus)}
                        </td>
                        <td className="py-2 text-slate-500">
                          {formatShortDate(obs.retrievalTimestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SECTION B: NASA LANDSAT / SENTINEL-2 HLS VEGETATION & WATER (30m) */}
      {/* ================================================================= */}
      {hlsResult && (
        <section aria-labelledby="hls-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <h2
                id="hls-heading"
                className="flex items-center gap-2 text-base font-semibold text-slate-900"
              >
                <Leaf className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                B. NASA Landsat / Sentinel-2 HLS Vegetation &amp; Water Indices
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Products: <span className="font-mono text-slate-700">{hlsResult.products.join(', ')}</span> · Resolution:{' '}
                <span className="font-mono text-slate-700">{hlsResult.spatialResolution.label}</span> · Source:{' '}
                {hlsResult.sourceAttribution.providerName}
              </p>
            </div>
            <p className="font-mono tabular-nums text-[11px] text-slate-500">
              Retrieved: {formatUtcTimestamp(hlsResult.retrievedAt)}
              {hlsResult.sourceAttribution.cached ? ' (cached)' : ''}
            </p>
          </div>

          {/* HLS KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Latest NDVI (Greenness)
                </p>
                <span className="font-mono text-[10px] text-slate-500">
                  {hlsSummary?.ndviProductId ?? 'HLS'}
                </span>
              </div>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {hlsSummary?.latestNdvi !== null && hlsSummary?.latestNdvi !== undefined ? (
                  <>
                    {hlsSummary.latestNdvi.toFixed(3)}{' '}
                    <span className="text-xs font-normal text-slate-500">ratio (-1 to 1)</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p>Acquired: {formatShortDate(hlsSummary?.ndviAcquisitionDate)}</p>
                <p>
                  Range:{' '}
                  {hlsSummary?.minNdvi !== null &&
                  hlsSummary?.minNdvi !== undefined &&
                  hlsSummary?.maxNdvi !== null &&
                  hlsSummary?.maxNdvi !== undefined
                    ? `${hlsSummary.minNdvi.toFixed(3)} – ${hlsSummary.maxNdvi.toFixed(3)}`
                    : 'Unavailable'}
                </p>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                {hlsSummary?.ndviSensorLabel ?? '30 m Surface Reflectance'}
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Latest NDWI (Canopy Water)
                </p>
                <span className="font-mono text-[10px] text-slate-500">
                  {hlsSummary?.ndwiProductId ?? 'HLS'}
                </span>
              </div>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {hlsSummary?.latestNdwi !== null && hlsSummary?.latestNdwi !== undefined ? (
                  <>
                    {hlsSummary.latestNdwi.toFixed(3)}{' '}
                    <span className="text-xs font-normal text-slate-500">ratio (-1 to 1)</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p>Acquired: {formatShortDate(hlsSummary?.ndwiAcquisitionDate)}</p>
                <p>
                  Window Mean:{' '}
                  {hlsSummary?.meanNdwi !== null && hlsSummary?.meanNdwi !== undefined
                    ? hlsSummary.meanNdwi.toFixed(3)
                    : 'Unavailable'}
                </p>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Canopy/surface wetness index only — distinct from SMAP root-zone soil moisture.
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Valid Pixel Coverage &amp; QA
              </p>
              <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {hlsSummary?.ndviCoveragePercent !== null && hlsSummary?.ndviCoveragePercent !== undefined ? (
                  <>
                    {hlsSummary.ndviCoveragePercent.toFixed(1)}
                    <span className="ml-0.5 text-xs font-normal text-slate-500">%</span>
                  </>
                ) : hlsSummary?.meanCoveragePercent !== null && hlsSummary?.meanCoveragePercent !== undefined ? (
                  <>
                    {hlsSummary.meanCoveragePercent.toFixed(1)}
                    <span className="ml-0.5 text-xs font-normal text-slate-500">% avg</span>
                  </>
                ) : (
                  <span className="text-base text-slate-500">Unavailable</span>
                )}
              </p>
              <div className="mt-2 space-y-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                <p className={qualityTextColor(hlsSummary?.ndviQualityStatus)}>
                  Latest QA: {formatQualityLabel(hlsSummary?.ndviQualityStatus)}
                </p>
                <p>
                  Clear / Cloud / Shadow: {hlsSummary?.clearSkyObservations ?? 0} /{' '}
                  {hlsSummary?.cloudMaskedObservations ?? 0} / {hlsSummary?.shadowMaskedObservations ?? 0}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                HLS Sensor &amp; Provenance
              </p>
              <p className="mt-1.5 font-mono text-sm font-semibold text-slate-900">
                {hlsResult.spatialResolution.label}
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                <p>DAAC: {hlsResult.sourceAttribution.daac}</p>
                <p>Fmask QA: Cloud &amp; shadow filtering active</p>
                <p className="font-mono tabular-nums">
                  Retrieved: {formatShortDate(hlsResult.retrievedAt)}
                </p>
              </div>
            </div>
          </div>

          {/* HLS Charts */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <NdviTimeSeriesChart
              points={ndviPoints}
              projectedSeries={farmIntelligence?.predictiveInsights.insights.ndvi}
            />
            <NdwiTimeSeriesChart
              points={ndwiPoints}
              projectedSeries={farmIntelligence?.predictiveInsights.insights.ndwi}
            />
          </div>

          {/* HLS Scene-by-Scene Cloud & Quality Table */}
          {hlsObservationsDesc.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Landsat / HLS Scene &amp; Fmask Quality Log ({hlsObservationsDesc.length} scenes)
                </h3>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Sensors (HLSL30 vs HLSS30) &amp; cloud/shadow masks tracked per acquisition date
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 pr-3 font-medium">Acquisition Date</th>
                      <th className="py-2 pr-3 font-medium">Sensor / Product</th>
                      <th className="py-2 pr-3 font-medium">NDVI</th>
                      <th className="py-2 pr-3 font-medium">NDWI</th>
                      <th className="py-2 pr-3 font-medium">Valid Coverage</th>
                      <th className="py-2 pr-3 font-medium">Cloud / Shadow Mask</th>
                      <th className="py-2 font-medium">QA Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {hlsObservationsDesc.slice(0, 15).map((obs, idx) => (
                      <tr key={`${obs.productId}-${obs.observationTimestamp}-${idx}`}>
                        <td className="py-2 pr-3 text-slate-900">
                          {formatShortDate(obs.observationTimestamp)}
                        </td>
                        <td className="py-2 pr-3 font-sans text-slate-700">
                          {formatHlsSensorName(obs.productId)}
                        </td>
                        <td className="py-2 pr-3 text-slate-900">
                          {obs.ndvi !== null ? obs.ndvi.toFixed(3) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-900">
                          {obs.ndwi !== null ? obs.ndwi.toFixed(3) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-700">
                          {obs.coveragePercent !== null ? `${obs.coveragePercent.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">
                          Cloud:{obs.cloudMaskFlag ?? 'N/A'} · Shadow:{obs.shadowMaskFlag ?? 'N/A'}
                        </td>
                        <td className={`py-2 font-sans font-medium ${qualityTextColor(obs.qualityStatus)}`}>
                          {formatQualityLabel(obs.qualityStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Attribution & Methodological Caveats Footer */}
      {(ecostressResult || hlsResult) && (
        <footer className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-600 space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            <Droplets className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
            Satellite Data Attribution, Units &amp; Limitations
          </div>
          {ecostressResult && (
            <p>
              <strong className="text-slate-800">{ecostressResult.sourceAttribution.providerName}</strong> ·{' '}
              {ecostressResult.sourceAttribution.datasetNames.join(', ')} ·{' '}
              {ecostressResult.caveats.join(' ')}
            </p>
          )}
          {hlsResult && (
            <p>
              <strong className="text-slate-800">{hlsResult.sourceAttribution.providerName}</strong> ·{' '}
              {hlsResult.sourceAttribution.datasetNames.join(', ')} ·{' '}
              {hlsResult.caveats.join(' ')}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
