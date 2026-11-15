import { useState } from 'react';
import type {
  LabSoilTestResult,
  SoilDepthInterval,
  SoilDepthLayer,
  SoilMeasurementStats,
  SoilMoistureSnapshot,
} from '../../../shared/index.ts';

type ProfileMetricKey = 'ph' | 'organicCarbonGKg' | 'nitrogenGKg' | 'bulkDensityKgDm3' | 'cecCmolKg';

const METRIC_OPTIONS: Array<{
  key: ProfileMetricKey;
  label: string;
  unit: string;
  digits: number;
}> = [
  { key: 'ph', label: 'Soil pH (H₂O)', unit: 'pH', digits: 1 },
  { key: 'organicCarbonGKg', label: 'Organic Carbon', unit: 'g/kg', digits: 1 },
  { key: 'nitrogenGKg', label: 'Total Nitrogen', unit: 'g/kg', digits: 2 },
  { key: 'bulkDensityKgDm3', label: 'Bulk Density', unit: 'kg/dm³', digits: 2 },
  { key: 'cecCmolKg', label: 'CEC', unit: 'cmol(c)/kg', digits: 1 },
];

export function SoilDepthProfileChart({
  depthLayers,
  selectedDepthCm,
  labTest,
}: {
  depthLayers: SoilDepthLayer[];
  selectedDepthCm: SoilDepthInterval;
  labTest: LabSoilTestResult | null;
}) {
  const [metric, setMetric] = useState<ProfileMetricKey>('ph');
  const activeOption = METRIC_OPTIONS.find((m) => m.key === metric) ?? METRIC_OPTIONS[0];

  const getStat = (layer: SoilDepthLayer): SoilMeasurementStats => layer[metric];
  const numericPoints = depthLayers.flatMap((layer) => {
    const s = getStat(layer);
    return [s.mean, s.q05, s.q95].filter((v): v is number => v !== null);
  });

  const labOverlayVal: number | null = labTest
    ? metric === 'ph'
      ? labTest.ph
      : metric === 'organicCarbonGKg'
        ? labTest.organicCarbonGKg
        : metric === 'nitrogenGKg'
          ? labTest.totalNitrogenGKg
          : metric === 'bulkDensityKgDm3'
            ? labTest.bulkDensityKgDm3
            : labTest.cecCmolKg
    : null;

  if (labOverlayVal !== null) {
    numericPoints.push(labOverlayVal);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Soil Depth Profile &amp; 90% Prediction Interval (Q0.05 – Q0.95)
          </h3>
          <p className="text-[11px] text-slate-500">
            Modelled SoilGrids estimates across 0–60 cm depth{labOverlayVal !== null ? ' · Emerald diamond = Farmer lab measurement' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
          {METRIC_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMetric(opt.key)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                metric === opt.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label.split(' ')[0] === 'Soil' ? 'pH' : opt.label}
            </button>
          ))}
        </div>
      </div>

      {numericPoints.length === 0 ? (
        <div className="mt-3 flex h-56 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500">
          No SoilGrids {activeOption.label} values available at this coordinate.
        </div>
      ) : (
        <DepthProfileSvg
          depthLayers={depthLayers}
          selectedDepthCm={selectedDepthCm}
          getStat={getStat}
          numericPoints={numericPoints}
          unit={activeOption.unit}
          digits={activeOption.digits}
          labOverlay={
            labOverlayVal !== null && labTest
              ? { depth: labTest.sampleDepthCm, value: labOverlayVal }
              : null
          }
        />
      )}
    </section>
  );
}

