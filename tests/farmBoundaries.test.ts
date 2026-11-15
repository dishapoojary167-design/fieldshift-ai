import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createInitialFarmWorkspaceState,
  farmWorkspaceReducer,
  getSelectedBoundary,
} from '../client/state/farmWorkspaceReducer.ts';
import {
  calculateCentroid,
  calculateGeodesicAreaSqMeters,
  calculatePerimeterMeters,
  toGeoJsonPolygon,
} from '../shared/index.ts';

describe('Farm boundary drawing, editing, clearing, and selecting', () => {
  const squareVertices = [
    { latitude: 42.0, longitude: -93.6 },
    { latitude: 42.0, longitude: -93.59 },
    { latitude: 42.01, longitude: -93.59 },
    { latitude: 42.01, longitude: -93.6 },
  ];

  it('draws a farm boundary polygon, computes area/centroid, and selects it', () => {
    let state = createInitialFarmWorkspaceState();
    state = farmWorkspaceReducer(state, { type: 'START_DRAWING' });
    assert.equal(state.mode, 'drawing');

    // Cannot finish with fewer than 3 vertices
    state = farmWorkspaceReducer(state, {
      type: 'ADD_DRAFT_VERTEX',
      payload: squareVertices[0],
    });
    state = farmWorkspaceReducer(state, {
      type: 'ADD_DRAFT_VERTEX',
      payload: squareVertices[1],
    });
    state = farmWorkspaceReducer(state, { type: 'FINISH_DRAWING' });
    assert.equal(state.boundaries.length, 0);
    assert.equal(state.mode, 'drawing');

    // Undo and re-add to test undoDraftVertex, then add remaining vertices
    state = farmWorkspaceReducer(state, { type: 'UNDO_DRAFT_VERTEX' });
    assert.equal(state.draftVertices.length, 1);

    for (const v of squareVertices.slice(1)) {
      state = farmWorkspaceReducer(state, { type: 'ADD_DRAFT_VERTEX', payload: v });
    }
    state = farmWorkspaceReducer(state, {
      type: 'FINISH_DRAWING',
      payload: { name: 'North 40 Field' },
    });

    assert.equal(state.mode, 'idle');
    assert.equal(state.boundaries.length, 1);
    assert.equal(state.selectedBoundaryId, 'parcel-1');

    const selected = getSelectedBoundary(state);
    assert.ok(selected);
    assert.equal(selected.name, 'North 40 Field');
    assert.equal(selected.vertices.length, 4);
    assert.ok(selected.areaHectares > 85 && selected.areaHectares < 100);
    assert.ok(selected.areaAcres > 210 && selected.areaAcres < 250);
    assert.ok(selected.perimeterMeters > 3500);
    assert.ok(Math.abs(selected.centroid.latitude - 42.005) < 0.0001);

    const geoJson = toGeoJsonPolygon(selected);
    assert.equal(geoJson.geometry.type, 'Polygon');
    assert.equal(geoJson.geometry.coordinates[0].length, 5);
  });

  it('edits vertices (update, insert, remove) and recalculates area', () => {
    let state = createInitialFarmWorkspaceState();
    state = farmWorkspaceReducer(state, { type: 'START_DRAWING' });
    for (const v of squareVertices) {
      state = farmWorkspaceReducer(state, { type: 'ADD_DRAFT_VERTEX', payload: v });
    }
    state = farmWorkspaceReducer(state, { type: 'FINISH_DRAWING' });

    const originalArea = getSelectedBoundary(state)!.areaSqMeters;

    state = farmWorkspaceReducer(state, { type: 'SET_EDIT_MODE', payload: { enabled: true } });
    assert.equal(state.mode, 'editing');

    // Expand north-east corner to increase polygon area
    state = farmWorkspaceReducer(state, {
      type: 'UPDATE_BOUNDARY_VERTEX',
      payload: {
        id: 'parcel-1',
        vertexIndex: 2,
        coordinates: { latitude: 42.02, longitude: -93.58 },
      },
    });

    const expanded = getSelectedBoundary(state)!;
    assert.ok(expanded.areaSqMeters > originalArea);

    // Insert a 5th vertex
    state = farmWorkspaceReducer(state, {
      type: 'INSERT_BOUNDARY_VERTEX',
      payload: {
        id: 'parcel-1',
        afterIndex: 0,
        coordinates: { latitude: 41.995, longitude: -93.595 },
      },
    });
    assert.equal(getSelectedBoundary(state)!.vertices.length, 5);

    // Remove vertex back down to 4
    state = farmWorkspaceReducer(state, {
      type: 'REMOVE_BOUNDARY_VERTEX',
      payload: { id: 'parcel-1', vertexIndex: 1 },
    });
    assert.equal(getSelectedBoundary(state)!.vertices.length, 4);

    // Guard: never remove below 3 vertices
    state = farmWorkspaceReducer(state, {
      type: 'REMOVE_BOUNDARY_VERTEX',
      payload: { id: 'parcel-1', vertexIndex: 0 },
    });
    state = farmWorkspaceReducer(state, {
      type: 'REMOVE_BOUNDARY_VERTEX',
      payload: { id: 'parcel-1', vertexIndex: 0 },
    });
    assert.equal(getSelectedBoundary(state)!.vertices.length, 3);
  });

  it('selects between multiple parcels and clears individual or all boundaries', () => {
    let state = createInitialFarmWorkspaceState();

    // Draw parcel 1
    state = farmWorkspaceReducer(state, { type: 'START_DRAWING' });
    for (const v of squareVertices) {
      state = farmWorkspaceReducer(state, { type: 'ADD_DRAFT_VERTEX', payload: v });
    }
    state = farmWorkspaceReducer(state, { type: 'FINISH_DRAWING' });

    // Draw parcel 2
    state = farmWorkspaceReducer(state, { type: 'START_DRAWING' });
    for (const v of squareVertices.slice(0, 3)) {
      state = farmWorkspaceReducer(state, { type: 'ADD_DRAFT_VERTEX', payload: v });
    }
    state = farmWorkspaceReducer(state, { type: 'FINISH_DRAWING' });

    assert.equal(state.boundaries.length, 2);
    assert.equal(state.selectedBoundaryId, 'parcel-2');

    // Select parcel 1
    state = farmWorkspaceReducer(state, { type: 'SELECT_BOUNDARY', payload: { id: 'parcel-1' } });
    assert.equal(state.selectedBoundaryId, 'parcel-1');

    // Delete parcel 1 -> falls back to parcel 2
    state = farmWorkspaceReducer(state, { type: 'DELETE_BOUNDARY', payload: { id: 'parcel-1' } });
    assert.equal(state.boundaries.length, 1);
    assert.equal(state.selectedBoundaryId, 'parcel-2');

    // Clear all boundaries
    state = farmWorkspaceReducer(state, { type: 'CLEAR_ALL_BOUNDARIES' });
    assert.equal(state.boundaries.length, 0);
    assert.equal(state.selectedBoundaryId, null);
    assert.equal(state.mode, 'idle');
  });

  it('loads demonstration farm parcels and selects first parcel', () => {
    let state = createInitialFarmWorkspaceState();
    assert.equal(state.boundaries.length, 0);

    state = farmWorkspaceReducer(state, { type: 'LOAD_DEMO_BOUNDARIES' });
    assert.equal(state.boundaries.length, 3);
    assert.equal(state.selectedBoundaryId, 'demo-nashik-vineyard');
    assert.equal(state.markerLabel, 'Nashik Vineyard Parcel');

    const selected = getSelectedBoundary(state);
    assert.ok(selected);
    assert.equal(selected.name, 'Nashik Vineyard Parcel');
    assert.ok(selected.areaHectares > 0);
  });

  it('returns zero area/perimeter for degenerate geometry', () => {
    assert.equal(calculateGeodesicAreaSqMeters([]), 0);
    assert.equal(calculateGeodesicAreaSqMeters(squareVertices.slice(0, 2)), 0);
    assert.equal(calculatePerimeterMeters([squareVertices[0]]), 0);
    assert.deepEqual(calculateCentroid([]), { latitude: 0, longitude: 0 });
  });
});
