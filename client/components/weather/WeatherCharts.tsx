import { useState } from 'react';
import type {
  ClimateTrendSummary,
  DailyWeatherObservation,
} from '../../../shared/index.ts';

function formatMetric(value: number | null, unit: string, digits = 1): string {
  if (value === null) {
    return 'Unavailable';
  }
  return `${value.toFixed(digits)} ${unit}`;
}

export function TemperatureChart({ series }: { series: DailyWeatherObservation[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const validValues = series.flatMap((d) =>
    [d.temperatureMinC, d.temperatureMeanC, d.temperatureMaxC].filter(
      (v): v is number => v !== null,
    ),
  );

  if (series.length === 0 || validValues.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500">
        No observed temperature records available for this date range.
      </div>
    );
  }

  const width = 760;
  const height = 240;
  const pad = { top: 18, right: 20, bottom: 32, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const rawMin = Math.min(...validValues);
  const rawMax = Math.max(...validValues);
  const minVal = Math.floor(rawMin - 2);
  const maxVal = Math.ceil(rawMax + 2);
  const span = Math.max(1, maxVal - minVal);

  const xFor = (i: number) =>
    series.length === 1 ? pad.left + plotW / 2 : pad.left + (i / (series.length - 1)) * plotW;
  const yFor = (val: number) => pad.top + ((maxVal - val) / span) * plotH;

  const buildPath = (picker: (d: DailyWeatherObservation) => number | null) => {
    let dAttr = '';
    let penDown = false;
    series.forEach((pt, idx) => {
      const v = picker(pt);
      if (v === null) {
        penDown = false;
        return;
      }
      const x = xFor(idx).toFixed(1);
      const y = yFor(v).toFixed(1);
      dAttr += penDown ? ` L ${x} ${y}` : ` M ${x} ${y}`;
      penDown = true;
    });
    return dAttr;
  };

  const meanPath = buildPath((d) => d.temperatureMeanC);
  const maxPath = buildPath((d) => d.temperatureMaxC);
  const minPath = buildPath((d) => d.temperatureMinC);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minVal + t * span);
  const activePoint = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Observed Daily Air Temperature (2m)
          </h3>
          <p className="text-[11px] text-slate-500">
            Daily mean, max, and min (°C) · NASA POWER T2M / T2M_MAX / T2M_MIN
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-rose-500" /> Max
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-slate-900" /> Mean
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-blue-600" /> Min
          </span>
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-60 w-full select-none"
          role="img"
          aria-label="Observed daily temperature chart"
          onMouseLeave={() => setHoverIdx(null)}
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
                  {tick.toFixed(0)}°
                </text>
              </g>
            );
          })}

          {maxPath && <path d={maxPath} fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="4 3" />}
          {minPath && <path d={minPath} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 3" />}
          {meanPath && <path d={meanPath} fill="none" stroke="#0f172a" strokeWidth="2.2" />}

          {hoverIdx !== null && (
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

          {/* X-axis start/mid/end dates */}
          {[0, Math.floor((series.length - 1) / 2), series.length - 1]
            .filter((idx, i, arr) => arr.indexOf(idx) === i)
            .map((idx) => (
              <text
                key={idx}
                x={xFor(idx)}
                y={height - 10}
                textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
                className="fill-slate-500 font-mono text-[10px]"
              >
                {series[idx].date}
              </text>
            ))}

          {/* Interactive hover columns */}
          {series.map((_, idx) => {
            const colW = plotW / Math.max(1, series.length);
            return (
              <rect
                key={idx}
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

        {activePoint && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono tabular-nums text-[11px] text-slate-700">
            <span className="font-semibold text-slate-900">{activePoint.date}</span>
            <span>Max: {formatMetric(activePoint.temperatureMaxC, '°C')}</span>
            <span>Mean: {formatMetric(activePoint.temperatureMeanC, '°C')}</span>
            <span>Min: {formatMetric(activePoint.temperatureMinC, '°C')}</span>
            <span>Solar: {formatMetric(activePoint.solarRadiationMjM2Day, 'MJ/m²/d')}</span>
            <span>RH: {formatMetric(activePoint.relativeHumidityPercent, '%', 0)}</span>
            <span>Wind: {formatMetric(activePoint.windSpeedMs, 'm/s')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function PrecipitationAccumulationChart({ series }: { series: DailyWeatherObservation[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const validDaily = series.map((d) => d.precipitationMmDay).filter((v): v is number => v !== null);
  if (series.length === 0 || validDaily.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-xs text-slate-500">
        No observed precipitation records available for this date range.
      </div>
    );
  }

  const width = 760;
  const height = 240;
  const pad = { top: 18, right: 48, bottom: 32, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxDaily = Math.max(5, ...validDaily);
  const maxCum = Math.max(10, ...series.map((d) => d.cumulativePrecipitationMm));

  const barStep = plotW / Math.max(1, series.length);
  const barW = Math.max(2, Math.min(18, barStep * 0.72));
  const xFor = (i: number) =>
    series.length === 1 ? pad.left + plotW / 2 : pad.left + (i + 0.5) * barStep;
  const yDaily = (v: number) => pad.top + (1 - v / maxDaily) * plotH;
  const yCum = (v: number) => pad.top + (1 - v / maxCum) * plotH;

  const cumPath = series
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(idx).toFixed(1)} ${yCum(pt.cumulativePrecipitationMm).toFixed(1)}`)
    .join(' ');

  const activePoint = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Observed Rainfall &amp; Cumulative Accumulation
          </h3>
          <p className="text-[11px] text-slate-500">
            Daily bars (mm/day) and cumulative total (mm) · NASA POWER PRECTOTCORR
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs bg-cyan-600" /> Daily (mm/day)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-blue-700" /> Cumulative (mm)
          </span>
        </div>
      </div>

      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-60 w-full select-none"
          role="img"
          aria-label="Observed rainfall and cumulative accumulation chart"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0, 0.5, 1].map((t, idx) => {
            const y = pad.top + (1 - t) * plotH;
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
                  {(t * maxDaily).toFixed(0)}
                </text>
                <text
                  x={width - pad.right + 8}
                  y={y + 4}
                  textAnchor="start"
                  className="fill-blue-700 font-mono text-[10px]"
                >
                  {(t * maxCum).toFixed(0)}
                </text>
              </g>
            );
          })}

          {series.map((pt, idx) => {
            if (pt.precipitationMmDay === null || pt.precipitationMmDay <= 0) {
              return null;
            }
            const x = xFor(idx) - barW / 2;
            const y = yDaily(pt.precipitationMmDay);
            const h = Math.max(1, pad.top + plotH - y);
            return (
              <rect
                key={pt.date}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={1}
                fill={hoverIdx === idx ? '#0284c7' : '#0891b2'}
              />
            );
          })}

          <path d={cumPath} fill="none" stroke="#1d4ed8" strokeWidth="2" />

          {[0, Math.floor((series.length - 1) / 2), series.length - 1]
            .filter((idx, i, arr) => arr.indexOf(idx) === i)
            .map((idx) => (
              <text
                key={idx}
                x={xFor(idx)}
                y={height - 10}
                textAnchor={idx === 0 ? 'start' : idx === series.length - 1 ? 'end' : 'middle'}
                className="fill-slate-500 font-mono text-[10px]"
              >
                {series[idx].date}
              </text>
            ))}

          {series.map((_, idx) => (
            <rect
              key={idx}
              x={pad.left + idx * barStep}
              y={pad.top}
              width={barStep}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(idx)}
            />
          ))}
        </svg>

        {activePoint && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono tabular-nums text-[11px] text-slate-700">
            <span className="font-semibold text-slate-900">{activePoint.date}</span>
            <span>Daily Rainfall: {formatMetric(activePoint.precipitationMmDay, 'mm/day', 2)}</span>
            <span>Cumulative: {activePoint.cumulativePrecipitationMm.toFixed(2)} mm</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function AnnualClimateTrendChart({ trends }: { trends: ClimateTrendSummary }) {
  const validYears = trends.yearlySummaries.filter((y) => y.meanTempC !== null);
  if (validYears.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        Multi-year NASA POWER annual climatology is unavailable for this coordinate.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Multi-Year Observed Climate Baseline ({trends.baselineYears} Years)
          </h3>
          <p className="text-[11px] text-slate-500">{trends.heatStressDaysTrend}</p>
        </div>
        <div className="flex gap-4 font-mono tabular-nums text-xs">
          <span>
            Baseline Mean:{' '}
            <strong>{formatMetric(trends.annualMeanTempC, '°C', 2)}</strong>
          </span>
          <span>
            Latest Temp Anomaly:{' '}
            <strong>
              {trends.temperatureAnomalyC === null
                ? 'Unavailable'
                : `${trends.temperatureAnomalyC >= 0 ? '+' : ''}${trends.temperatureAnomalyC.toFixed(2)} °C`}
            </strong>
          </span>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              <th className="py-1.5 pr-4 font-medium">Year</th>
              <th className="py-1.5 pr-4 font-medium">Mean Temp (°C)</th>
              <th className="py-1.5 font-medium">Annual Precip (mm)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
            {trends.yearlySummaries.map((row) => (
              <tr key={row.year}>
                <td className="py-1.5 pr-4 font-semibold text-slate-800">{row.year}</td>
                <td className="py-1.5 pr-4 text-slate-700">
                  {row.meanTempC !== null ? `${row.meanTempC.toFixed(2)} °C` : 'Unavailable'}
                </td>
                <td className="py-1.5 text-slate-700">
                  {row.totalPrecipitationMm !== null
                    ? `${row.totalPrecipitationMm.toFixed(1)} mm`
                    : 'Unavailable'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
