import { useState } from 'react';
import type { PredictiveHorizonPoint, PredictiveMetricInsight } from '../../../shared/index.ts';
import type { EnvironmentalTrendPoint } from './environmentalUtils.ts';
import { formatQualityLabel } from './environmentalUtils.ts';

interface PlottedPoint {
  id: string;
  date: string;
  value: number;
  kind: 'observed' | 'projection';
  observed?: EnvironmentalTrendPoint;
  projection?: PredictiveHorizonPoint;
}

function TrendChartSvg({
  points,
  projectedSeries,
  ariaLabel,
  yMin,
  yMax,
  unit,
  digits,
  strokeColor,
  getPointColor,
  referenceBands,
}: {
  points: EnvironmentalTrendPoint[];
  projectedSeries?: PredictiveMetricInsight | null;
  ariaLabel: string;
  yMin: number;
  yMax: number;
  unit: string;
  digits: number;
  strokeColor: string;
  getPointColor?: (pt: EnvironmentalTrendPoint) => string;
  referenceBands?: Array<{ from: number; to: number; fill: string }>;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const activeProjections =
    projectedSeries?.projectionEligible && projectedSeries.projections.length > 0 && points.length > 0
      ? projectedSeries.projections
      : [];

  const plotted: PlottedPoint[] = [
    ...points.map((pt) => ({
      id: pt.id,
      date: pt.date,
      value: pt.value,
      kind: 'observed' as const,
      observed: pt,
    })),
    ...activeProjections.map((proj) => ({
      id: `proj-${proj.horizonDays}d-${proj.targetDate}`,
      date: proj.targetDate,
      value: proj.projectedValue,
      kind: 'projection' as const,
      projection: proj,
    })),
  ];

  const width = 640;
  const height = 224;
  const pad = { top: 18, right: 24, bottom: 32, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const span = Math.max(0.05, yMax - yMin);
  const xFor = (idx: number) =>
    plotted.length <= 1 ? pad.left + plotW / 2 : pad.left + (idx / (plotted.length - 1)) * plotW;
  const yFor = (val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return pad.top + ((yMax - clamped) / span) * plotH;
  };

  const obsCount = points.length;
  const observedPathD =
    obsCount >= 2
      ? points
          .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(idx).toFixed(1)} ${yFor(pt.value).toFixed(1)}`)
          .join(' ')
      : '';

  const projectionAnchorIdx = obsCount - 1;
  const projectionPathD =
    activeProjections.length > 0 && obsCount > 0
      ? [
          `M ${xFor(projectionAnchorIdx).toFixed(1)} ${yFor(points[projectionAnchorIdx]!.value).toFixed(1)}`,
          ...activeProjections.map(
            (proj, pIdx) =>
              `L ${xFor(obsCount + pIdx).toFixed(1)} ${yFor(proj.projectedValue).toFixed(1)}`,
          ),
        ].join(' ')
      : '';

  const uncertaintyPolygonPoints =
    activeProjections.length > 0 && obsCount > 0
      ? [
          `${xFor(projectionAnchorIdx).toFixed(1)},${yFor(points[projectionAnchorIdx]!.value).toFixed(1)}`,
          ...activeProjections.map(
            (proj, pIdx) =>
              `${xFor(obsCount + pIdx).toFixed(1)},${yFor(proj.upperBound).toFixed(1)}`,
          ),
          ...[...activeProjections]
            .reverse()
            .map(
              (proj, revIdx) =>
                `${xFor(obsCount + (activeProjections.length - 1 - revIdx)).toFixed(1)},${yFor(proj.lowerBound).toFixed(1)}`,
            ),
        ].join(' ')
      : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * span);
  const activePoint = hoverIdx !== null ? plotted[hoverIdx] : null;
  const xIndices = [0, Math.floor((plotted.length - 1) / 2), plotted.length - 1].filter(
    (idx, i, arr) => idx >= 0 && idx < plotted.length && arr.indexOf(idx) === i,
  );

  return (
    <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full select-none"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {referenceBands?.map((band, idx) => {
          const yTop = yFor(band.to);
          const yBottom = yFor(band.from);
          const bandH = Math.max(0, yBottom - yTop);
          return (
            <rect
              key={idx}
              x={pad.left}
              y={yTop}
              width={plotW}
              height={bandH}
              fill={band.fill}
            />
          );
        })}

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
                {tick.toFixed(digits === 0 ? 0 : 2)}
              </text>
            </g>
          );
        })}

        {/* Vertical divider between latest observed date and trend projection */}
        {activeProjections.length > 0 && obsCount > 0 && (
          <line
            x1={xFor(projectionAnchorIdx)}
            y1={pad.top}
            x2={xFor(projectionAnchorIdx)}
            y2={height - pad.bottom}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}

        {/* Shaded Uncertainty Interval Polygon (Phase 5B) */}
        {uncertaintyPolygonPoints && (
          <polygon points={uncertaintyPolygonPoints} fill={strokeColor} fillOpacity="0.14" />
        )}

        {observedPathD && (
          <path d={observedPathD} fill="none" stroke={strokeColor} strokeWidth="2.2" />
        )}

        {projectionPathD && (
          <path
            d={projectionPathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeOpacity="0.85"
          />
        )}

        {hoverIdx !== null && plotted[hoverIdx] && (
          <line
            x1={xFor(hoverIdx)}
            y1={pad.top}
            x2={xFor(hoverIdx)}
            y2={height - pad.bottom}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {plotted.map((pt, idx) => {
          if (pt.kind === 'projection') {
            return (
              <circle
                key={pt.id}
                cx={xFor(idx)}
                cy={yFor(pt.value)}
                r={hoverIdx === idx ? 5.5 : 4}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth="2"
              />
            );
          }
          const fill = pt.observed && getPointColor ? getPointColor(pt.observed) : strokeColor;
          return (
            <circle
              key={pt.id}
              cx={xFor(idx)}
              cy={yFor(pt.value)}
              r={hoverIdx === idx ? 5.5 : 4}
              fill={fill}
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          );
        })}

        {xIndices.map((idx) => (
          <text
            key={idx}
            x={xFor(idx)}
            y={height - 10}
            textAnchor={idx === 0 ? 'start' : idx === plotted.length - 1 ? 'end' : 'middle'}
            className="fill-slate-500 font-mono text-[10px]"
          >
            {plotted[idx]!.kind === 'projection'
              ? `${plotted[idx]!.date} (+${plotted[idx]!.projection!.horizonDays}d)`
              : plotted[idx]!.date}
          </text>
        ))}

        {plotted.map((pt, idx) => {
          const colW = plotW / Math.max(1, plotted.length);
          return (
            <rect
              key={`hit-${pt.id}`}
              x={Math.max(pad.left, xFor(idx) - colW / 2)}
              y={pad.top}
              width={colW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          );
        })}
      </svg>

      {activePoint && activePoint.kind === 'observed' && activePoint.observed && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono tabular-nums text-[11px] text-slate-700">
          <span className="font-semibold text-slate-900">Observed · {activePoint.date}</span>
          <span>
            Value:{' '}
            <strong>
              {activePoint.value.toFixed(digits)}
              {unit ? ` ${unit}` : ''}
            </strong>
          </span>
          <span>Product: {activePoint.observed.productId}</span>
          <span>
            Coverage:{' '}
            {activePoint.observed.coveragePercent !== null
              ? `${activePoint.observed.coveragePercent.toFixed(1)}%`
              : 'N/A'}
          </span>
          <span>{formatQualityLabel(activePoint.observed.qualityStatus)}</span>
        </div>
      )}

      {activePoint && activePoint.kind === 'projection' && activePoint.projection && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50/70 px-3 py-1.5 font-mono tabular-nums text-[11px] text-amber-950">
          <span className="font-semibold">
            Trend Projection (+{activePoint.projection.horizonDays}d · {activePoint.date})
          </span>
          <span>
            Projected:{' '}
            <strong>
              {activePoint.projection.projectedValue.toFixed(digits)}
              {unit ? ` ${unit}` : ''}
            </strong>
          </span>
          <span>
            Interval: {activePoint.projection.lowerBound.toFixed(digits)} –{' '}
            {activePoint.projection.upperBound.toFixed(digits)}
          </span>
          <span className="font-sans text-[10px]">Not a weather forecast</span>
        </div>
      )}
    </div>
  );
}

export function NdviTimeSeriesChart({
  points,
  projectedSeries,
}: {
  points: EnvironmentalTrendPoint[];
  projectedSeries?: PredictiveMetricInsight | null;
}) {
  if (points.length === 0) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Landsat / HLS NDVI Time-Series
        </h3>
        <p className="text-[11px] text-slate-500">
          30 m Surface Reflectance · HLSL30 (Landsat 8/9) &amp; HLSS30 (Sentinel-2)
        </p>
        <div className="mt-3 flex h-52 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          No clear-sky Landsat/HLS NDVI observations available in the selected window. Cloud/shadow-masked scenes are excluded from trend lines.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Landsat / HLS NDVI Time-Series
          </h3>
          <p className="text-[11px] text-slate-500">
            Normalized Difference Vegetation Index (-1 to 1) · 30 m grid · Hover points for sensor &amp; Fmask QA
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" /> Landsat (HLSL30)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-500" /> Sentinel-2 (HLSS30)
          </span>
          {projectedSeries?.projectionEligible && (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <span className="h-0 w-4 border-t-2 border-dashed border-emerald-700" /> +14d Trend Band
            </span>
          )}
        </div>
      </div>

      <TrendChartSvg
        points={points}
        projectedSeries={projectedSeries}
        ariaLabel="Landsat and Sentinel-2 HLS NDVI time-series chart"
        yMin={-0.1}
        yMax={1.0}
        unit="NDVI"
        digits={3}
        strokeColor="#047857"
        getPointColor={(pt) => (pt.productId.startsWith('HLSS30') ? '#14b8a6' : '#047857')}
        referenceBands={[
          { from: 0.2, to: 0.4, fill: 'rgba(245, 158, 11, 0.06)' },
          { from: 0.4, to: 1.0, fill: 'rgba(16, 185, 129, 0.06)' },
        ]}
      />
    </section>
  );
}

export function NdwiTimeSeriesChart({
  points,
  projectedSeries,
}: {
  points: EnvironmentalTrendPoint[];
  projectedSeries?: PredictiveMetricInsight | null;
}) {
  if (points.length === 0) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Landsat / HLS NDWI Time-Series
        </h3>
        <p className="text-[11px] text-slate-500">
          Canopy &amp; surface wetness index (Green / NIR / SWIR bands) · 30 m grid
        </p>
        <div className="mt-3 flex h-52 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          No clear-sky Landsat/HLS NDWI observations available in the selected window.
        </div>
      </section>
    );
  }

  const projVals =
    projectedSeries?.projectionEligible && projectedSeries.projections.length > 0
      ? projectedSeries.projections.flatMap((p) => [p.lowerBound, p.upperBound])
      : [];
  const vals = [...points.map((p) => p.value), ...projVals];
  const minVal = Math.max(-1, Math.floor((Math.min(...vals) - 0.1) * 10) / 10);
  const maxVal = Math.min(1, Math.ceil((Math.max(...vals) + 0.1) * 10) / 10);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Landsat / HLS NDWI Time-Series
          </h3>
          <p className="text-[11px] text-slate-500">
            Canopy water / surface wetness index (-1 to 1) · Distinct from SMAP root-zone soil moisture
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-700" /> Landsat (HLSL30)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" /> Sentinel-2 (HLSS30)
          </span>
          {projectedSeries?.projectionEligible && (
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <span className="h-0 w-4 border-t-2 border-dashed border-sky-700" /> +14d Trend Band
            </span>
          )}
        </div>
      </div>

      <TrendChartSvg
        points={points}
        projectedSeries={projectedSeries}
        ariaLabel="Landsat and Sentinel-2 HLS NDWI time-series chart"
        yMin={minVal}
        yMax={Math.max(minVal + 0.2, maxVal)}
        unit="NDWI"
        digits={3}
        strokeColor="#0369a1"
        getPointColor={(pt) => (pt.productId.startsWith('HLSS30') ? '#06b6d4' : '#1d4ed8')}
      />
    </section>
  );
}

export function EtTrendChart({
  points,
  projectedSeries,
}: {
  points: EnvironmentalTrendPoint[];
  projectedSeries?: PredictiveMetricInsight | null;
}) {
  if (points.length === 0) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          ECOSTRESS Daily Evapotranspiration (W/m²)
        </h3>
        <p className="text-[11px] text-slate-500">
          ECO_L3T_JET.002 · 70 m thermal energy flux (not mm/day irrigation depth)
        </p>
        <div className="mt-3 flex h-52 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          No clear-sky ECOSTRESS ET daily observations available in the selected window.
        </div>
      </section>
    );
  }

  if (points.length === 1) {
    const only = points[0];
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          ECOSTRESS Daily Evapotranspiration (W/m²)
        </h3>
        <p className="text-[11px] text-slate-500">
          ECO_L3T_JET.002 · 70 m thermal energy flux
        </p>
        <div className="mt-3 flex h-52 flex-col items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center">
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900">
            {only.value.toFixed(1)}{' '}
            <span className="text-xs font-normal text-slate-500">W/m²</span>
          </p>
          <p className="mt-1 font-mono tabular-nums text-xs text-slate-600">
            Acquisition: {only.date} · Coverage:{' '}
            {only.coveragePercent !== null ? `${only.coveragePercent.toFixed(1)}%` : 'N/A'}
          </p>
          <p className="mt-2 max-w-md text-[11px] text-slate-500">
            Only 1 clear-sky ECOSTRESS ET observation exists in this window; at least 2 comparable observations are required to plot a historical ET trend.
          </p>
        </div>
      </section>
    );
  }

  const projVals =
    projectedSeries?.projectionEligible && projectedSeries.projections.length > 0
      ? projectedSeries.projections.flatMap((p) => [p.lowerBound, p.upperBound])
      : [];
  const vals = [...points.map((p) => p.value), ...projVals];
  const minVal = Math.max(0, Math.floor((Math.min(...vals) - 20) / 10) * 10);
  const maxVal = Math.ceil((Math.max(...vals) + 20) / 10) * 10;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            ECOSTRESS Historical ET Trend (W/m²)
          </h3>
          <p className="text-[11px] text-slate-500">
            ECO_L3T_JET.002 · 70 m thermal flux ({points.length} comparable clear-sky overpasses)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-orange-600" /> Observed ET (W/m²)
          </span>
          {projectedSeries?.projectionEligible && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-orange-600" /> +14d Trend Band
            </span>
          )}
        </div>
      </div>

      <TrendChartSvg
        points={points}
        projectedSeries={projectedSeries}
        ariaLabel="NASA ECOSTRESS daily evapotranspiration trend chart"
        yMin={minVal}
        yMax={Math.max(minVal + 20, maxVal)}
        unit="W/m²"
        digits={1}
        strokeColor="#ea580c"
      />
    </section>
  );
}

export function EsiTrendChart({
  points,
  projectedSeries,
}: {
  points: EnvironmentalTrendPoint[];
  projectedSeries?: PredictiveMetricInsight | null;
}) {
  if (points.length === 0) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">
          ECOSTRESS Evaporative Stress Index (ESI)
        </h3>
        <p className="text-[11px] text-slate-500">
          ECO_L4T_ESI.002 · Actual / Potential ET ratio (0 = severe stress, 1 = unstressed)
        </p>
        <div className="mt-3 flex h-52 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-4 text-center text-xs text-slate-500">
          No clear-sky ECOSTRESS ESI observations available in the selected window.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            ECOSTRESS Evaporative Stress Index (ESI)
          </h3>
          <p className="text-[11px] text-slate-500">
            ECO_L4T_ESI.002 · Ratio (0–1) · &lt;0.40 indicates elevated evaporative stress
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-amber-600" /> Observed ESI
          </span>
          {projectedSeries?.projectionEligible && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-amber-600" /> +14d Trend Band
            </span>
          )}
        </div>
      </div>

      <TrendChartSvg
        points={points}
        projectedSeries={projectedSeries}
        ariaLabel="NASA ECOSTRESS Evaporative Stress Index trend chart"
        yMin={0}
        yMax={1.0}
        unit="ratio"
        digits={3}
        strokeColor="#d97706"
        referenceBands={[
          { from: 0, to: 0.4, fill: 'rgba(244, 63, 94, 0.06)' },
          { from: 0.4, to: 0.7, fill: 'rgba(245, 158, 11, 0.05)' },
          { from: 0.7, to: 1.0, fill: 'rgba(16, 185, 129, 0.05)' },
        ]}
      />
    </section>
  );
}

