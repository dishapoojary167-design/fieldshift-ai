import { z } from 'zod';
import {
  boundingBoxSchema,
  geoCoordinateSchema,
  geoJsonMultiPolygonSchema,
  geoJsonPolygonSchema,
} from './geo.schema.ts';
import { isoTimestampSchema } from './observation.schema.ts';

export const irrigationTypeSchema = z.enum([
  'rainfed',
  'drip',
  'sprinkler',
  'canal',
  'borewell',
  'mixed',
  'unknown',
]);

export const farmLocationSchema = z.object({
  coordinate: geoCoordinateSchema,
  countryCode: z.string().min(2).max(3),
  countryName: z.string().min(1),
  regionCode: z.string().min(2).max(16),
  regionName: z.string().min(1),
  district: z.string().optional(),
  locality: z.string().optional(),
  agroClimaticZone: z.string().optional(),
});

export const farmBoundarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  geometry: z.union([geoJsonPolygonSchema, geoJsonMultiPolygonSchema]),
  centroid: geoCoordinateSchema,
  bbox: boundingBoxSchema,
  areaHectares: z.number().positive(),
  perimeterMeters: z.number().positive().optional(),
  crs: z.literal('EPSG:4326'),
});

export const farmPlotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: farmLocationSchema,
  boundary: farmBoundarySchema.optional(),
  irrigationType: irrigationTypeSchema,
  soilTextureClass: z.string().optional(),
  currentCropId: z.string().optional(),
  notes: z.string().optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
