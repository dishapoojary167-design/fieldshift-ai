import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  calculateBoundingBox,
  createBoundaryPayload,
  toGeoJsonPolygon,
  type BoundingBox,
  type FarmBoundary,
  type FarmGeometryGeoJson,
  type GeoCoordinates,
  type SoilBoundaryContext,
} from '../../shared/index.ts';
import {
  createInitialFarmWorkspaceState,
  farmWorkspaceReducer,
  getSelectedBoundary,
  type FarmWorkspaceAction,
  type FarmWorkspaceState,
} from '../state/farmWorkspaceReducer.ts';

export interface FarmWorkspaceContextValue {
  state: FarmWorkspaceState;
  selectedBoundary: FarmBoundary | null;
  selectedGeoJson: FarmGeometryGeoJson | null;
  selectedBbox: BoundingBox | null;
  selectedBoundaryPayload: SoilBoundaryContext | null;
  activeCoordinates: GeoCoordinates;
  dispatch: Dispatch<FarmWorkspaceAction>;
}

const FarmWorkspaceContext = createContext<FarmWorkspaceContextValue | null>(null);

export function FarmWorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    farmWorkspaceReducer,
    undefined,
    createInitialFarmWorkspaceState,
  );

  const value = useMemo<FarmWorkspaceContextValue>(() => {
    const selectedBoundary = getSelectedBoundary(state);
    const selectedGeoJson = selectedBoundary ? toGeoJsonPolygon(selectedBoundary) : null;
    const selectedBbox = selectedBoundary ? calculateBoundingBox(selectedBoundary.vertices) : null;
    const selectedBoundaryPayload = selectedBoundary
      ? createBoundaryPayload(selectedBoundary)
      : null;
    const activeCoordinates = selectedBoundary ? selectedBoundary.centroid : state.markerLocation;

    return {
      state,
      selectedBoundary,
      selectedGeoJson,
      selectedBbox,
      selectedBoundaryPayload,
      activeCoordinates,
      dispatch,
    };
  }, [state]);

  return <FarmWorkspaceContext.Provider value={value}>{children}</FarmWorkspaceContext.Provider>;
}

export function useFarmWorkspace(): FarmWorkspaceContextValue {
  const ctx = useContext(FarmWorkspaceContext);
  if (!ctx) {
    throw new Error('useFarmWorkspace must be used within a FarmWorkspaceProvider');
  }
  return ctx;
}

/**
 * Shared selector hook exposing selected farm geometry and marker location
 * to downstream Soil and Crop modules.
 */
export function useSelectedFarmGeometry() {
  const {
    state,
    selectedBoundary,
    selectedGeoJson,
    selectedBbox,
    selectedBoundaryPayload,
    activeCoordinates,
  } = useFarmWorkspace();
  return {
    markerLocation: state.markerLocation,
    markerLabel: state.markerLabel,
    selectedBoundary,
    selectedGeoJson,
    selectedBbox,
    selectedBoundaryPayload,
    activeCoordinates,
    allBoundaries: state.boundaries,
  };
}