function DepthProfileSvg({
  depthLayers,
  selectedDepthCm,
  getStat,
  numericPoints,
  unit,
  digits,
  labOverlay,
}: {
  depthLayers: SoilDepthLayer[];
  selectedDepthCm: SoilDepthInterval;
  getStat: (l: SoilDepthLayer) => SoilMeasurementStats;
  numericPoints: number[];
  unit: string;
  digits: number;
  labOverlay: { depth: SoilDepthInterval; value: number } | null;
}) {
  const width = 620;
  const height = 228;
  const pad = { top: 20, right: 24, bottom: 32, left: 68 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const rawMin = Math.min(...numericPoints);
  const rawMax = Math.max(...numericPoints);
  const margin = Math.max((rawMax - rawMin) * 0.15, 0.2);
  const minVal = Math.max(0, rawMin - margin);
  const maxVal = rawMax + margin;
  const span = Math.max(0.1, maxVal - minVal);

  const xFor = (val: number) => pad.left + ((val - minVal) / span) * plotW;
  const rowHeight = plotH / Math.max(1, depthLayers.length);
  const yForIndex = (idx: number) => pad.top + idx * rowHeight + rowHeight / 2;

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minVal + t * span);

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full select-none"
        role="img"
        aria-label="Soil depth profile chart with uncertainty intervals"
      >
        {xTicks.map((tick, idx) => {
          const x = xFor(tick);
          return (
            <g key={idx}>
              <line
                x1={x}
                y1={pad.top}
                x2={x}
                y2={height - pad.bottom}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={x}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500 font-mono text-[10px]"
              >
                {tick.toFixed(digits)}
              </text>
            </g>
          );
        })}

        {depthLayers.map((layer, idx) => {
          const y = yForIndex(idx);
          const stat = getStat(layer);
          const isSelected = layer.depthIntervalCm === selectedDepthCm;

          return (
            <g key={layer.depthIntervalCm}>
              {isSelected && (
                <rect
                  x={pad.left}
                  y={pad.top + idx * rowHeight + 3}
                  width={plotW}
                  height={rowHeight - 6}
                  rx="4"
                  fill="#eff6ff"
                />
              )}
              <text
                x={pad.left - 10}
                y={y + 4}
                textAnchor="end"
                className={`font-mono text-[11px] ${
                  isSelected ? 'fill-blue-700 font-semibold' : 'fill-slate-600'
                }`}
              >
                {layer.depthIntervalCm} cm
              </text>

              {stat.q05 !== null && stat.q95 !== null && (
                <>
                  <line
                    x1={xFor(stat.q05)}
                    y1={y}
                    x2={xFor(stat.q95)}
                    y2={y}
                    stroke="#94a3b8"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <line
                    x1={xFor(stat.q05)}
                    y1={y - 5}
                    x2={xFor(stat.q05)}
                    y2={y + 5}
                    stroke="#64748b"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={xFor(stat.q95)}
                    y1={y - 5}
                    x2={xFor(stat.q95)}
                    y2={y + 5}
                    stroke="#64748b"
                    strokeWidth="1.5"
                  />
                </>
              )}

              {stat.mean !== null && (
                <>
                  <circle
                    cx={xFor(stat.mean)}
                    cy={y}
                    r="5"
                    fill="#2563eb"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x={Math.min(width - pad.right - 4, xFor(stat.q95 ?? stat.mean) + 8)}
                    y={y + 4}
                    className="fill-slate-700 font-mono text-[10px]"
                  >
                    {stat.mean.toFixed(digits)} {unit}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {labOverlay && (() => {
          const idx = depthLayers.findIndex((l) => l.depthIntervalCm === labOverlay.depth);
          if (idx === -1) return null;
          const lx = xFor(labOverlay.value);
          const ly = yForIndex(idx);
          return (
            <polygon
              points={`${lx},${ly - 7} ${lx + 7},${ly} ${lx},${ly + 7} ${lx - 7},${ly}`}
              fill="#047857"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          );
        })()}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> SoilGrids Mean ({unit})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1 w-4 rounded bg-slate-400" /> 90% Interval (Q0.05 – Q0.95)
        </span>
        {labOverlay && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 bg-emerald-700" /> Measured Lab Result
          </span>
        )}
      </div>
    </div>
  );
}

export function LabVsModelComparisonChart({
  layer,
  labTest,
}: {
  layer: SoilDepthLayer | undefined;
  labTest: LabSoilTestResult | null;
}) {
  if (!labTest) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Measured Lab vs. Modelled SoilGrids Comparison
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          Side-by-side validation of regional SoilGrids predictions against parcel-level laboratory soil samples.
        </p>
        <div className="mt-3 flex h-44 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          Enter your laboratory soil-test values below to plot direct Measured vs. Modelled comparisons.
        </div>
      </section>
    );
  }

  const comparisons = [
    {
      label: 'Soil pH',
      unit: 'pH',
      digits: 1,
      lab: labTest.ph,
      model: layer?.ph.mean ?? null,
      q05: layer?.ph.q05 ?? null,
      q95: layer?.ph.q95 ?? null,
    },
    {
      label: 'Organic Carbon',
      unit: 'g/kg',
      digits: 1,
      lab: labTest.organicCarbonGKg,
      model: layer?.organicCarbonGKg.mean ?? null,
      q05: layer?.organicCarbonGKg.q05 ?? null,
      q95: layer?.organicCarbonGKg.q95 ?? null,
    },
    {
      label: 'Total Nitrogen',
      unit: 'g/kg',
      digits: 2,
      lab: labTest.totalNitrogenGKg,
      model: layer?.nitrogenGKg.mean ?? null,
      q05: layer?.nitrogenGKg.q05 ?? null,
      q95: layer?.nitrogenGKg.q95 ?? null,
    },
    {
      label: 'CEC',
      unit: 'cmol(c)/kg',
      digits: 1,
      lab: labTest.cecCmolKg,
      model: layer?.cecCmolKg.mean ?? null,
      q05: layer?.cecCmolKg.q05 ?? null,
      q95: layer?.cecCmolKg.q95 ?? null,
    },
    {
      label: 'Bulk Density',
      unit: 'kg/dm³',
      digits: 2,
      lab: labTest.bulkDensityKgDm3,
      model: layer?.bulkDensityKgDm3.mean ?? null,
      q05: layer?.bulkDensityKgDm3.q05 ?? null,
      q95: layer?.bulkDensityKgDm3.q95 ?? null,
    },
  ].filter((c) => c.lab !== null || c.model !== null);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Measured Lab ({labTest.sampleDepthCm} cm) vs. Modelled SoilGrids ({layer?.depthIntervalCm ?? '0-5'} cm)
          </h3>
          <p className="text-[11px] text-slate-500">
            Lab sample {labTest.sampleDate} ({labTest.labName}) compared against SoilGrids 90% prediction band
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-emerald-700" /> Lab Measured
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-blue-600" /> SoilGrids Mean
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {comparisons.map((row) => {
          const maxRef = Math.max(row.lab ?? 0, row.model ?? 0, row.q95 ?? 0, 1);
          const labPct = row.lab !== null ? (row.lab / maxRef) * 100 : 0;
          const modelPct = row.model !== null ? (row.model / maxRef) * 100 : 0;
          const delta =
            row.lab !== null && row.model !== null ? row.lab - row.model : null;

          return (
            <div key={row.label} className="rounded border border-slate-100 bg-slate-50/60 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-800">{row.label}</span>
                <span className="font-mono tabular-nums text-[11px] text-slate-600">
                  Lab:{' '}
                  <strong className="text-emerald-800">
                    {row.lab !== null ? `${row.lab.toFixed(row.digits)} ${row.unit}` : 'Not entered'}
                  </strong>{' '}
                  · Model:{' '}
                  <strong className="text-blue-700">
                    {row.model !== null ? `${row.model.toFixed(row.digits)} ${row.unit}` : 'Unavailable'}
                  </strong>
                  {delta !== null && (
                    <span className="ml-2 text-slate-500">
                      (Δ {delta >= 0 ? '+' : ''}
                      {delta.toFixed(row.digits)})
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-2 space-y-1">
                <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
                  {row.lab !== null && (
                    <div
                      className="h-full bg-emerald-700"
                      style={{ width: `${Math.min(100, labPct)}%` }}
                    />
                  )}
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
                  {row.model !== null && (
                    <div
                      className="h-full bg-blue-600"
                      style={{ width: `${Math.min(100, modelPct)}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SoilTextureBreakdownCard({
  depthLayers,
  selectedDepthCm,
  labTest,
}: {
  depthLayers: SoilDepthLayer[];
  selectedDepthCm: SoilDepthInterval;
  labTest: LabSoilTestResult | null;
}) {
  const activeLayer =
    depthLayers.find((l) => l.depthIntervalCm === selectedDepthCm) ?? depthLayers[0];

  const hasModelTexture =
    activeLayer &&
    activeLayer.sandPercent.mean !== null &&
    activeLayer.siltPercent.mean !== null &&
    activeLayer.clayPercent.mean !== null;

  const hasLabTexture =
    labTest &&
    labTest.sandPercent !== null &&
    labTest.siltPercent !== null &&
    labTest.clayPercent !== null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Particle-Size Texture Breakdown (Sand / Silt / Clay)
          </h3>
          <p className="text-[11px] text-slate-500">
            USDA Texture Classification at {selectedDepthCm} cm depth
          </p>
        </div>
        {activeLayer?.textureClass && (
          <span className="font-mono text-xs font-semibold text-slate-900">
            {activeLayer.textureClass}
          </span>
        )}
      </div>

      {hasModelTexture ? (
        <div className="mt-4 space-y-3">
          {depthLayers.map((layer) => {
            const sand = layer.sandPercent.mean;
            const silt = layer.siltPercent.mean;
            const clay = layer.clayPercent.mean;
            const total = (sand ?? 0) + (silt ?? 0) + (clay ?? 0);
            if (sand === null || silt === null || clay === null || total <= 0) {
              return (
                <div key={layer.depthIntervalCm} className="text-xs text-slate-500">
                  <span className="font-mono">{layer.depthIntervalCm} cm</span> — Texture unavailable
                </div>
              );
            }
            const sandW = (sand / total) * 100;
            const siltW = (silt / total) * 100;
            const clayW = (clay / total) * 100;

            return (
              <div key={layer.depthIntervalCm}>
                <div className="flex items-center justify-between text-[11px]">
                  <span
                    className={`font-mono ${
                      layer.depthIntervalCm === selectedDepthCm
                        ? 'font-semibold text-blue-700'
                        : 'text-slate-600'
                    }`}
                  >
                    {layer.depthIntervalCm} cm · {layer.textureClass ?? 'Unclassified'}
                  </span>
                  <span className="font-mono tabular-nums text-slate-700">
                    Sand {sand.toFixed(1)}% · Silt {silt.toFixed(1)}% · Clay {clay.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 flex h-3 w-full overflow-hidden rounded bg-slate-100">
                  <div
                    className="bg-amber-400"
                    style={{ width: `${sandW}%` }}
                    title={`Sand ${sand.toFixed(1)}%`}
                  />
                  <div
                    className="bg-stone-400"
                    style={{ width: `${siltW}%` }}
                    title={`Silt ${silt.toFixed(1)}%`}
                  />
                  <div
                    className="bg-orange-700"
                    style={{ width: `${clayW}%` }}
                    title={`Clay ${clay.toFixed(1)}%`}
                  />
                </div>
              </div>
            );
          })}

          {hasLabTexture && labTest && (
            <div className="border-t border-slate-200 pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-emerald-800">
                  Lab Measured ({labTest.sampleDepthCm} cm) · {labTest.textureClass ?? 'Texture'}
                </span>
                <span className="font-mono tabular-nums text-emerald-800">
                  Sand {labTest.sandPercent!.toFixed(1)}% · Silt {labTest.siltPercent!.toFixed(1)}% · Clay{' '}
                  {labTest.clayPercent!.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 flex h-3 w-full overflow-hidden rounded bg-slate-100">
                <div className="bg-amber-400" style={{ width: `${labTest.sandPercent}%` }} />
                <div className="bg-stone-400" style={{ width: `${labTest.siltPercent}%` }} />
                <div className="bg-orange-700" style={{ width: `${labTest.clayPercent}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-amber-400" /> Sand
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-stone-400" /> Silt
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-orange-700" /> Clay
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex h-36 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500">
          Particle-size distribution unavailable for this coordinate.
        </div>
      )}
    </section>
  );
}

export function SmapSoilMoistureChart({
  moisture,
  onReturnToMap,
}: {
  moisture: SoilMoistureSnapshot;
  onReturnToMap?: () => void;
}) {
  const series = moisture.moistureSeries;
  const values = series.flatMap((pt) =>
    [pt.surfaceMoistureM3M3, pt.rootZoneMoistureM3M3].filter((v): v is number => v !== null),
  );

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            NASA SMAP Satellite Soil Moisture (m³/m³)
          </h3>
          <p className="text-[11px] text-slate-500">
            Surface (0–5 cm, SPL3SMP_E) &amp; Root-Zone (0–100 cm, SPL4SMGP) · 9 km EASE-Grid 2.0
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-cyan-600" /> Surface (0–5 cm)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-indigo-600" /> Root Zone (0–100 cm)
          </span>
          {onReturnToMap && (
            <button
              type="button"
              onClick={onReturnToMap}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 cursor-pointer"
            >
              View on Map →
            </button>
          )}
        </div>
      </div>

      {values.length === 0 ? (
        <div className="mt-3 flex h-44 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          {moisture.message ?? 'No NASA SMAP L3/L4 observations available for this coordinate and window.'}
        </div>
      ) : (
        <SmapLineSvg series={series} values={values} />
      )}

      {/* SMAP Specific Metadata & Disclaimers Footer */}
      <div className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-500 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1 text-slate-600">
          <span>Product: <strong className="text-slate-800">SPL3SMP_E V006 / SPL4SMGP V007</strong></span>
          <span>Resolution: <strong className="text-slate-800">9 km × 9 km EASE-Grid</strong></span>
          <span>Observed: <strong className="text-slate-800">{moisture.observationDate ?? 'Latest Available'}</strong></span>
        </div>
        <p className="text-[10px] text-amber-800 bg-amber-50 rounded px-2 py-1 border border-amber-200/60">
          <strong>Important:</strong> SMAP provides volumetric water content only. Do not infer Nitrogen, Phosphorus, Potassium, Soil pH, or Organic Carbon from SMAP satellite data. Surface represents 0–5 cm; root-zone represents 0–100 cm (L4 model assimilation).
        </p>
      </div>
    </section>
  );
}

function SmapLineSvg({
  series,
  values,
}: {
  series: SoilMoistureSnapshot['moistureSeries'];
  values: number[];
}) {
  const width = 620;
  const height = 200;
  const pad = { top: 18, right: 20, bottom: 30, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minVal = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 20) / 20);
  const maxVal = Math.min(0.75, Math.ceil((Math.max(...values) + 0.05) * 20) / 20);
  const span = Math.max(0.05, maxVal - minVal);

  const xFor = (idx: number) =>
    series.length <= 1 ? pad.left + plotW / 2 : pad.left + (idx / (series.length - 1)) * plotW;
  const yFor = (val: number) => pad.top + ((maxVal - val) / span) * plotH;

  const buildPath = (picker: (pt: SoilMoistureSnapshot['moistureSeries'][number]) => number | null) => {
    let d = '';
    let active = false;
    series.forEach((pt, idx) => {
      const val = picker(pt);
      if (val === null) {
        active = false;
        return;
      }
      const cmd = active ? 'L' : 'M';
      d += ` ${cmd} ${xFor(idx).toFixed(1)} ${yFor(val).toFixed(1)}`;
      active = true;
    });
    return d.trim();
  };

  const surfacePath = buildPath((p) => p.surfaceMoistureM3M3);
  const rootPath = buildPath((p) => p.rootZoneMoistureM3M3);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minVal + t * span);

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full select-none"
        role="img"
        aria-label="NASA SMAP L4 daily volumetric soil moisture chart"
      >
        {yTicks.map((tick, idx) => {
          const y = yFor(tick);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={pad.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[10px]"
              >
                {tick.toFixed(2)}
              </text>
            </g>
          );
        })}

        {surfacePath && (
          <path d={surfacePath} fill="none" stroke="#0891b2" strokeWidth="2.2" />
        )}
        {rootPath && (
          <path d={rootPath} fill="none" stroke="#4f46e5" strokeWidth="2.2" />
        )}

        {series.map((pt, idx) => {
          const x = xFor(idx);
          return (
            <g key={pt.date}>
              {pt.surfaceMoistureM3M3 !== null && (
                <circle
                  cx={x}
                  cy={yFor(pt.surfaceMoistureM3M3)}
                  r="3.5"
                  fill="#0891b2"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              )}
              {pt.rootZoneMoistureM3M3 !== null && (
                <circle
                  cx={x}
                  cy={yFor(pt.rootZoneMoistureM3M3)}
                  r="3.5"
                  fill="#4f46e5"
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              )}
              <text
                x={x}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500 font-mono text-[10px]"
              >
                {pt.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
