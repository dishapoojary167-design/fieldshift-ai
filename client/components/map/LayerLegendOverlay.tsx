import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { EcostressResultPayload, HlsResultPayload } from '../../../shared/index.ts';
import {
  GIBS_LAYER_DEFINITIONS,
  PARCEL_TELEMETRY_LAYER_DEFINITIONS,
  type EnvironmentalLayerState,
  type ParcelTelemetryLayerId,
} from '../../config/gibsLayers.ts';
import {
  extractLatestEcostressView,
  extractLatestHlsView,
  formatShortDate,
} from '../environmental/environmentalUtils.ts';

interface LayerLegendOverlayProps {
  layers: EnvironmentalLayerState[];
  inspectedParcelLayers?: ParcelTelemetryLayerId[];
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
}

export function LayerLegendOverlay({
  layers,
  inspectedParcelLayers = [],
  ecostressResult = null,
  hlsResult = null,
}: LayerLegendOverlayProps) {
  const [collapsed, setCollapsed] = useState(false);

  const activeLayers = layers
    .filter((l) => l.enabled)
    .map((state) => ({
      state,
      def: GIBS_LAYER_DEFINITIONS.find((d) => d.id === state.id)!,
    }))
    .filter((item) => Boolean(item.def));

  const parcelLegends = inspectedParcelLayers
    .map((id) => PARCEL_TELEMETRY_LAYER_DEFINITIONS.find((d) => d.id === id)!)
    .filter(Boolean);

  const ecoView = extractLatestEcostressView(ecostressResult);
  const hlsView = extractLatestHlsView(hlsResult);

  if (activeLayers.length === 0 && parcelLegends.length === 0) {
    return null;
  }

  const totalCount = activeLayers.length + parcelLegends.length;

  return (
    <section
      aria-label="Active environmental layer legends"
      className="pointer-events-auto w-64 sm:w-80 max-w-full rounded-md border border-slate-200 bg-white/95 shadow-sm backdrop-blur-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-xs font-semibold text-slate-900">
          Layer Legend ({totalCount})
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          {collapsed ? (
            <>
              Expand <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </>
          ) : (
            <>
              Collapse <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </>
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="max-h-44 sm:max-h-64 divide-y divide-slate-200 overflow-y-auto px-3 py-1">
          {activeLayers.map(({ def, state }) => (
            <div key={def.id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">{def.label}</h3>
                <span className="font-mono tabular-nums text-[10px] text-slate-500">
                  {state.date}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500">
                Units: <span className="font-mono text-slate-700">{def.units}</span>
              </p>

              {def.legend.type === 'gradient' ? (
                <div className="mt-2">
                  <div
                    className="h-2.5 w-full rounded-sm border border-slate-300"
                    style={{
                      background: `linear-gradient(to right, ${def.legend.stops
                        .map((s) => s.color)
                        .join(', ')})`,
                    }}
                  />
                  <div className="mt-1 flex justify-between gap-1 font-mono tabular-nums text-[9px] text-slate-600">
                    {def.legend.stops.map((stop, idx) => (
                      <span key={idx} className="truncate">
                        {stop.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <ul className="mt-2 grid grid-cols-1 gap-1">
                  {def.legend.swatches.map((swatch, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-[10px] text-slate-700">
                      <span
                        className="h-2.5 w-3.5 shrink-0 rounded-xs border border-slate-300"
                        style={{ backgroundColor: swatch.color }}
                      />
                      <span>{swatch.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-1.5 text-[10px] text-slate-400">
                Source: {def.sourceAttribution}
              </p>
            </div>
          ))}

          {parcelLegends.map((def) => {
            const acqDate =
              def.id === 'ecostress_et'
                ? formatShortDate(ecoView?.etObservationDate ?? ecoView?.esiObservationDate)
                : formatShortDate(hlsView?.ndviAcquisitionDate ?? hlsView?.ndwiAcquisitionDate);

            return (
              <div key={def.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">{def.label}</h3>
                  <span className="font-mono tabular-nums text-[10px] text-slate-500">
                    {acqDate !== 'Unavailable' ? acqDate : 'Not queried'}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-amber-700">
                  Spatial map raster unavailable (AppEEARS telemetry only)
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                  {def.datasetName} · {def.resolutionLabel}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Units: <span className="font-mono text-slate-700">{def.units}</span>
                </p>

                {def.legend.type === 'gradient' && (
                  <div className="mt-2">
                    <div
                      className="h-2.5 w-full rounded-sm border border-slate-300"
                      style={{
                        background: `linear-gradient(to right, ${def.legend.stops
                          .map((s) => s.color)
                          .join(', ')})`,
                      }}
                    />
                    <div className="mt-1 flex justify-between gap-1 font-mono tabular-nums text-[9px] text-slate-600">
                      {def.legend.stops.map((stop, idx) => (
                        <span key={idx} className="truncate">
                          {stop.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-1.5 text-[10px] text-slate-400">
                  Source: {def.sourceAttribution}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
