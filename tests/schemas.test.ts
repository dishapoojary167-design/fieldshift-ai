import assert from 'node:assert/strict';
import test from 'node:test';
import {
  environmentalObservationSchema,
  farmBoundarySchema,
  geoCoordinateSchema,
  geoJsonPolygonSchema,
} from '../shared/schemas/index.ts';

test('geoCoordinateSchema validates valid latitude and longitude', () => {
  const parsed = geoCoordinateSchema.parse({
    latitude: 19.7515,
    longitude: 75.7139,
    elevationMeters: 550,
  });
  assert.equal(parsed.latitude, 19.7515);
  assert.equal(parsed.longitude, 75.7139);
});

test('geoJsonPolygonSchema rejects unclosed linear rings', () => {
  const result = geoJsonPolygonSchema.safeParse({
    type: 'Polygon',
    coordinates: [
      [
        [75.7, 19.7],
        [75.75, 19.7],
        [75.75, 19.75],
        [75.7, 19.75],
      ],
    ],
  });
  assert.equal(result.success, false);
});

test('farmBoundarySchema accepts closed GeoJSON polygon boundary', () => {
  const result = farmBoundarySchema.safeParse({
    id: 'plot-mh-001',
    name: 'Aurangabad Benchmark Parcel',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [75.3, 19.85],
          [75.31, 19.85],
          [75.31, 19.86],
          [75.3, 19.86],
          [75.3, 19.85],
        ],
      ],
    },
    centroid: { latitude: 19.855, longitude: 75.305 },
    bbox: { west: 75.3, south: 19.85, east: 75.31, north: 19.86 },
    areaHectares: 115.4,
    crs: 'EPSG:4326',
  });
  assert.equal(result.success, true);
});

test('environmentalObservationSchema validates canonical observation payload', () => {
  const result = environmentalObservationSchema.safeParse({
    id: 'obs-1',
    location: { latitude: 19.7515, longitude: 75.7139 },
    spatialCoverage: {
      kind: 'point',
      centroid: { latitude: 19.7515, longitude: 75.7139 },
      countryCode: 'IN',
      regionCode: 'IN-MH',
    },
    parameter: 'precipitation_total',
    value: 14.2,
    unit: 'mm/day',
    observationTimestamp: '2026-07-15T00:00:00.000Z',
    retrievalTimestamp: '2026-07-16T01:00:00.000Z',
    dataSource: {
      providerId: 'nasa-gpm-imerg',
      providerName: 'NASA GES DISC',
      datasetName: 'GPM IMERG Daily',
    },
    spatialResolution: {
      value: 10,
      unit: 'km',
      label: '0.1 deg (~10 km)',
    },
    quality: {
      flag: 'measured',
      confidence: 0.92,
    },
    temporalAggregation: 'daily',
  });
  assert.equal(result.success, true);
});
