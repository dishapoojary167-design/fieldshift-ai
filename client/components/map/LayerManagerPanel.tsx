import { Layers } from 'lucide-react';
import type { EcostressResultPayload, HlsResultPayload } from '../../../shared/index.ts';
import {
  GIBS_LAYER_DEFINITIONS,
  PARCEL_TELEMETRY_LAYER_DEFINITIONS,
  type EnvironmentalLayerId,
  type EnvironmentalLayerState,
  type ParcelTelemetryLayerId,
} from '../../config/gibsLayers.ts';
import {
  extractLatestEcostressView,
  extractLatestHlsView,
  formatShortDate,
} from '../environmental/environmentalUtils.ts';

interface LayerManagerPanelProps {
  layers: EnvironmentalLayerState[];
  onToggleLayer: (id: EnvironmentalLayerId) => void;
  onChangeOpacity: (id: EnvironmentalLayerId, opacity: number) => void;
  onChangeDate: (id: EnvironmentalLayerId, date: string) => void;
  inspectedParcelLayers?: ParcelTelemetryLayerId[];
  onToggleParcelLayerLegend?: (id: ParcelTelemetryLayerId) => void;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  onOpenEnvironmental?: () => void;
}

export function LayerManagerPanel({
  layers,
  onToggleLayer,
  onChangeOpacity,
  onChangeDate,
  inspectedParcelLayers = [],
  onToggleParcelLayerLegend,
  ecostressResult = null,
  hlsResult = null,
  onOpenEnvironmental,
}: LayerManagerPanelProps) {
  const activeCount = layers.filter((l) => l.enabled).length;
  const ecoView = extractLatestEcostressView(ecostressResult);
  const hlsView = extractLatestHlsView(hlsResult);

  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          NASA GIBS Layers
        </h2>
        <span className="font-mono tabular-nums text-[11px] text-slate-500">
          {activeCount} active
        </span>
      </div>

      <p className="mt-1 text-[11px] text-slate-500">
        Base map: OpenStreetMap · Overlays via NASA EOSDIS GIBS WMTS
      </p>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        {GIBS_LAYER_DEFINITIONS.map((def) => {
          const state = layers.find((l) => l.id === def.id);
          if (!state) {
            return null;
          }

          return (
            <div
              key={def.id}
              className={`rounded-md border p-2.5 transition-colors ${
                state.enabled ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'
              }`}
            >
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.enabled}
                  onChange={() => onToggleLayer(def.id)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">{def.label}</span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">
                      {def.units}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-600">{def.description}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{def.sourceAttribution}</p>
                </div>
              </label>

              {state.enabled && (
                <div className="mt-2.5 space-y-2 border-t border-slate-200/80 pt-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <label htmlFor={`date-${def.id}`} className="text-slate-600">
                      Date
                    </label>
                    <input
                      id={`date-${def.id}`}
                      type="date"
                      value={state.date}
                      max={def.defaultDate}
                      onChange={(e) => onChangeDate(def.id, e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-800"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <label htmlFor={`opacity-${def.id}`} className="text-slate-600">
                      Opacity
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={`opacity-${def.id}`}
                        type="range"
                        min={15}
                        max={100}
                        step={5}
                        value={Math.round(state.opacity * 100)}
                        onChange={(e) =>
                          onChangeOpacity(def.id, Number.parseInt(e.target.value, 10) / 100)
                        }
                        className="h-1.5 w-24 accent-blue-600 cursor-pointer"
                      />
                      <span className="w-8 text-right font-mono tabular-nums text-[11px] text-slate-700">
                        {Math.round(state.opacity * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* High-Resolution ECOSTRESS & HLS Telemetry Layers (No Spatial Map Tile Raster) */}
      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              High-Resolution Parcel Satellite Layers (AppEEARS Polygon / Point Only)
            </h3>
            <p className="text-[11px] text-slate-500">
              Global WMTS raster tiles are unavailable for these sensors; no fabricated map rasters are rendered. Inspect legend metadata or open Environmental Intelligence.
            </p>
          </div>
          {onOpenEnvironmental && (
            <button
              type="button"
              onClick={onOpenEnvironmental}
              className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Environmental Intelligence →
            </button>
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {PARCEL_TELEMETRY_LAYER_DEFINITIONS.map((def) => {
            const inspected = inspectedParcelLayers.includes(def.id);
            const acquisitionDate =
              def.id === 'ecostress_et'
                ? formatShortDate(ecoView?.etObservationDate ?? ecoView?.esiObservationDate)
                : formatShortDate(hlsView?.ndviAcquisitionDate ?? hlsView?.ndwiAcquisitionDate);

            return (
              <div
                key={def.id}
                className={`rounded-md border p-2.5 text-xs ${
                  inspected ? 'border-slate-300 bg-slate-50/70' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900">{def.label}</span>
                      <span className="font-mono text-[10px] font-medium text-amber-700">
                        · Spatial Raster Unavailable
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                      {def.datasetName} · {def.resolutionLabel} · {def.units}
                    </p>
                  </div>
                  {onToggleParcelLayerLegend && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inspected}
                        onChange={() => onToggleParcelLayerLegend(def.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                      />
                      <span>Show Legend</span>
                    </label>
                  )}
                </div>

                <p className="mt-1 text-[11px] text-slate-600">{def.unavailableReason}</p>
                <p className="mt-1 font-mono tabular-nums text-[10px] text-slate-500">
                  Source: {def.sourceAttribution} · Latest Acquisition:{' '}
                  {acquisitionDate !== 'Unavailable' ? acquisitionDate : 'Not yet queried'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
