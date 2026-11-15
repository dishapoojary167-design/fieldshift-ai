import { z } from 'zod';

export const regionParamsSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .min(2)
    .max(3)
    .transform((v) => v.toUpperCase()),
  regionCode: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .transform((v) => v.toUpperCase()),
});

export const observationQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD format'),
  parameter: z.string().min(1).optional(),
});
