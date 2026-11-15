import { useState } from 'react';
import { AlertCircle, CloudRain, Info, Loader2, RefreshCw } from 'lucide-react';
import type {
  ClimateTrendSummary,
  DateRange,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import { useSelectedFarmGeometry } from '../../context/FarmWorkspaceContext.tsx';
import {
  AnnualClimateTrendChart,
  PrecipitationAccumulationChart,
  TemperatureChart,
} from './WeatherCharts.tsx';

interface WeatherIntelligenceViewProps {
  telemetry: WeatherTelemetrySnapshot | null;
  trends: ClimateTrendSummary | null;
  loading: boolean;
  error: string | null;
  dateRange: DateRange;
  trendYears: number;
  onChangeDateRange: (range: DateRange) => void;
  onChangeTrendYears: (years: number) => void;
  onFetchWeather: (overrideRange?: DateRange, overrideYears?: number) => void;
  onReturnToMap: () => void;
}

function defaultRangeDaysAgo(days: number): DateRange {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 4);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function fmt(value: number | null, unit: string, digits = 1): string {
  if (value === null) {
    return 'Unavailable';
  }
  return `${value.toFixed(digits)} ${unit}`;
}

export function WeatherIntelligenceView({
  telemetry,
  trends,
  loading,
  error,
  dateRange,
  trendYears,
  onChangeDateRange,
  onChangeTrendYears,
  onFetchWeather,
  onReturnToMap,
}: WeatherIntelligenceViewProps) {
  const { activeCoordinates, selectedBoundary, markerLabel } = useSelectedFarmGeometry();
  const [tableView, setTableView] = useState<'monthly' | 'daily'>('monthly');

  function applyPreset(days: number) {
    const next = defaultRangeDaysAgo(days);
    onChangeDateRange(next);
    onFetchWeather(next, trendYears);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Header & Target Farm Geometry Context */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Observed &amp; Historical Satellite Telemetry
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              NASA Weather &amp; Climate Intelligence
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Target:{' '}
              <span className="font-semibold text-slate-800">
                {selectedBoundary
                  ? `${selectedBoundary.name} (${selectedBoundary.areaHectares.toFixed(2)} ha polygon centroid)`
                  : markerLabel}
              </span>{' '}
              ·{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {activeCoordinates.latitude.toFixed(4)}°, {activeCoordinates.longitude.toFixed(4)}°
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
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
              onClick={() => onFetchWeather()}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {loading ? 'Fetching NASA Data…' : 'Load NASA Weather'}
            </button>
          </div>
        </div>

        {/* Date Range & Trend Window Controls */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="weather-start" className="block text-[11px] font-medium text-slate-600">
                Start Date
              </label>
              <input
                id="weather-start"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => onChangeDateRange({ ...dateRange, startDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="weather-end" className="block text-[11px] font-medium text-slate-600">
                End Date
              </label>
              <input
                id="weather-end"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => onChangeDateRange({ ...dateRange, endDate: e.target.value })}
                className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="trend-years" className="block text-[11px] font-medium text-slate-600">
                Baseline Window
              </label>
              <select
                id="trend-years"
                value={trendYears}
                onChange={(e) => onChangeTrendYears(Number.parseInt(e.target.value, 10))}
                className="mt-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              >
                <option value={3}>3 Years</option>
                <option value={5}>5 Years</option>
                <option value={10}>10 Years</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {[
              { label: '30 Days', days: 30 },
              { label: '90 Days', days: 90 },
              { label: '365 Days', days: 365 },
            ].map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => applyPreset(preset.days)}
                className="rounded px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white hover:text-slate-900 cursor-pointer whitespace-nowrap"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Observed vs Forecast Distinction Banner */}
        <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          <div>
            <span className="font-semibold text-slate-900">Observed Historical Data Only:</span>{' '}
            {telemetry?.forecastDisclaimer ??
              'All values represent observed or satellite/reanalysis historical measurements from NASA POWER and NASA GPM IMERG. Forecasts are never manufactured from historical records.'}
          </div>
        </div>
      </section>

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
            onClick={() => onFetchWeather()}
            className="rounded border border-rose-300 bg-white px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && !telemetry && (
        <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
          Retrieving NASA POWER daily parameters and NASA GPM IMERG satellite rainfall…
        </div>
      )}

      {/* Summary Cards & Charts */}
      {telemetry && (
        <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Mean Temperature
              </p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {telemetry.summary.meanTempC !== null
                  ? telemetry.summary.meanTempC.toFixed(1)
                  : 'N/A'}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {telemetry.units.temperature}
                </span>
              </p>
              <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
                Min {fmt(telemetry.summary.minTempC, '°C')} · Max{' '}
                {fmt(telemetry.summary.maxTempC, '°C')}
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Total Rainfall
              </p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {telemetry.summary.totalPrecipitationMm.toFixed(1)}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {telemetry.units.cumulativePrecipitation}
                </span>
              </p>
              <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
                {telemetry.summary.availableDays}/{telemetry.summary.totalDays} observed days
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Solar Radiation
              </p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {telemetry.summary.meanSolarRadiationMjM2Day !== null
                  ? telemetry.summary.meanSolarRadiationMjM2Day.toFixed(1)
                  : 'N/A'}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {telemetry.units.solarRadiation}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-slate-600">All-sky shortwave irradiance</p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Humidity &amp; Wind
              </p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                {telemetry.summary.meanRelativeHumidityPercent !== null
                  ? telemetry.summary.meanRelativeHumidityPercent.toFixed(0)
                  : 'N/A'}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {telemetry.units.relativeHumidity}
                </span>
              </p>
              <p className="mt-1 font-mono tabular-nums text-[11px] text-slate-600">
                Wind: {fmt(telemetry.summary.meanWindSpeedMs, 'm/s', 2)}
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  GPM IMERG Satellite
                </p>
                <CloudRain className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
              </div>
              {telemetry.gpmImerg?.status === 'available' &&
              telemetry.gpmImerg.precipitationRateMmHr !== null ? (
                <>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-semibold text-slate-900">
                    {telemetry.gpmImerg.precipitationRateMmHr.toFixed(2)}
                    <span className="ml-1 text-xs font-normal text-slate-500">mm/hr</span>
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-600">
                    {telemetry.gpmImerg.observationTimestamp?.slice(0, 16).replace('T', ' ')} UTC
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm font-semibold text-slate-700">Unavailable</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {telemetry.gpmImerg?.message ??
                      'No GPM IMERG swath pixel reported for this timestamp.'}
                  </p>
                </>
              )}
            </div>
          </section>

          {/* Temperature Trend Banner */}
          <section className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
            <span className="font-semibold text-slate-900">Period Temperature Trend:</span>{' '}
            {telemetry.temperatureTrend.direction === 'insufficient_data' ? (
              <span>Insufficient observed days to compute linear temperature trend.</span>
            ) : (
              <span className="font-mono tabular-nums">
                {telemetry.temperatureTrend.direction.toUpperCase()} (
                {telemetry.temperatureTrend.totalChangeC !== null &&
                telemetry.temperatureTrend.totalChangeC >= 0
                  ? '+'
                  : ''}
                {telemetry.temperatureTrend.totalChangeC?.toFixed(2)} °C across{' '}
                {telemetry.temperatureTrend.sampleCount} days · 1st half{' '}
                {fmt(telemetry.temperatureTrend.firstHalfMeanC, '°C')} → 2nd half{' '}
                {fmt(telemetry.temperatureTrend.secondHalfMeanC, '°C')})
              </span>
            )}
          </section>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TemperatureChart series={telemetry.dailySeries} />
            <PrecipitationAccumulationChart series={telemetry.dailySeries} />
          </div>

          {trends && <AnnualClimateTrendChart trends={trends} />}

          {/* Daily & Monthly Summary Table */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Observed Weather Summaries
              </h3>
              <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setTableView('monthly')}
                  className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
                    tableView === 'monthly'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Monthly ({telemetry.monthlySummaries.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTableView('daily')}
                  className={`rounded px-3 py-1 text-xs font-medium cursor-pointer ${
                    tableView === 'daily'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Daily ({telemetry.dailySeries.length})
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-72 overflow-auto">
              {tableView === 'monthly' ? (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 pr-3 font-medium">Month</th>
                      <th className="py-2 pr-3 font-medium">Days</th>
                      <th className="py-2 pr-3 font-medium">Mean (°C)</th>
                      <th className="py-2 pr-3 font-medium">Max (°C)</th>
                      <th className="py-2 pr-3 font-medium">Min (°C)</th>
                      <th className="py-2 pr-3 font-medium">Precip (mm)</th>
                      <th className="py-2 pr-3 font-medium">Solar (MJ/m²/d)</th>
                      <th className="py-2 pr-3 font-medium">RH (%)</th>
                      <th className="py-2 font-medium">Wind (m/s)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {telemetry.monthlySummaries.map((m) => (
                      <tr key={m.month}>
                        <td className="py-1.5 pr-3 font-semibold text-slate-900">{m.month}</td>
                        <td className="py-1.5 pr-3 text-slate-600">{m.observationDays}</td>
                        <td className="py-1.5 pr-3">{fmt(m.temperatureMeanC, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(m.temperatureMaxC, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(m.temperatureMinC, '')}</td>
                        <td className="py-1.5 pr-3">{m.totalPrecipitationMm.toFixed(1)}</td>
                        <td className="py-1.5 pr-3">{fmt(m.meanSolarRadiationMjM2Day, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(m.meanRelativeHumidityPercent, '', 0)}</td>
                        <td className="py-1.5">{fmt(m.meanWindSpeedMs, '', 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Mean (°C)</th>
                      <th className="py-2 pr-3 font-medium">Max (°C)</th>
                      <th className="py-2 pr-3 font-medium">Min (°C)</th>
                      <th className="py-2 pr-3 font-medium">Rain (mm/d)</th>
                      <th className="py-2 pr-3 font-medium">Accum (mm)</th>
                      <th className="py-2 pr-3 font-medium">Solar (MJ/m²/d)</th>
                      <th className="py-2 pr-3 font-medium">RH (%)</th>
                      <th className="py-2 font-medium">Wind (m/s)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {telemetry.dailySeries.map((d) => (
                      <tr key={d.date}>
                        <td className="py-1.5 pr-3 font-semibold text-slate-900">{d.date}</td>
                        <td className="py-1.5 pr-3">{fmt(d.temperatureMeanC, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(d.temperatureMaxC, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(d.temperatureMinC, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(d.precipitationMmDay, '', 2)}</td>
                        <td className="py-1.5 pr-3">{d.cumulativePrecipitationMm.toFixed(2)}</td>
                        <td className="py-1.5 pr-3">{fmt(d.solarRadiationMjM2Day, '')}</td>
                        <td className="py-1.5 pr-3">{fmt(d.relativeHumidityPercent, '', 0)}</td>
                        <td className="py-1.5">{fmt(d.windSpeedMs, '', 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Source Attributions */}
          <footer className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-600">
            <p className="font-semibold text-slate-800">Data Sources &amp; Attribution</p>
            <ul className="mt-1 space-y-0.5">
              {telemetry.sourceAttributions.map((src) => (
                <li key={src.id}>
                  <span className="font-medium text-slate-800">{src.name}</span> — {src.attribution}{' '}
                  · Retrieved {src.retrievedAt.slice(0, 19).replace('T', ' ')} UTC
                  {src.cached ? ' (cached)' : ''}
                </li>
              ))}
            </ul>
          </footer>
        </>
      )}
    </div>
  );
}
