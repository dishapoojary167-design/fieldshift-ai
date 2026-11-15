import { Check, Edit3, PenTool, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import type { FarmBoundary } from '../../../shared/index.ts';
import { useFarmWorkspace } from '../../context/FarmWorkspaceContext.tsx';

interface BoundaryToolsPanelProps {
  onFitBoundary: (boundary: FarmBoundary) => void;
}

export function BoundaryToolsPanel({ onFitBoundary }: BoundaryToolsPanelProps) {
  const { state, selectedBoundary, dispatch } = useFarmWorkspace();
  const isDrawing = state.mode === 'drawing';
  const isEditing = state.mode === 'editing';

  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Farm Boundaries
        </h2>
        <div className="flex items-center gap-2">
          {state.boundaries.length === 0 && !isDrawing && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'LOAD_DEMO_BOUNDARIES' })}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Load Demo Farms
            </button>
          )}
          {state.boundaries.length > 0 && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'CLEAR_ALL_BOUNDARIES' })}
              className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Primary Boundary Drawing / Editing Controls */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {!isDrawing ? (
          <>
            <button
              type="button"
              onClick={() => dispatch({ type: 'START_DRAWING' })}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PenTool className="h-3.5 w-3.5" aria-hidden="true" />
              Draw Boundary
            </button>

            {state.boundaries.length === 0 && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'LOAD_DEMO_BOUNDARIES' })}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                Demo Parcels
              </button>
            )}

            {selectedBoundary && (
              <button
                type="button"
                onClick={() => dispatch({ type: 'SET_EDIT_MODE', payload: { enabled: !isEditing } })}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  isEditing
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                {isEditing ? 'Done Editing' : 'Edit Vertices'}
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={state.draftVertices.length < 3}
              onClick={() => dispatch({ type: 'FINISH_DRAWING' })}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Finish ({state.draftVertices.length})
            </button>
            <button
              type="button"
              disabled={state.draftVertices.length === 0}
              onClick={() => dispatch({ type: 'UNDO_DRAFT_VERTEX' })}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Undo
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'CANCEL_DRAWING' })}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </button>
          </>
        )}
      </div>

      {isDrawing && (
        <p className="mt-2 text-xs text-slate-600">
          Click on the map to place at least 3 vertices. Double-click or click Finish to close the polygon.
        </p>
      )}

      {isEditing && selectedBoundary && (
        <p className="mt-2 text-xs text-blue-700">
          Drag corner vertices to reshape, or click midpoint handles (+) to insert vertices.
        </p>
      )}

      {/* Saved / Selectable Polygons List */}
      {state.boundaries.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-medium text-slate-500">
            Saved Parcels ({state.boundaries.length})
          </p>
          <ul className="space-y-1.5">
            {state.boundaries.map((boundary) => {
              const isSelected = boundary.id === state.selectedBoundaryId;
              return (
                <li
                  key={boundary.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'SELECT_BOUNDARY', payload: { id: boundary.id } });
                      onFitBoundary(boundary);
                    }}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <p className="truncate font-semibold text-slate-900">{boundary.name}</p>
                    <p className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-600">
                      {boundary.areaHectares.toFixed(2)} ha · {boundary.areaAcres.toFixed(2)} ac ·{' '}
                      {boundary.vertices.length} pts
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'DELETE_BOUNDARY', payload: { id: boundary.id } })}
                    aria-label={`Delete ${boundary.name}`}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        !isDrawing && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 text-center">
            <p className="text-xs text-slate-600">
              No farm boundary active. Draw a custom polygon on the map or load pre-configured demonstration farms.
            </p>
            <button
              type="button"
              onClick={() => dispatch({ type: 'LOAD_DEMO_BOUNDARIES' })}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
              Load Demonstration Parcels
            </button>
          </div>
        )
      )}

      {/* Selected Polygon Geometry Summary */}
      {selectedBoundary && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800">{selectedBoundary.name}</span>
            <span className="text-[11px] font-medium text-emerald-700">Synced to modules</span>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-[11px] text-slate-500">Area (Hectares)</dt>
              <dd className="font-mono tabular-nums font-semibold text-slate-900">
                {selectedBoundary.areaHectares.toFixed(2)} <span className="text-[10px] font-normal text-slate-500">ha</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">Area (Acres)</dt>
              <dd className="font-mono tabular-nums font-semibold text-slate-900">
                {selectedBoundary.areaAcres.toFixed(2)} <span className="text-[10px] font-normal text-slate-500">ac</span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">Perimeter</dt>
              <dd className="font-mono tabular-nums text-slate-900">
                {selectedBoundary.perimeterMeters >= 1000
                  ? `${(selectedBoundary.perimeterMeters / 1000).toFixed(2)} km`
                  : `${Math.round(selectedBoundary.perimeterMeters)} m`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-500">Centroid</dt>
              <dd className="font-mono tabular-nums text-slate-900">
                {selectedBoundary.centroid.latitude.toFixed(4)}°, {selectedBoundary.centroid.longitude.toFixed(4)}°
              </dd>
            </div>
          </dl>

          <details className="mt-2.5 border-t border-slate-200 pt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-900">
              Vertex coordinates ({selectedBoundary.vertices.length})
            </summary>
            <ol className="mt-1.5 max-h-32 space-y-1 overflow-y-auto font-mono tabular-nums text-[11px] text-slate-600">
              {selectedBoundary.vertices.map((vertex, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">#{idx + 1}</span>
                  <span>
                    {vertex.latitude.toFixed(5)}°, {vertex.longitude.toFixed(5)}°
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
