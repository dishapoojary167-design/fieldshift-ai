import { z } from 'zod';

export const geoCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevationMeters: z.number().finite().optional(),
});

export const boundingBoxSchema = z
  .object({
    west: z.number().finite().min(-180, 'west longitude must be >= -180').max(180, 'west longitude must be <= 180'),
    south: z.number().finite().min(-90, 'south latitude must be >= -90').max(90, 'south latitude must be <= 90'),
    east: z.number().finite().min(-180, 'east longitude must be >= -180').max(180, 'east longitude must be <= 180'),
    north: z.number().finite().min(-90, 'north latitude must be >= -90').max(90, 'north latitude must be <= 90'),
  })
  .refine((b) => b.north >= b.south, {
    message: 'BoundingBox north latitude must be >= south latitude',
  })
  .refine((b) => b.east >= b.west, {
    message: 'BoundingBox east longitude must be >= west longitude',
  });

const lonSchema = z
  .number()
  .finite()
  .min(-180, 'GeoJSON position[0] (longitude) must be >= -180')
  .max(180, 'GeoJSON position[0] (longitude) must be <= 180');

const latSchema = z
  .number()
  .finite()
  .min(-90, 'GeoJSON position[1] (latitude) must be >= -90 — verify [longitude, latitude] coordinate order')
  .max(90, 'GeoJSON position[1] (latitude) must be <= 90 — verify [longitude, latitude] coordinate order');

export const geoJsonPositionSchema = z.union([
  z.tuple([lonSchema, latSchema]),
  z.tuple([lonSchema, latSchema, z.number().finite()]),
]);

function computeRingSignedArea(ring: Array<readonly number[]>): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export const linearRingSchema = z
  .array(geoJsonPositionSchema)
  .min(4, 'GeoJSON polygon ring requires at least 4 coordinates')
  .refine((ring) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first[0] === last[0] && first[1] === last[1];
  }, 'GeoJSON polygon linear ring must be closed (first coordinate equals last coordinate)')
  .refine((ring) => {
    const distinct = new Set(ring.slice(0, -1).map((pos) => `${pos[0]}:${pos[1]}`));
    return distinct.size >= 3;
  }, 'GeoJSON polygon linear ring must contain at least 3 distinct vertices')
  .refine(
    (ring) => Math.abs(computeRingSignedArea(ring)) > 1e-12,
    'GeoJSON polygon linear ring must enclose a non-zero area',
  );

export const geoJsonPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: geoJsonPositionSchema,
});

export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(linearRingSchema).min(1),
});

export const geoJsonMultiPolygonSchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(linearRingSchema).min(1)).min(1),
});

export const geoJsonGeometrySchema = z.union([
  geoJsonPointSchema,
  geoJsonPolygonSchema,
  geoJsonMultiPolygonSchema,
]);

export const spatialCoverageSchema = z.object({
  kind: z.enum(['point', 'polygon', 'multipolygon', 'bbox', 'region']),
  centroid: geoCoordinateSchema,
  bbox: boundingBoxSchema.optional(),
  geometry: geoJsonGeometrySchema.optional(),
  countryCode: z.string().min(2).max(3).optional(),
  regionCode: z.string().min(2).max(16).optional(),
  adminLevel1: z.string().optional(),
  adminLevel2: z.string().optional(),
});
