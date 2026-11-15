import { z } from 'zod';
import { geoCoordinateSchema, spatialCoverageSchema } from './geo.schema.ts';

export const isoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO 8601 timestamp',
  });

export const dataQualityFlagSchema = z.enum([
  'measured',
  'derived',
  'interpolated',
  'provisional',
  'missing',
  'invalid',
]);

export const spatialResolutionSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(['m', 'km', 'deg']),
  label: z.string().min(1),
});

export const dataProvenanceSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  datasetName: z.string().min(1),
  datasetVersion: z.string().optional(),
  processingLevel: z.string().optional(),
  endpoint: z.string().optional(),
  license: z.string().optional(),
  citation: z.string().optional(),
});

export const observationQualitySchema = z.object({
  flag: dataQualityFlagSchema,
  confidence: z.number().min(0).max(1).optional(),
  uncertainty: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const temporalAggregationSchema = z.enum([
  'instantaneous',
  'hourly',
  'daily',
  'dekadal',
  'monthly',
  'seasonal',
  'static',
]);

export const environmentalObservationSchema = z.object({
  id: z.string().min(1),
  location: geoCoordinateSchema,
  spatialCoverage: spatialCoverageSchema,
  parameter: z.string().min(1),
  value: z.number().finite().nullable(),
  unit: z.string().min(1),
  observationTimestamp: isoTimestampSchema,
  retrievalTimestamp: isoTimestampSchema,
  dataSource: dataProvenanceSchema,
  spatialResolution: spatialResolutionSchema.optional(),
  quality: observationQualitySchema,
  temporalAggregation: temporalAggregationSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
