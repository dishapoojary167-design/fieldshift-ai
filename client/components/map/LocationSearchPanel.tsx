import { useState, type FormEvent } from 'react';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import type { GeoCoordinates, LocationCandidate } from '../../../shared/index.ts';
import { useFarmWorkspace } from '../../context/FarmWorkspaceContext.tsx';
import { apiClient, ApiClientError } from '../../services/apiClient.ts';

interface LocationSearchPanelProps {
  onFocusCoordinates: (coords: GeoCoordinates, zoom?: number) => void;
}

export function LocationSearchPanel({ onFocusCoordinates }: LocationSearchPanelProps) {
  const { state, dispatch } = useFarmWorkspace();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError('Enter at least 2 characters or a "lat, lon" pair.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.resolveLocation({ query: trimmed });
      const list = result.candidates ?? [
        {
          displayName: result.regionName || `${result.coordinates.latitude}, ${result.coordinates.longitude}`,
          coordinates: result.coordinates,
          countryCode: result.countryCode,
          regionName: result.regionName,
        },
      ];
      setCandidates(list);

      dispatch({
        type: 'SET_MARKER_LOCATION',
        payload: {
          coordinates: result.coordinates,
          label: result.regionName || list[0]?.displayName,
        },
      });
      onFocusCoordinates(result.coordinates, 12);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Unable to search location right now.');
      }
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectCandidate(candidate: LocationCandidate) {
    dispatch({
      type: 'SET_MARKER_LOCATION',
      payload: {
        coordinates: candidate.coordinates,
        label: candidate.regionName || candidate.displayName,
      },
    });
    onFocusCoordinates(candidate.coordinates, 13);
  }

  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Location Search
        </h2>
        <button
          type="button"
          onClick={() => onFocusCoordinates(state.markerLocation, 13)}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
          title="Center map on location marker"
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
          Center Pin
        </button>
      </div>

      <form onSubmit={handleSearch} className="mt-2.5 flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Place name or lat, lon"
            aria-label="Search farm location"
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : 'Locate'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="mt-2.5 divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.coordinates.latitude}-${candidate.coordinates.longitude}-${index}`}>
              <button
                type="button"
                onClick={() => handleSelectCandidate(candidate)}
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs hover:bg-white transition-colors cursor-pointer"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">{candidate.displayName}</p>
                  <p className="mt-0.5 font-mono tabular-nums text-[11px] text-slate-500">
                    {candidate.coordinates.latitude.toFixed(4)}°, {candidate.coordinates.longitude.toFixed(4)}°
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-600">Active Pin</span>
          <span className="font-mono tabular-nums text-slate-900">
            {state.markerLocation.latitude.toFixed(5)}°, {state.markerLocation.longitude.toFixed(5)}°
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-500" title={state.markerLabel}>
          {state.markerLabel} · Drag marker on map to reposition
        </p>
      </div>
    </section>
  );
}
