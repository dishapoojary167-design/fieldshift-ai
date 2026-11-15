import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Droplets,
  FlaskConical,
  Info,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type {
  LabSoilTestResult,
  SoilDepthInterval,
  SoilMeasurementStats,
  SoilMoistureSnapshot,
  SoilProfile,
} from '../../../shared/index.ts';
import { useSelectedFarmGeometry } from '../../context/FarmWorkspaceContext.tsx';
import { LabSoilTestForm } from './LabSoilTestForm.tsx';
import { SoilAgronomicInsights } from './SoilAgronomicInsights.tsx';
import {
  LabVsModelComparisonChart,
  SmapSoilMoistureChart,
  SoilDepthProfileChart,
  SoilTextureBreakdownCard,
} from './SoilCharts.tsx';

interface SoilIntelligenceViewProps {
  profile: SoilProfile | null;
  moisture: SoilMoistureSnapshot | null;
  loading: boolean;
  error: string | null;
  selectedDepthCm: SoilDepthInterval;
  onChangeDepthCm: (depth: SoilDepthInterval) => void;
  onFetchSoil: (overrideDepth?: SoilDepthInterval) => void;
  onReturnToMap: () => void;
}

const LAB_STORAGE_KEY = 'fieldshift-lab-soil-tests-v1';

const DEPTH_OPTIONS: Array<{ value: SoilDepthInterval; label: string }> = [
  { value: '0-5', label: '0–5 cm' },
  { value: '5-15', label: '5–15 cm' },
  { value: '15-30', label: '15–30 cm' },
  { value: '30-60', label: '30–60 cm' },
];

