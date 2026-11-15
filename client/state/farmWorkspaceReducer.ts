import {
  createFarmBoundary,
  updateFarmBoundaryVertices,
  type FarmBoundary,
  type GeoCoordinates,
} from '../../shared/index.ts';

export type BoundaryInteractionMode = 'idle' | 'drawing' | 'editing';

export interface FarmWorkspaceState {
  markerLocation: GeoCoordinates;
  markerLabel: string;
  boundaries: FarmBoundary[];
  selectedBoundaryId: string | null;
  mode: BoundaryInteractionMode;
  draftVertices: GeoCoordinates[];
  nextBoundaryCounter: number;
}

export type FarmWorkspaceAction =
  | { type: 'SET_MARKER_LOCATION'; payload: { coordinates: GeoCoordinates; label?: string } }
  | { type: 'START_DRAWING' }
  | { type: 'ADD_DRAFT_VERTEX'; payload: GeoCoordinates }
  | { type: 'UNDO_DRAFT_VERTEX' }
  | { type: 'CANCEL_DRAWING' }
  | { type: 'FINISH_DRAWING'; payload?: { id?: string; name?: string } }
  | { type: 'SELECT_BOUNDARY'; payload: { id: string | null } }
  | { type: 'SET_EDIT_MODE'; payload: { enabled: boolean } }
  | {
      type: 'UPDATE_BOUNDARY_VERTEX';
      payload: { id: string; vertexIndex: number; coordinates: GeoCoordinates };
    }
  | {
      type: 'INSERT_BOUNDARY_VERTEX';
      payload: { id: string; afterIndex: number; coordinates: GeoCoordinates };
    }
  | { type: 'REMOVE_BOUNDARY_VERTEX'; payload: { id: string; vertexIndex: number } }
  | { type: 'RENAME_BOUNDARY'; payload: { id: string; name: string } }
  | { type: 'DELETE_BOUNDARY'; payload: { id: string } }
  | { type: 'CLEAR_ALL_BOUNDARIES' }
  | { type: 'LOAD_DEMO_BOUNDARIES' };

export const DEFAULT_FARM_LOCATION: GeoCoordinates = {
  latitude: 19.9988,
  longitude: 73.791,
};

export const DEMO_FARM_BOUNDARIES: FarmBoundary[] = [
  createFarmBoundary('demo-nashik-vineyard', 'Nashik Vineyard Parcel', [
    { latitude: 19.998, longitude: 73.788 },
    { latitude: 20.0015, longitude: 73.7915 },
    { latitude: 19.9995, longitude: 73.794 },
    { latitude: 19.996, longitude: 73.7905 },
  ]),
  createFarmBoundary('demo-bhopal-soybean', 'Bhopal Soybean Research Parcel', [
    { latitude: 23.253, longitude: 77.408 },
    { latitude: 23.2575, longitude: 77.408 },
    { latitude: 23.2575, longitude: 77.4125 },
    { latitude: 23.253, longitude: 77.4125 },
  ]),
  createFarmBoundary('demo-ludhiana-wheat', 'Ludhiana Wheat-Rice Farm', [
    { latitude: 30.898, longitude: 75.847 },
    { latitude: 30.903, longitude: 75.847 },
    { latitude: 30.903, longitude: 75.853 },
    { latitude: 30.898, longitude: 75.853 },
  ]),
];

export function createInitialFarmWorkspaceState(): FarmWorkspaceState {
  return {
    markerLocation: DEFAULT_FARM_LOCATION,
    markerLabel: 'Nashik Agricultural Zone, Maharashtra',
    boundaries: [],
    selectedBoundaryId: null,
    mode: 'idle',
    draftVertices: [],
    nextBoundaryCounter: 1,
  };
}

