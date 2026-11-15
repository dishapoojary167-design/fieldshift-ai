import type { BoundingBox, GeoJsonPolygon } from '../types/common.ts';
import type {
  FarmBoundary,
  FarmGeometryGeoJson,
  GeoCoordinates,
  SoilBoundaryContext,
} from '../types/domain.ts';

const EARTH_RADIUS_METERS = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const SQ_METERS_PER_HECTARE = 10_000;
const SQ_METERS_PER_ACRE = 4046.8564224;

export function haversineDistanceMeters(a: GeoCoordinates, b: GeoCoordinates): number {
  const lat1 = a.latitude * DEG_TO_RAD;
  const lat2 = b.latitude * DEG_TO_RAD;
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dLon = (b.longitude - a.longitude) * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Computes geodesic surface area (m²) of a closed polygon on a sphere using
 * the Chamberlain-Duquette spherical excess approximation (same formulation used
 * by Leaflet-area / geojson-area).
 */
export function calculateGeodesicAreaSqMeters(vertices: GeoCoordinates[]): number {
  if (vertices.length < 3) {
    return 0;
  }

  let area = 0;
  const count = vertices.length;

  for (let i = 0; i < count; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % count];
    const lon1 = p1.longitude * DEG_TO_RAD;
    const lon2 = p2.longitude * DEG_TO_RAD;
    const lat1 = p1.latitude * DEG_TO_RAD;
    const lat2 = p2.latitude * DEG_TO_RAD;

    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs((area * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
}

export function calculatePerimeterMeters(vertices: GeoCoordinates[]): number {
  if (vertices.length < 2) {
    return 0;
  }
  let perimeter = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    perimeter += haversineDistanceMeters(current, next);
  }
  return perimeter;
}

export function calculateCentroid(vertices: GeoCoordinates[]): GeoCoordinates {
  if (vertices.length === 0) {
    return { latitude: 0, longitude: 0 };
  }

  let latSum = 0;
  let lonSum = 0;
  for (const v of vertices) {
    latSum += v.latitude;
    lonSum += v.longitude;
  }

  return {
    latitude: Number((latSum / vertices.length).toFixed(6)),
    longitude: Number((lonSum / vertices.length).toFixed(6)),
  };
}

export function createFarmBoundary(
  id: string,
  name: string,
  vertices: GeoCoordinates[],
  now: Date = new Date(),
): FarmBoundary {
  const normalizedVertices = vertices.map((v) => ({
    latitude: Number(v.latitude.toFixed(6)),
    longitude: Number(v.longitude.toFixed(6)),
  }));
  const areaSqMeters = calculateGeodesicAreaSqMeters(normalizedVertices);

  return {
    id,
    name,
    vertices: normalizedVertices,
    centroid: calculateCentroid(normalizedVertices),
    areaSqMeters,
    areaHectares: areaSqMeters / SQ_METERS_PER_HECTARE,
    areaAcres: areaSqMeters / SQ_METERS_PER_ACRE,
    perimeterMeters: calculatePerimeterMeters(normalizedVertices),
    updatedAt: now.toISOString(),
  };
}

export function updateFarmBoundaryVertices(
  boundary: FarmBoundary,
  vertices: GeoCoordinates[],
  now: Date = new Date(),
): FarmBoundary {
  return createFarmBoundary(boundary.id, boundary.name, vertices, now);
}

export function toGeoJsonPolygon(boundary: FarmBoundary): FarmGeometryGeoJson {
  const ring: Array<[number, number]> = boundary.vertices.map((v) => [
    v.longitude,
    v.latitude,
  ]);
  if (ring.length > 0) {
    ring.push([ring[0][0], ring[0][1]]);
  }

  return {
    type: 'Feature',
    properties: {
      id: boundary.id,
      name: boundary.name,
      areaHectares: Number(boundary.areaHectares.toFixed(2)),
      areaAcres: Number(boundary.areaAcres.toFixed(2)),
    },
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

export function calculateBoundingBox(vertices: GeoCoordinates[]): BoundingBox {
  if (vertices.length === 0) {
    return { west: 0, south: 0, east: 0, north: 0 };
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const v of vertices) {
    if (v.longitude < west) west = v.longitude;
    if (v.longitude > east) east = v.longitude;
    if (v.latitude < south) south = v.latitude;
    if (v.latitude > north) north = v.latitude;
  }
  return {
    west: Number(west.toFixed(6)),
    south: Number(south.toFixed(6)),
    east: Number(east.toFixed(6)),
    north: Number(north.toFixed(6)),
  };
}

export function extractOuterRingVertices(polygon: GeoJsonPolygon): GeoCoordinates[] {
  const outerRing = polygon.coordinates[0] ?? [];
  if (outerRing.length === 0) return [];
  const lastIdx = outerRing.length - 1;
  const isClosed =
    lastIdx > 0 &&
    outerRing[0][0] === outerRing[lastIdx][0] &&
    outerRing[0][1] === outerRing[lastIdx][1];
  const slice = isClosed ? outerRing.slice(0, -1) : outerRing;
  return slice.map((pos) => ({
    latitude: pos[1],
    longitude: pos[0],
    ...(pos[2] !== undefined ? { elevationMeters: pos[2] } : {}),
  }));
}

export function calculateBoundingBoxFromGeoJsonPolygon(polygon: GeoJsonPolygon): BoundingBox {
  return calculateBoundingBox(extractOuterRingVertices(polygon));
}

export function calculateCentroidFromGeoJsonPolygon(polygon: GeoJsonPolygon): GeoCoordinates {
  return calculateCentroid(extractOuterRingVertices(polygon));
}

export function calculateAreaHectaresFromGeoJsonPolygon(polygon: GeoJsonPolygon): number {
  const sqMeters = calculateGeodesicAreaSqMeters(extractOuterRingVertices(polygon));
  return Number((sqMeters / SQ_METERS_PER_HECTARE).toFixed(4));
}

export function calculateBoundingBoxCenter(bbox: BoundingBox): GeoCoordinates {
  return {
    latitude: Number(((bbox.south + bbox.north) / 2).toFixed(6)),
    longitude: Number(((bbox.west + bbox.east) / 2).toFixed(6)),
  };
}

export function countGeoJsonPolygonVertices(polygon: GeoJsonPolygon): number {
  return extractOuterRingVertices(polygon).length;
}

export function createBoundaryPayload(boundary: FarmBoundary): SoilBoundaryContext {
  return {
    id: boundary.id,
    name: boundary.name,
    areaHectares: boundary.areaHectares,
    centroid: boundary.centroid,
    geometry: toGeoJsonPolygon(boundary).geometry,
    bbox: calculateBoundingBox(boundary.vertices),
  };
}