function loadSavedLabTests(): Record<string, LabSoilTestResult> {
  try {
    const raw = window.localStorage.getItem(LAB_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, LabSoilTestResult>;
  } catch {
    return {};
  }
}

function fmtStatValue(stat: SoilMeasurementStats | undefined, digits = 1): string {
  if (!stat || stat.mean === null) {
    return 'Unavailable';
  }
  return stat.mean.toFixed(digits);
}

function fmtInterval(stat: SoilMeasurementStats | undefined, digits = 1): string {
  if (!stat || stat.q05 === null || stat.q95 === null) {
    return '90% interval unavailable';
  }
  return `Q0.05–Q0.95: ${stat.q05.toFixed(digits)}–${stat.q95.toFixed(digits)} ${stat.unit}`;
}

export function SoilIntelligenceView({
  profile,
  moisture,
  loading,
  error,
  selectedDepthCm,
  onChangeDepthCm,
  onFetchSoil,
  onReturnToMap,
}: SoilIntelligenceViewProps) {
  const { activeCoordinates, selectedBoundary, markerLabel } = useSelectedFarmGeometry();
  const [labTestsByParcel, setLabTestsByParcel] = useState<Record<string, LabSoilTestResult>>(() =>
    loadSavedLabTests(),
  );

  const parcelKey = selectedBoundary ? `boundary:${selectedBoundary.id}` : 'marker:default';
  const parcelLabel = selectedBoundary
    ? `${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha polygon centroid)`
    : markerLabel;
  const activeLabTest = labTestsByParcel[parcelKey] ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(labTestsByParcel));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  }, [labTestsByParcel]);

  const activeLayer = useMemo(() => {
    if (!profile) {
      return undefined;
    }
    return (
      profile.depthLayers.find((layer) => layer.depthIntervalCm === selectedDepthCm) ??
      profile.depthLayers[0]
    );
  }, [profile, selectedDepthCm]);

  function handleSaveLabTest(result: LabSoilTestResult) {
    setLabTestsByParcel((prev) => ({
      ...prev,
      [parcelKey]: result,
    }));
  }

  function handleClearLabTest() {
    setLabTestsByParcel((prev) => {
      const next = { ...prev };
      delete next[parcelKey];
      return next;
    });
  }

  const providerLabel =
    profile?.providerUsed === 'soilgrids-wcs-fallback'
      ? 'ISRIC OGC WCS GeoTIFF Fallback'
      : profile?.providerUsed === 'soilgrids-rest-v2'
        ? 'ISRIC SoilGrids REST v2.0'
        : 'Unavailable';

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Header & Target Parcel Context */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Multi-Source Soil Profiling &amp; Calibration
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Soil Intelligence
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Target:{' '}
              <span className="font-semibold text-slate-800">{parcelLabel}</span>{' '}
              ·{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {activeCoordinates.latitude.toFixed(4)}°, {activeCoordinates.longitude.toFixed(4)}°
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onReturnToMap}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              View on Map
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => onFetchSoil()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {loading ? 'Fetching Soil & SMAP…' : 'Load Soil & SMAP Data'}
            </button>
          </div>
        </div>

        {/* Depth Interval Selector */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Active Depth Interval:</span>
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              {DEPTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeDepthCm(opt.value)}
                  className={`rounded px-2.5 py-1 font-mono text-xs font-medium cursor-pointer whitespace-nowrap ${
                    selectedDepthCm === opt.value
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {profile && (
            <p className="font-mono text-[11px] text-slate-600">
              Source: <span className="font-semibold text-slate-800">{providerLabel}</span> · Retrieved{' '}
              {profile.retrievedAt.slice(0, 19).replace('T', ' ')} UTC
              {profile.sourceAttribution.cached ? ' (cached)' : ''}
            </p>
          )}
        </div>

        {/* Explicit Three-Tier Data Provenance Distinction */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Layers className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              Modelled Soil Estimates
            </div>
            <p className="mt-0.5 text-[11px] text-slate-600">
              ISRIC SoilGrids v2.0 (250 m) · Statistical predictions with Q0.05–Q0.95 confidence bounds, not direct lab assays.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <Droplets className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              Satellite-Derived Moisture
            </div>
            <p className="mt-0.5 text-[11px] text-slate-600">
              NASA SMAP L4 Analyzed (9 km) · Volumetric surface (0–5 cm) &amp; root-zone (0–100 cm) moisture in m³/m³.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              Measured Lab Soil Tests
            </div>
            <p className="mt-0.5 text-[11px] text-slate-600">
              Farmer-entered laboratory values (pH, N, P, K, OM/SOC, CEC) · Ground-truth calibration for parcel management.
            </p>
          </div>
        </div>
      </section>

      {/* Fallback Notice when SoilGrids WCS was used */}
      {profile?.fallbackUsed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <span className="font-semibold">Automatic Fallback Provider Active:</span>{' '}
            {profile.fallbackReason ??
              'ISRIC SoilGrids REST v2.0 was unavailable; soil properties were retrieved from ISRIC OGC WCS 2.0.1 GeoTIFF coverages.'}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => onFetchSoil()}
            className="rounded border border-rose-300 bg-white px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && !profile && !moisture && (
        <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
          Retrieving ISRIC SoilGrids depth profiles and NASA SMAP L4 volumetric moisture…
        </div>
      )}

      {/* Summary KPI Cards */}
      {(profile || moisture) && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* pH */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Soil pH ({selectedDepthCm} cm)
            </p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
              {fmtStatValue(activeLayer?.ph, 1)}
              <span className="ml-1 text-xs font-normal text-slate-500">pH</span>
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              {fmtInterval(activeLayer?.ph, 1)}
            </p>
            {activeLabTest?.ph !== null && activeLabTest?.ph !== undefined && (
              <p className="mt-1 font-mono tabular-nums text-[11px] font-semibold text-emerald-700">
                Lab: {activeLabTest.ph.toFixed(1)} pH
              </p>
            )}
          </div>

          {/* Organic Carbon */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Organic Carbon
            </p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
              {fmtStatValue(activeLayer?.organicCarbonGKg, 1)}
              <span className="ml-1 text-xs font-normal text-slate-500">g/kg</span>
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              {fmtInterval(activeLayer?.organicCarbonGKg, 1)}
            </p>
            {activeLabTest?.organicCarbonGKg !== null &&
              activeLabTest?.organicCarbonGKg !== undefined && (
                <p className="mt-1 font-mono tabular-nums text-[11px] font-semibold text-emerald-700">
                  Lab: {activeLabTest.organicCarbonGKg.toFixed(1)} g/kg
                </p>
              )}
          </div>

          {/* Total Nitrogen */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Total Nitrogen
            </p>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
              {fmtStatValue(activeLayer?.nitrogenGKg, 2)}
              <span className="ml-1 text-xs font-normal text-slate-500">g/kg</span>
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              {fmtInterval(activeLayer?.nitrogenGKg, 2)}
            </p>
            {activeLabTest?.totalNitrogenGKg !== null &&
              activeLabTest?.totalNitrogenGKg !== undefined && (
                <p className="mt-1 font-mono tabular-nums text-[11px] font-semibold text-emerald-700">
                  Lab: {activeLabTest.totalNitrogenGKg.toFixed(2)} g/kg
                </p>
              )}
          </div>

          {/* Texture & Bulk Density */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              USDA Texture
            </p>
            <p className="mt-1 text-base font-semibold text-slate-900">
              {activeLayer?.textureClass ?? 'Unavailable'}
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              Bulk Density: {fmtStatValue(activeLayer?.bulkDensityKgDm3, 2)}{' '}
              {activeLayer?.bulkDensityKgDm3.mean !== null ? 'kg/dm³' : ''}
            </p>
            <p className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-600">
              CEC: {fmtStatValue(activeLayer?.cecCmolKg, 1)}{' '}
              {activeLayer?.cecCmolKg.mean !== null ? 'cmol(c)/kg' : ''}
            </p>
          </div>

          {/* SMAP Surface Moisture */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                SMAP Surface (0–5 cm)
              </p>
              <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-mono font-medium text-cyan-800">
                SPL3SMP_E V006
              </span>
            </div>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
              {moisture?.surfaceMoistureM3M3 !== null && moisture?.surfaceMoistureM3M3 !== undefined
                ? moisture.surfaceMoistureM3M3.toFixed(3)
                : 'Unavailable'}
              {moisture?.surfaceMoistureM3M3 !== null && moisture?.surfaceMoistureM3M3 !== undefined && (
                <span className="ml-1 text-xs font-normal text-slate-500">m³/m³</span>
              )}
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              {moisture?.observationDate
                ? `Obs: ${moisture.observationDate}`
                : 'No SMAP observation'}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">
              9 km EASE-Grid · qual_flag: 0 (nominal)
            </p>
          </div>

          {/* SMAP Root-Zone Moisture */}
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                SMAP Root Zone (0–1 m)
              </p>
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-mono font-medium text-indigo-800">
                SPL4SMGP V007
              </span>
            </div>
            <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
              {moisture?.rootZoneMoistureM3M3 !== null &&
              moisture?.rootZoneMoistureM3M3 !== undefined
                ? moisture.rootZoneMoistureM3M3.toFixed(3)
                : 'Unavailable'}
              {moisture?.rootZoneMoistureM3M3 !== null &&
                moisture?.rootZoneMoistureM3M3 !== undefined && (
                  <span className="ml-1 text-xs font-normal text-slate-500">m³/m³</span>
                )}
            </p>
            <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
              {moisture?.rootZoneMoistureBinM3M3
                ? `Bin: ${moisture.rootZoneMoistureBinM3M3[0].toFixed(3)}–${moisture.rootZoneMoistureBinM3M3[1].toFixed(3)} m³/m³`
                : 'Model Assimilation'}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">
              Land-surface model assimilation
            </p>
          </div>
        </section>
      )}

      {/* Charts Grid */}
      {profile && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <SoilDepthProfileChart
            depthLayers={profile.depthLayers}
            selectedDepthCm={selectedDepthCm}
            labTest={activeLabTest}
          />
          <SoilTextureBreakdownCard
            depthLayers={profile.depthLayers}
            selectedDepthCm={selectedDepthCm}
            labTest={activeLabTest}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LabVsModelComparisonChart layer={activeLayer} labTest={activeLabTest} />
        {moisture && (
          <SmapSoilMoistureChart moisture={moisture} onReturnToMap={onReturnToMap} />
        )}
      </div>

      {/* Depth Horizons Table */}
      {profile && (
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                ISRIC SoilGrids Depth Horizon Summary (Modelled Estimates)
              </h2>
              <p className="text-[11px] text-slate-500">
                Mean [Q0.05–Q0.95] across standard SoilGrids depth intervals · Units listed in column headers
              </p>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-2 pr-3 font-medium">Depth</th>
                  <th className="py-2 pr-3 font-medium">Texture</th>
                  <th className="py-2 pr-3 font-medium">pH (H₂O)</th>
                  <th className="py-2 pr-3 font-medium">SOC (g/kg)</th>
                  <th className="py-2 pr-3 font-medium">Total N (g/kg)</th>
                  <th className="py-2 pr-3 font-medium">Sand / Silt / Clay (%)</th>
                  <th className="py-2 pr-3 font-medium">Bulk Dens (kg/dm³)</th>
                  <th className="py-2 font-medium">CEC (cmol(c)/kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {profile.depthLayers.map((layer) => {
                  const isActive = layer.depthIntervalCm === selectedDepthCm;
                  return (
                    <tr
                      key={layer.depthIntervalCm}
                      onClick={() => onChangeDepthCm(layer.depthIntervalCm)}
                      className={`cursor-pointer transition-colors ${
                        isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 pr-3 font-semibold text-slate-900">
                        {layer.depthIntervalCm} cm
                      </td>
                      <td className="py-2 pr-3 font-sans text-slate-800">
                        {layer.textureClass ?? 'Unavailable'}
                      </td>
                      <td className="py-2 pr-3">
                        {fmtStatValue(layer.ph, 1)}{' '}
                        {layer.ph.q05 !== null && layer.ph.q95 !== null && (
                          <span className="text-[10px] text-slate-500">
                            [{layer.ph.q05.toFixed(1)}–{layer.ph.q95.toFixed(1)}]
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {fmtStatValue(layer.organicCarbonGKg, 1)}{' '}
                        {layer.organicCarbonGKg.q05 !== null && layer.organicCarbonGKg.q95 !== null && (
                          <span className="text-[10px] text-slate-500">
                            [{layer.organicCarbonGKg.q05.toFixed(1)}–{layer.organicCarbonGKg.q95.toFixed(1)}]
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{fmtStatValue(layer.nitrogenGKg, 2)}</td>
                      <td className="py-2 pr-3">
                        {layer.sandPercent.mean !== null &&
                        layer.siltPercent.mean !== null &&
                        layer.clayPercent.mean !== null
                          ? `${layer.sandPercent.mean.toFixed(0)} / ${layer.siltPercent.mean.toFixed(0)} / ${layer.clayPercent.mean.toFixed(0)}`
                          : 'Unavailable'}
                      </td>
                      <td className="py-2 pr-3">{fmtStatValue(layer.bulkDensityKgDm3, 2)}</td>
                      <td className="py-2">{fmtStatValue(layer.cecCmolKg, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Farmer Lab Soil-Test Form */}
      <LabSoilTestForm
        parcelKey={parcelKey}
        parcelLabel={parcelLabel}
        initialTest={activeLabTest}
        onSave={handleSaveLabTest}
        onClear={handleClearLabTest}
      />

      {/* Farming-Oriented Explanations */}
      <SoilAgronomicInsights profile={profile} moisture={moisture} labTest={activeLabTest} />

      {/* Sources, Uncertainty & Caveats */}
      {(profile || moisture) && (
        <footer className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-600 space-y-1.5">
          <p className="font-semibold text-slate-800">Data Sources, Uncertainty &amp; Provenance</p>
          {profile && (
            <p>
              <span className="font-medium text-slate-800">{profile.sourceAttribution.name}</span> —{' '}
              {profile.sourceAttribution.attribution} · Retrieved{' '}
              {profile.sourceAttribution.retrievedAt.slice(0, 19).replace('T', ' ')} UTC
              {profile.sourceAttribution.cached ? ' (cached)' : ''} · {profile.uncertaintyMethodology}
            </p>
          )}
          {moisture && (
            <p>
              <span className="font-medium text-slate-800">{moisture.sourceAttribution.name}</span> —{' '}
              {moisture.sourceAttribution.attribution} · Product: SPL3SMP_E V006 (0–5 cm Surface) &amp; SPL4SMGP V007 (0–100 cm Root Zone) · 9 km EASE-Grid 2.0 · {moisture.retrievalConfidenceNote}
            </p>
          )}
          {moisture && (
            <p className="text-amber-800">
              • <strong>Restrictions:</strong> SMAP provides volumetric water content (m³/m³) only; it does not replace chemical soil tests for N, P, K, pH, or SOC. 9 km resolution represents regional grid averages rather than sub-field micro-variations.
            </p>
          )}
          {profile?.caveats.map((caveat, i) => (
            <p key={i} className="text-slate-500">
              • {caveat}
            </p>
          ))}
        </footer>
      )}
    </div>
  );
}
