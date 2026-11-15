import { useSelectedFarmGeometry } from '../../context/FarmWorkspaceContext.tsx';

interface ModuleHandoffPreviewProps {
  moduleName: 'Soil' | 'Crop';
  onReturnToMap: () => void;
}

export function ModuleHandoffPreview({ moduleName, onReturnToMap }: ModuleHandoffPreviewProps) {
  const { markerLocation, markerLabel, selectedBoundary, selectedGeoJson, activeCoordinates } =
    useSelectedFarmGeometry();

  return (
    <section className="mx-auto max-w-4xl p-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Module Geometry Context
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              {moduleName} Analysis — Selected Farm Geometry
            </h1>
          </div>
          <button
            type="button"
            onClick={onReturnToMap}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Back to Map Workspace
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-600">
          This module receives the active location marker and selected farm boundary directly from
          application state. Downstream {moduleName.toLowerCase()} retrieval endpoints will query
          with this geometry when implemented in subsequent modules.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Target Coordinates
            </h2>
            <p className="mt-2 font-mono tabular-nums text-base font-semibold text-slate-900">
              {activeCoordinates.latitude.toFixed(6)}°, {activeCoordinates.longitude.toFixed(6)}°
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {selectedBoundary
                ? `Derived from selected boundary centroid (${selectedBoundary.name})`
                : `Derived from location marker (${markerLabel})`}
            </p>
            <p className="mt-2 font-mono tabular-nums text-[11px] text-slate-500">
              Marker pin: {markerLocation.latitude.toFixed(5)}°, {markerLocation.longitude.toFixed(5)}°
            </p>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Selected Boundary Geometry
            </h2>
            {selectedBoundary ? (
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Parcel Name</dt>
                  <dd className="font-semibold text-slate-900">{selectedBoundary.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Area</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {selectedBoundary.areaHectares.toFixed(2)} ha ({selectedBoundary.areaAcres.toFixed(2)} ac)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Vertices</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {selectedBoundary.vertices.length}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-slate-600">
                No farm boundary polygon drawn or selected yet. Use the Map Workspace to draw a
                parcel boundary.
              </p>
            )}
          </div>
        </div>

        {selectedGeoJson && (
          <div className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              GeoJSON Feature Payload
            </h2>
            <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
              {JSON.stringify(selectedGeoJson, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