export function farmWorkspaceReducer(
  state: FarmWorkspaceState,
  action: FarmWorkspaceAction,
): FarmWorkspaceState {
  switch (action.type) {
    case 'SET_MARKER_LOCATION': {
      const normalized: GeoCoordinates = {
        latitude: Number(action.payload.coordinates.latitude.toFixed(6)),
        longitude: Number(action.payload.coordinates.longitude.toFixed(6)),
      };
      return {
        ...state,
        markerLocation: normalized,
        markerLabel:
          action.payload.label ??
          `${normalized.latitude.toFixed(4)}°, ${normalized.longitude.toFixed(4)}°`,
      };
    }

    case 'START_DRAWING': {
      return {
        ...state,
        mode: 'drawing',
        draftVertices: [],
      };
    }

    case 'ADD_DRAFT_VERTEX': {
      if (state.mode !== 'drawing') {
        return state;
      }
      const vertex: GeoCoordinates = {
        latitude: Number(action.payload.latitude.toFixed(6)),
        longitude: Number(action.payload.longitude.toFixed(6)),
      };
      return {
        ...state,
        draftVertices: [...state.draftVertices, vertex],
      };
    }

    case 'UNDO_DRAFT_VERTEX': {
      if (state.mode !== 'drawing' || state.draftVertices.length === 0) {
        return state;
      }
      return {
        ...state,
        draftVertices: state.draftVertices.slice(0, -1),
      };
    }

    case 'CANCEL_DRAWING': {
      return {
        ...state,
        mode: 'idle',
        draftVertices: [],
      };
    }

    case 'FINISH_DRAWING': {
      if (state.mode !== 'drawing' || state.draftVertices.length < 3) {
        return state;
      }
      const index = state.nextBoundaryCounter;
      const id = action.payload?.id ?? `parcel-${index}`;
      const name = action.payload?.name?.trim() || `Farm Parcel ${index}`;
      const boundary = createFarmBoundary(id, name, state.draftVertices);

      return {
        ...state,
        boundaries: [...state.boundaries, boundary],
        selectedBoundaryId: boundary.id,
        mode: 'idle',
        draftVertices: [],
        nextBoundaryCounter: index + 1,
      };
    }

    case 'SELECT_BOUNDARY': {
      const targetId = action.payload.id;
      if (targetId === null) {
        return {
          ...state,
          selectedBoundaryId: null,
          mode: state.mode === 'editing' ? 'idle' : state.mode,
        };
      }
      const exists = state.boundaries.some((b) => b.id === targetId);
      if (!exists) {
        return state;
      }
      return {
        ...state,
        selectedBoundaryId: targetId,
        mode: state.mode === 'drawing' ? 'drawing' : 'idle',
      };
    }

    case 'SET_EDIT_MODE': {
      if (action.payload.enabled && state.selectedBoundaryId) {
        return {
          ...state,
          mode: 'editing',
          draftVertices: [],
        };
      }
      return {
        ...state,
        mode: state.mode === 'editing' ? 'idle' : state.mode,
      };
    }

    case 'UPDATE_BOUNDARY_VERTEX': {
      const { id, vertexIndex, coordinates } = action.payload;
      return {
        ...state,
        boundaries: state.boundaries.map((boundary) => {
          if (boundary.id !== id) {
            return boundary;
          }
          if (vertexIndex < 0 || vertexIndex >= boundary.vertices.length) {
            return boundary;
          }
          const nextVertices = boundary.vertices.map((v, idx) =>
            idx === vertexIndex ? coordinates : v,
          );
          return updateFarmBoundaryVertices(boundary, nextVertices);
        }),
      };
    }

    case 'INSERT_BOUNDARY_VERTEX': {
      const { id, afterIndex, coordinates } = action.payload;
      return {
        ...state,
        boundaries: state.boundaries.map((boundary) => {
          if (boundary.id !== id) {
            return boundary;
          }
          if (afterIndex < 0 || afterIndex >= boundary.vertices.length) {
            return boundary;
          }
          const nextVertices = [
            ...boundary.vertices.slice(0, afterIndex + 1),
            coordinates,
            ...boundary.vertices.slice(afterIndex + 1),
          ];
          return updateFarmBoundaryVertices(boundary, nextVertices);
        }),
      };
    }

    case 'REMOVE_BOUNDARY_VERTEX': {
      const { id, vertexIndex } = action.payload;
      return {
        ...state,
        boundaries: state.boundaries.map((boundary) => {
          if (boundary.id !== id || boundary.vertices.length <= 3) {
            return boundary;
          }
          if (vertexIndex < 0 || vertexIndex >= boundary.vertices.length) {
            return boundary;
          }
          const nextVertices = boundary.vertices.filter((_, idx) => idx !== vertexIndex);
          return updateFarmBoundaryVertices(boundary, nextVertices);
        }),
      };
    }

    case 'RENAME_BOUNDARY': {
      const trimmed = action.payload.name.trim();
      if (!trimmed) {
        return state;
      }
      return {
        ...state,
        boundaries: state.boundaries.map((boundary) =>
          boundary.id === action.payload.id ? { ...boundary, name: trimmed } : boundary,
        ),
      };
    }

    case 'DELETE_BOUNDARY': {
      const remaining = state.boundaries.filter((b) => b.id !== action.payload.id);
      const nextSelected =
        state.selectedBoundaryId === action.payload.id
          ? remaining[remaining.length - 1]?.id ?? null
          : state.selectedBoundaryId;

      return {
        ...state,
        boundaries: remaining,
        selectedBoundaryId: nextSelected,
        mode: nextSelected === null && state.mode === 'editing' ? 'idle' : state.mode,
      };
    }

    case 'CLEAR_ALL_BOUNDARIES': {
      return {
        ...state,
        boundaries: [],
        selectedBoundaryId: null,
        draftVertices: [],
        mode: 'idle',
      };
    }

    case 'LOAD_DEMO_BOUNDARIES': {
      const first = DEMO_FARM_BOUNDARIES[0];
      return {
        ...state,
        boundaries: DEMO_FARM_BOUNDARIES,
        selectedBoundaryId: first ? first.id : null,
        markerLocation: first ? first.centroid : state.markerLocation,
        markerLabel: first ? first.name : state.markerLabel,
        mode: 'idle',
      };
    }

    default:
      return state;
  }
}

export function getSelectedBoundary(state: FarmWorkspaceState): FarmBoundary | null {
  if (!state.selectedBoundaryId) {
    return null;
  }
  return state.boundaries.find((b) => b.id === state.selectedBoundaryId) ?? null;
}
