import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { LocateFixed, Maximize2, Minus, Plus } from 'lucide-react';
import type {
  EcostressResultPayload,
  FarmBoundary,
  GeoCoordinates,
  HlsResultPayload,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import {
  buildGibsWmtsTileUrl,
  GIBS_LAYER_DEFINITIONS,
  OSM_BASE_LAYER,
  type EnvironmentalLayerState,
  type ParcelTelemetryLayerId,
} from '../../config/gibsLayers.ts';
import { useFarmWorkspace } from '../../context/FarmWorkspaceContext.tsx';
import { DEFAULT_FARM_LOCATION } from '../../state/farmWorkspaceReducer.ts';
import {
  extractLatestEcostressView,
  extractLatestHlsView,
  formatShortDate,
} from '../environmental/environmentalUtils.ts';
import { LayerLegendOverlay } from './LayerLegendOverlay.tsx';

export interface MapViewportCommand {
  type: 'focus' | 'fit_boundary';
  coordinates?: GeoCoordinates;
  zoom?: number;
  boundary?: FarmBoundary;
  nonce: number;
}

interface AgriculturalMapViewportProps {
  layers: EnvironmentalLayerState[];
  inspectedParcelLayers?: ParcelTelemetryLayerId[];
  command: MapViewportCommand | null;
  weatherSummary?: WeatherTelemetrySnapshot | null;
  ecostressResult?: EcostressResultPayload | null;
  hlsResult?: HlsResultPayload | null;
  onOpenWeather?: () => void;
  onOpenEnvironmental?: () => void;
}

const LOCATION_PIN_ICON = L.divIcon({
  className: 'fieldshift-div-icon',
  html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 1C6.82 1 1 6.82 1 14C1 23.75 14 35 14 35C14 35 27 23.75 27 14C27 6.82 21.18 1 14 1Z" fill="#2563EB" stroke="#FFFFFF" stroke-width="2"/>
    <circle cx="14" cy="14" r="5" fill="#FFFFFF"/>
  </svg>`,
  iconSize: [28, 36],
  iconAnchor: [14, 35],
  popupAnchor: [0, -32],
});

const DRAFT_VERTEX_ICON = L.divIcon({
  className: 'fieldshift-div-icon',
  html: `<div style="width:12px;height:12px;border-radius:9999px;background:#059669;border:2px solid #ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.35);"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const EDIT_VERTEX_ICON = L.divIcon({
  className: 'fieldshift-div-icon',
  html: `<div style="width:14px;height:14px;border-radius:9999px;background:#2563EB;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:grab;"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const MIDPOINT_ICON = L.divIcon({
  className: 'fieldshift-div-icon',
  html: `<div style="width:12px;height:12px;border-radius:9999px;background:#ffffff;border:2px solid #2563EB;opacity:0.9;cursor:pointer;"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function MapControllerBridge({
  command,
  containerRef,
  onCursorMove,
  onZoomChange,
  onMapReady,
}: {
  command: MapViewportCommand | null;
  containerRef: RefObject<HTMLDivElement | null>;
  onCursorMove: (coords: GeoCoordinates | null) => void;
  onZoomChange: (zoom: number) => void;
  onMapReady: (map: L.Map) => void;
}) {
  const map = useMap();
  const { state, dispatch } = useFarmWorkspace();

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useEffect(() => {
    let rafId: number | null = null;
    let settleTimerId: ReturnType<typeof setTimeout> | null = null;

    const scheduleInvalidateSize = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const leafletEl = map.getContainer();
        if (!leafletEl || !leafletEl.isConnected) {
          return;
        }
        const rect = leafletEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          map.invalidateSize({ pan: false });
        }
      });
    };

    // Run once after initial mount and again after CSS layout settles
    scheduleInvalidateSize();
    settleTimerId = setTimeout(scheduleInvalidateSize, 120);

    const observedTarget = containerRef.current ?? map.getContainer();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && observedTarget) {
      resizeObserver = new ResizeObserver(() => {
        scheduleInvalidateSize();
      });
      resizeObserver.observe(observedTarget);
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && observedTarget) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            scheduleInvalidateSize();
          }
        },
        { threshold: 0.01 },
      );
      intersectionObserver.observe(observedTarget);
    }

    const handleWindowResize = () => {
      scheduleInvalidateSize();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleInvalidateSize();
      }
    };

    window.addEventListener('resize', handleWindowResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (settleTimerId !== null) {
        clearTimeout(settleTimerId);
      }
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [map, containerRef]);

  useEffect(() => {
    if (!command) {
      return;
    }
    if (command.type === 'focus' && command.coordinates) {
      map.flyTo([command.coordinates.latitude, command.coordinates.longitude], command.zoom ?? 13, {
        duration: 0.6,
      });
    } else if (command.type === 'fit_boundary' && command.boundary && command.boundary.vertices.length >= 3) {
      const bounds = L.latLngBounds(
        command.boundary.vertices.map((v) => [v.latitude, v.longitude] as [number, number]),
      );
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
    }
  }, [command, map]);

  useEffect(() => {
    if (state.mode === 'drawing') {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [map, state.mode]);

  useMapEvents({
    mousemove(e) {
      onCursorMove({ latitude: e.latlng.lat, longitude: e.latlng.lng });
    },
    mouseout() {
      onCursorMove(null);
    },
    zoomend() {
      onZoomChange(map.getZoom());
    },
    click(e) {
      if (state.mode === 'drawing') {
        dispatch({
          type: 'ADD_DRAFT_VERTEX',
          payload: { latitude: e.latlng.lat, longitude: e.latlng.lng },
        });
      }
    },
    dblclick() {
      if (state.mode === 'drawing' && state.draftVertices.length >= 3) {
        dispatch({ type: 'FINISH_DRAWING' });
      }
    },
  });

  return null;
}

export function AgriculturalMapViewport({
  layers,
  inspectedParcelLayers = [],
  command,
  weatherSummary,
  ecostressResult = null,
  hlsResult = null,
  onOpenWeather,
  onOpenEnvironmental,
}: AgriculturalMapViewportProps) {
  const { state, selectedBoundary, dispatch } = useFarmWorkspace();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [cursorCoords, setCursorCoords] = useState<GeoCoordinates | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(12);
  const ecoView = useMemo(() => extractLatestEcostressView(ecostressResult), [ecostressResult]);
  const hlsView = useMemo(() => extractLatestHlsView(hlsResult), [hlsResult]);

  const activeOverlays = useMemo(
    () =>
      layers
        .filter((l) => l.enabled)
        .map((layerState) => ({
          state: layerState,
          def: GIBS_LAYER_DEFINITIONS.find((d) => d.id === layerState.id)!,
        }))
        .filter((entry) => Boolean(entry.def)),
    [layers],
  );

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
    setZoomLevel(map.getZoom());
  }, []);

  function handleZoomIn() {
    mapRef.current?.zoomIn();
  }

  function handleZoomOut() {
    mapRef.current?.zoomOut();
  }

  function handleResetView() {
    mapRef.current?.flyTo(
      [state.markerLocation.latitude, state.markerLocation.longitude],
      12,
      { duration: 0.5 },
    );
  }

  function handleFitSelectedBoundary() {
    if (!selectedBoundary || !mapRef.current || selectedBoundary.vertices.length < 3) {
      return;
    }
    const bounds = L.latLngBounds(
      selectedBoundary.vertices.map((v) => [v.latitude, v.longitude] as [number, number]),
    );
    mapRef.current.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }

  const draftPositions = state.draftVertices.map((v) => [v.latitude, v.longitude] as [number, number]);
  const previewWithCursor =
    state.mode === 'drawing' && cursorCoords && draftPositions.length > 0
      ? [...draftPositions, [cursorCoords.latitude, cursorCoords.longitude] as [number, number]]
      : draftPositions;

  return (
    <div
      ref={containerRef}
      className={`relative isolate h-full w-full min-w-0 overflow-hidden ${
        state.mode === 'drawing' ? 'cursor-crosshair' : ''
      }`}
    >
      <MapContainer
        center={[DEFAULT_FARM_LOCATION.latitude, DEFAULT_FARM_LOCATION.longitude]}
        zoom={12}
        zoomControl={false}
        className="relative h-full w-full"
      >
        <TileLayer
          url={OSM_BASE_LAYER.url}
          attribution={OSM_BASE_LAYER.attribution}
          maxZoom={OSM_BASE_LAYER.maxZoom}
        />

        {activeOverlays.map(({ def, state: layerState }) => (
          <TileLayer
            key={`${def.id}-${layerState.date}`}
            url={buildGibsWmtsTileUrl(def, layerState.date)}
            attribution={def.sourceAttribution}
            opacity={layerState.opacity}
            maxNativeZoom={def.maxNativeZoom}
            maxZoom={19}
            errorTileUrl=""
          />
        ))}

        <MapControllerBridge
          command={command}
          containerRef={containerRef}
          onCursorMove={setCursorCoords}
          onZoomChange={setZoomLevel}
          onMapReady={handleMapReady}
        />

        {/* Draggable Farm Location Marker */}
        <Marker
          position={[state.markerLocation.latitude, state.markerLocation.longitude]}
          icon={LOCATION_PIN_ICON}
          draggable={state.mode !== 'drawing'}
          eventHandlers={{
            dragend(e) {
              const marker = e.target as L.Marker;
              const latLng = marker.getLatLng();
              dispatch({
                type: 'SET_MARKER_LOCATION',
                payload: {
                  coordinates: { latitude: latLng.lat, longitude: latLng.lng },
                },
              });
            },
          }}
        >
          <Popup>
            <div className="min-w-48 text-xs">
              <p className="font-semibold text-slate-900">{state.markerLabel}</p>
              <p className="mt-1 font-mono tabular-nums text-slate-600">
                {state.markerLocation.latitude.toFixed(5)}°,{' '}
                {state.markerLocation.longitude.toFixed(5)}°
              </p>
              {weatherSummary && (
                <div className="mt-2 border-t border-slate-200 pt-2 font-mono tabular-nums text-[11px] text-slate-700">
                  <p className="font-sans font-semibold text-slate-800">
                    Observed ({weatherSummary.dateRange.startDate} → {weatherSummary.dateRange.endDate})
                  </p>
                  <p>
                    Mean Temp:{' '}
                    {weatherSummary.summary.meanTempC !== null
                      ? `${weatherSummary.summary.meanTempC.toFixed(1)} °C`
                      : 'Unavailable'}
                  </p>
                  <p>Rainfall: {weatherSummary.summary.totalPrecipitationMm.toFixed(1)} mm</p>
                </div>
              )}
              {(ecoView || hlsView) && (
                <div className="mt-2 border-t border-slate-200 pt-2 font-mono tabular-nums text-[11px] text-slate-700 space-y-0.5">
                  <p className="font-sans font-semibold text-slate-800">
                    ECOSTRESS (70 m) &amp; HLS (30 m)
                  </p>
                  {ecoView && (
                    <p>
                      ET: {ecoView.latestEtWm2 !== null ? `${ecoView.latestEtWm2.toFixed(1)} W/m²` : 'N/A'} · ESI:{' '}
                      {ecoView.latestEsiRatio !== null ? ecoView.latestEsiRatio.toFixed(3) : 'N/A'} (
                      {formatShortDate(ecoView.etObservationDate ?? ecoView.esiObservationDate)})
                    </p>
                  )}
                  {hlsView && (
                    <p>
                      NDVI: {hlsView.latestNdvi !== null ? hlsView.latestNdvi.toFixed(3) : 'N/A'} · NDWI:{' '}
                      {hlsView.latestNdwi !== null ? hlsView.latestNdwi.toFixed(3) : 'N/A'} (
                      {formatShortDate(hlsView.ndviAcquisitionDate ?? hlsView.ndwiAcquisitionDate)})
                    </p>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                {onOpenWeather && (
                  <button
                    type="button"
                    onClick={onOpenWeather}
                    className="font-medium text-blue-600 hover:underline cursor-pointer"
                  >
                    Open Weather &amp; Climate →
                  </button>
                )}
                {onOpenEnvironmental && (
                  <button
                    type="button"
                    onClick={onOpenEnvironmental}
                    className="font-medium text-emerald-700 hover:underline cursor-pointer"
                  >
                    Open Satellites &amp; ET →
                  </button>
                )}
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Saved Farm Boundary Polygons */}
        {state.boundaries.map((boundary) => {
          const isSelected = boundary.id === state.selectedBoundaryId;
          const positions = boundary.vertices.map(
            (v) => [v.latitude, v.longitude] as [number, number],
          );

          return (
            <Polygon
              key={boundary.id}
              positions={positions}
              pathOptions={{
                color: isSelected ? '#2563EB' : '#475569',
                weight: isSelected ? 3 : 2,
                fillColor: isSelected ? '#3B82F6' : '#64748B',
                fillOpacity: isSelected ? 0.22 : 0.1,
              }}
              eventHandlers={{
                click(e) {
                  if (state.mode === 'drawing') {
                    return;
                  }
                  L.DomEvent.stopPropagation(e);
                  dispatch({ type: 'SELECT_BOUNDARY', payload: { id: boundary.id } });
                },
              }}
            >
              <Popup>
                <div className="min-w-48 text-xs">
                  <p className="font-semibold text-slate-900">{boundary.name}</p>
                  <p className="mt-1 font-mono tabular-nums text-slate-700">
                    {boundary.areaHectares.toFixed(2)} ha ({boundary.areaAcres.toFixed(2)} ac)
                  </p>
                  <p className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-500">
                    Centroid: {boundary.centroid.latitude.toFixed(4)}°,{' '}
                    {boundary.centroid.longitude.toFixed(4)}°
                  </p>
                  {isSelected && weatherSummary && (
                    <div className="mt-2 border-t border-slate-200 pt-2 font-mono tabular-nums text-[11px] text-slate-700">
                      <p className="font-sans font-semibold text-slate-800">
                        Observed NASA POWER
                      </p>
                      <p>
                        Temp:{' '}
                        {weatherSummary.summary.meanTempC !== null
                          ? `${weatherSummary.summary.meanTempC.toFixed(1)} °C`
                          : 'Unavailable'}{' '}
                        · Rain: {weatherSummary.summary.totalPrecipitationMm.toFixed(1)} mm
                      </p>
                    </div>
                  )}
                  {isSelected && (ecoView || hlsView) && (
                    <div className="mt-2 border-t border-slate-200 pt-2 font-mono tabular-nums text-[11px] text-slate-700 space-y-0.5">
                      <p className="font-sans font-semibold text-slate-800">
                        Parcel Satellite Telemetry
                      </p>
                      {ecoView && (
                        <p>
                          ET: {ecoView.latestEtWm2 !== null ? `${ecoView.latestEtWm2.toFixed(1)} W/m²` : 'N/A'} · ESI:{' '}
                          {ecoView.latestEsiRatio !== null ? ecoView.latestEsiRatio.toFixed(3) : 'N/A'} (
                          {formatShortDate(ecoView.etObservationDate)})
                        </p>
                      )}
                      {hlsView && (
                        <p>
                          NDVI: {hlsView.latestNdvi !== null ? hlsView.latestNdvi.toFixed(3) : 'N/A'} · NDWI:{' '}
                          {hlsView.latestNdwi !== null ? hlsView.latestNdwi.toFixed(3) : 'N/A'} (
                          {formatShortDate(hlsView.ndviAcquisitionDate)})
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {onOpenWeather && (
                      <button
                        type="button"
                        onClick={onOpenWeather}
                        className="font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Inspect Weather Telemetry →
                      </button>
                    )}
                    {onOpenEnvironmental && (
                      <button
                        type="button"
                        onClick={onOpenEnvironmental}
                        className="font-medium text-emerald-700 hover:underline cursor-pointer"
                      >
                        Open Satellites &amp; ET →
                      </button>
                    )}
                  </div>
                </div>
              </Popup>
            </Polygon>
          );
        })}

        {/* Live Draft Drawing Polyline + Vertices */}
        {state.mode === 'drawing' && draftPositions.length >= 3 && (
          <Polygon
            positions={draftPositions}
            pathOptions={{
              color: '#059669',
              weight: 2,
              dashArray: '6 4',
              fillColor: '#10B981',
              fillOpacity: 0.15,
            }}
          />
        )}

        {state.mode === 'drawing' && previewWithCursor.length >= 2 && (
          <Polyline
            positions={previewWithCursor}
            pathOptions={{ color: '#059669', weight: 2, dashArray: '5 5' }}
          />
        )}

        {state.mode === 'drawing' &&
          state.draftVertices.map((vertex, idx) => (
            <Marker
              key={`draft-${idx}`}
              position={[vertex.latitude, vertex.longitude]}
              icon={DRAFT_VERTEX_ICON}
              eventHandlers={{
                click(e) {
                  if (idx === 0 && state.draftVertices.length >= 3) {
                    L.DomEvent.stopPropagation(e);
                    dispatch({ type: 'FINISH_DRAWING' });
                  }
                },
              }}
            />
          ))}

        {/* Interactive Vertex Editing Handles for Selected Boundary */}
        {state.mode === 'editing' &&
          selectedBoundary &&
          selectedBoundary.vertices.map((vertex, idx) => {
            const nextVertex =
              selectedBoundary.vertices[(idx + 1) % selectedBoundary.vertices.length];
            const midpoint: GeoCoordinates = {
              latitude: (vertex.latitude + nextVertex.latitude) / 2,
              longitude: (vertex.longitude + nextVertex.longitude) / 2,
            };

            return (
              <span key={`edit-group-${selectedBoundary.id}-${idx}`}>
                <Marker
                  position={[vertex.latitude, vertex.longitude]}
                  icon={EDIT_VERTEX_ICON}
                  draggable
                  eventHandlers={{
                    dragend(e) {
                      const marker = e.target as L.Marker;
                      const pos = marker.getLatLng();
                      dispatch({
                        type: 'UPDATE_BOUNDARY_VERTEX',
                        payload: {
                          id: selectedBoundary.id,
                          vertexIndex: idx,
                          coordinates: { latitude: pos.lat, longitude: pos.lng },
                        },
                      });
                    },
                    contextmenu(e) {
                      L.DomEvent.stopPropagation(e);
                      dispatch({
                        type: 'REMOVE_BOUNDARY_VERTEX',
                        payload: { id: selectedBoundary.id, vertexIndex: idx },
                      });
                    },
                  }}
                />
                <Marker
                  position={[midpoint.latitude, midpoint.longitude]}
                  icon={MIDPOINT_ICON}
                  eventHandlers={{
                    click(e) {
                      L.DomEvent.stopPropagation(e);
                      dispatch({
                        type: 'INSERT_BOUNDARY_VERTEX',
                        payload: {
                          id: selectedBoundary.id,
                          afterIndex: idx,
                          coordinates: midpoint,
                        },
                      });
                    },
                  }}
                />
              </span>
            );
          })}
      </MapContainer>

      {/* Custom Map Zoom & Fit Controls (Top Right HUD) */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-sm">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex h-9 w-9 items-center justify-center border-b border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex h-9 w-9 items-center justify-center border-b border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Center on location marker"
            title="Center on location marker"
            className="flex h-9 w-9 items-center justify-center border-b border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleFitSelectedBoundary}
            disabled={!selectedBoundary}
            aria-label="Fit selected farm boundary"
            title="Fit selected farm boundary"
            className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Live Cursor Coordinates & Zoom HUD (Top Left — clear of bottom legend & attribution) */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-4.5rem)] flex flex-wrap items-center gap-2">
        <div className="pointer-events-auto max-w-full truncate rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 font-mono tabular-nums text-[11px] text-slate-700 shadow-sm">
          {cursorCoords ? (
            <span>
              {cursorCoords.latitude.toFixed(5)}°, {cursorCoords.longitude.toFixed(5)}°
            </span>
          ) : (
            <span className="text-slate-400">Hover map for coordinates</span>
          )}
          <span className="mx-2 text-slate-300">|</span>
          <span>Z{zoomLevel}</span>
        </div>
      </div>

      {/* Active Layer Legends (Bottom Right — cleanly above attribution) */}
      <div className="pointer-events-none absolute bottom-6 right-3 z-10 max-w-[calc(100%-1.5rem)]">
        <LayerLegendOverlay
          layers={layers}
          inspectedParcelLayers={inspectedParcelLayers}
          ecostressResult={ecostressResult}
          hlsResult={hlsResult}
        />
      </div>
    </div>
  );
}
