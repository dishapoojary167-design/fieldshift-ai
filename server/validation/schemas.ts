import { z } from 'zod';
import {
  boundingBoxSchema,
  geoJsonPolygonSchema,
} from '../../shared/schemas/geo.schema.ts';
import {
  calculateAreaHectaresFromGeoJsonPolygon,
  calculateBoundingBoxCenter,
  calculateBoundingBoxFromGeoJsonPolygon,
  calculateCentroidFromGeoJsonPolygon,
} from '../../shared/utils/geometry.ts';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90, 'latitude must be >= -90').max(90, 'latitude must be <= 90'),
  longitude: z.number().finite().min(-180, 'longitude must be >= -180').max(180, 'longitude must be <= 180'),
  elevationMeters: z.number().finite().min(-500).max(9000).optional(),
});

export const spatialProcessingModeSchema = z.enum(['auto', 'centroid', 'polygon']);

function parseJsonOrCsvBboxQuery(raw: string, ctx: z.RefinementCtx) {
  let candidate: unknown;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bbox query parameter is not valid JSON.',
      });
      return z.NEVER;
    }
  } else {
    const parts = trimmed.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'bbox query parameter must be JSON {west,south,east,north} or "west,south,east,north".',
      });
      return z.NEVER;
    }
    candidate = {
      west: parts[0],
      south: parts[1],
      east: parts[2],
      north: parts[3],
    };
  }

  const parsed = boundingBoxSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
      });
    }
    return z.NEVER;
  }
  return parsed.data;
}

function parseJsonPolygonQuery(raw: string, ctx: z.RefinementCtx) {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'polygon query parameter must be valid GeoJSON Polygon JSON.',
    });
    return z.NEVER;
  }

  const parsed = geoJsonPolygonSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
      });
    }
    return z.NEVER;
  }
  return parsed.data;
}

export const soilBoundaryContextSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    areaHectares: z.number().finite().nonnegative().optional(),
    centroid: coordinatesSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
  })
  .refine(
    (b) => Boolean(b.centroid || b.geometry || b.bbox),
    {
      message: 'Boundary context must include at least one of centroid, geometry, or bbox.',
    },
  )
  .transform((b) => {
    const derivedCentroid =
      b.centroid ??
      (b.geometry
        ? calculateCentroidFromGeoJsonPolygon(b.geometry)
        : calculateBoundingBoxCenter(b.bbox!));
    const derivedArea =
      b.areaHectares ??
      (b.geometry ? calculateAreaHectaresFromGeoJsonPolygon(b.geometry) : 0);
    const derivedBbox =
      b.bbox ?? (b.geometry ? calculateBoundingBoxFromGeoJsonPolygon(b.geometry) : undefined);

    return {
      id: b.id ?? 'custom-boundary',
      name: b.name ?? 'Selected Farm Boundary',
      areaHectares: derivedArea,
      centroid: derivedCentroid,
      ...(b.geometry ? { geometry: b.geometry } : {}),
      ...(derivedBbox ? { bbox: derivedBbox } : {}),
    };
  });

function hasAnySpatialTarget(val: {
  location?: unknown;
  boundary?: unknown;
  geometry?: unknown;
  bbox?: unknown;
}): boolean {
  return Boolean(val.location || val.boundary || val.geometry || val.bbox);
}

function hasPolygonIfRequired(val: {
  spatialProcessingMode?: 'auto' | 'centroid' | 'polygon';
  boundary?: { geometry?: unknown; bbox?: unknown };
  geometry?: unknown;
  bbox?: unknown;
}): boolean {
  if (val.spatialProcessingMode !== 'polygon') return true;
  return Boolean(val.boundary?.geometry || val.geometry || val.boundary?.bbox || val.bbox);
}

export const dateRangeSchema = z
  .object({
    startDate: z.string().regex(isoDateRegex, 'startDate must be YYYY-MM-DD'),
    endDate: z.string().regex(isoDateRegex, 'endDate must be YYYY-MM-DD'),
  })
  .refine((val) => val.startDate <= val.endDate, {
    message: 'startDate must be on or before endDate',
    path: ['endDate'],
  });

export const nasaDatasetEnum = z.enum(['POWER', 'SMAP', 'MODIS', 'GPM', 'LANDSAT']);

export const locationResolveBodySchema = z
  .object({
    query: z.string().trim().min(2).max(200).optional(),
    coordinates: coordinatesSchema.optional(),
  })
  .refine((val) => Boolean(val.query || val.coordinates), {
    message: 'Either query or coordinates must be provided.',
  });

export const weatherTelemetryBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema
      .refine(
        (range) => {
          const diffDays =
            (Date.parse(`${range.endDate}T00:00:00Z`) -
              Date.parse(`${range.startDate}T00:00:00Z`)) /
            (1000 * 60 * 60 * 24);
          return diffDays <= 731;
        },
        { message: 'dateRange cannot exceed 731 days for daily telemetry queries.' },
      )
      .optional(),
    datasets: z.array(nasaDatasetEnum).min(1).optional(),
    includeGpmImerg: z.boolean().optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const weatherTrendsQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  years: z.coerce.number().int().min(1).max(50).optional(),
});

export const weatherQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    polygon: z.string().transform(parseJsonPolygonQuery).optional(),
    bbox: z.string().transform(parseJsonOrCsvBboxQuery).optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine(
    (q) =>
      (q.latitude !== undefined && q.longitude !== undefined) ||
      Boolean(q.polygon || q.bbox),
    {
      message: 'Provide latitude & longitude or polygon / bbox.',
    },
  )
  .refine(
    (q) => q.spatialProcessingMode !== 'polygon' || Boolean(q.polygon || q.bbox),
    {
      message: 'spatialProcessingMode "polygon" requires polygon or bbox query parameter.',
    },
  );

export const rainfallQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    polygon: z.string().transform(parseJsonPolygonQuery).optional(),
    bbox: z.string().transform(parseJsonOrCsvBboxQuery).optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (q) =>
      (q.latitude !== undefined && q.longitude !== undefined) ||
      Boolean(q.polygon || q.bbox),
    {
      message: 'Provide latitude & longitude or polygon / bbox.',
    },
  )
  .refine(
    (q) => q.spatialProcessingMode !== 'polygon' || Boolean(q.polygon || q.bbox),
    {
      message: 'spatialProcessingMode "polygon" requires polygon or bbox query parameter.',
    },
  );

export const soilMoistureQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    polygon: z.string().transform(parseJsonPolygonQuery).optional(),
    bbox: z.string().transform(parseJsonOrCsvBboxQuery).optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (q) =>
      (q.latitude !== undefined && q.longitude !== undefined) ||
      Boolean(q.polygon || q.bbox),
    {
      message: 'Provide latitude & longitude or polygon / bbox.',
    },
  )
  .refine(
    (q) => q.spatialProcessingMode !== 'polygon' || Boolean(q.polygon || q.bbox),
    {
      message: 'spatialProcessingMode "polygon" requires polygon or bbox query parameter.',
    },
  );

export const soilDepthEnum = z.enum(['0-5', '5-15', '15-30', '30-60']);

export const soilProfileBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    depthCm: soilDepthEnum.optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const soilMoistureBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema.optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

const factorDataSourceEnum = z.enum([
  'observed_historical',
  'modelled_estimate',
  'satellite_derived',
  'measured_lab',
  'user_input',
  'unavailable',
]);

const preferencePriorityEnum = z.enum(['low', 'moderate', 'high']);
const farmingSystemEnum = z.enum(['rainfed', 'irrigated', 'supplemental']);
const growingSeasonEnum = z.enum(['Kharif', 'Rabi', 'Zaid', 'Summer']);

export const cropRecommendationPreferencesSchema = z.object({
  growingSeason: growingSeasonEnum.optional(),
  farmingSystem: farmingSystemEnum.optional(),
  irrigationAvailable: z.boolean().optional(),
  currentCrop: z.string().trim().min(1).max(100).optional(),
  waterConservationPriority: preferencePriorityEnum.optional(),
  soilImprovementPriority: preferencePriorityEnum.optional(),
  diversificationPreference: preferencePriorityEnum.optional(),
});

export const pillarFactorWeightsSchema = z
  .object({
    waterAvailability: z.number().min(0).max(100).optional(),
    temperature: z.number().min(0).max(100).optional(),
    soilPh: z.number().min(0).max(100).optional(),
    soilHealth: z.number().min(0).max(100).optional(),
    seasonalCompatibility: z.number().min(0).max(100).optional(),
  })
  .refine(
    (w) => {
      const vals = Object.values(w).filter((v): v is number => v !== undefined);
      return vals.length === 0 || vals.some((v) => v > 0);
    },
    { message: 'At least one pillar factor weight must be > 0.' },
  );

export const cropSuitabilityInputsSchema = z.object({
  targetSeason: growingSeasonEnum.optional(),
  agroClimaticZoneId: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  irrigationAvailable: z.boolean().optional(),
  farmingSystem: farmingSystemEnum.optional(),
  temperatureMeanC: z.number().min(-30).max(60).nullable().optional(),
  temperatureMaxC: z.number().min(-30).max(65).nullable().optional(),
  temperatureMinC: z.number().min(-40).max(55).nullable().optional(),
  seasonalRainfallMm: z.number().min(0).max(10000).nullable().optional(),
  observedRainfallMm: z.number().min(0).max(10000).nullable().optional(),
  observationDays: z.number().int().min(1).max(731).nullable().optional(),
  annualRainfallMm: z.number().min(0).max(15000).nullable().optional(),
  gpmPrecipitationRateMmHr: z.number().min(0).max(500).nullable().optional(),
  relativeHumidityPercent: z.number().min(0).max(100).nullable().optional(),
  solarRadiationMjM2Day: z.number().min(0).max(50).nullable().optional(),
  windSpeedMs: z.number().min(0).max(80).nullable().optional(),
  soilMoistureM3M3: z.number().min(0).max(1).nullable().optional(),
  soilMoistureSurfaceM3M3: z.number().min(0).max(1).nullable().optional(),
  soilMoistureRootZoneM3M3: z.number().min(0).max(1).nullable().optional(),
  soilPh: z.number().min(2.5).max(11).nullable().optional(),
  soilPhSource: factorDataSourceEnum.optional(),
  soilTexture: z.string().trim().min(1).max(60).nullable().optional(),
  soilTextureSource: factorDataSourceEnum.optional(),
  organicCarbonGKg: z.number().min(0).max(200).nullable().optional(),
  organicCarbonSource: factorDataSourceEnum.optional(),
});

export const cropSuitabilityWeightsSchema = z
  .object({
    temperature: z.number().min(0).max(100).optional(),
    rainfall: z.number().min(0).max(100).optional(),
    soilMoisture: z.number().min(0).max(100).optional(),
    soilPh: z.number().min(0).max(100).optional(),
    soilTexture: z.number().min(0).max(100).optional(),
    organicCarbon: z.number().min(0).max(100).optional(),
    waterRequirement: z.number().min(0).max(100).optional(),
    growingSeason: z.number().min(0).max(100).optional(),
  })
  .refine(
    (w) => {
      const vals = Object.values(w).filter((v): v is number => v !== undefined);
      return vals.length === 0 || vals.some((v) => v > 0);
    },
    { message: 'At least one suitability factor weight must be > 0.' },
  );

export const cropIntelligenceBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    inputs: cropSuitabilityInputsSchema.optional(),
    labSoilTest: z
      .object({
        id: z.string().optional(),
        parcelKey: z.string().optional(),
        dataClassification: z.literal('measured_lab').optional(),
        sampleDate: z.string().max(40),
        labName: z.string().max(120),
        sampleDepthCm: soilDepthEnum.optional(),
        ph: z.number().min(2).max(11).nullable().optional(),
        organicCarbonGKg: z.number().min(0).max(200).nullable().optional(),
        textureClass: z.string().max(80).nullable().optional(),
        notes: z.string().max(500).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    preferences: cropRecommendationPreferencesSchema.optional(),
    autoFetchMissingFarmData: z.boolean().optional(),
    weights: cropSuitabilityWeightsSchema.optional(),
    pillarWeights: pillarFactorWeightsSchema.optional(),
    strictRegionFilter: z.boolean().optional(),
    dateRange: dateRangeSchema.optional(),
    currentCrop: z.string().trim().min(1).max(100).optional(),
    farmSizeHectares: z.number().positive().max(1_000_000).optional(),
    ecostressResult: z.record(z.string(), z.unknown()).nullable().optional(),
    hlsResult: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const cropCatalogQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  season: z.enum(['Kharif', 'Rabi', 'Zaid', 'Summer']).optional(),
  agroClimaticZone: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().min(1).max(80).optional(),
  cropFamily: z.string().trim().min(1).max(60).optional(),
  waterRequirement: z.enum(['low', 'moderate', 'high']).optional(),
  nitrogenFixingOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  soilTexture: z.string().trim().min(1).max(60).optional(),
  phTarget: z.coerce.number().min(3.5).max(10.0).optional(),
  climateZone: z.string().trim().min(1).max(120).optional(),
});

export const cropIdParamsSchema = z.object({
  cropId: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/i, 'cropId must be alphanumeric with hyphens only'),
});

export const cropRotationPlanBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    currentCrop: z.string().trim().min(1, 'currentCrop is required').max(100),
    rotationYears: z.number().int().min(1).max(10),
    soilTextureClass: z.string().trim().min(1).max(80).optional(),
    goals: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

const rotationStrategyIdEnum = z.enum(['existing', 'alternative_a', 'alternative_b', 'user_defined']);

export const rotationSeasonSlotSchema = z
  .object({
    slotIndex: z.number().int().min(0).max(20).optional(),
    year: z.number().int().min(1).max(10),
    season: growingSeasonEnum,
    cropId: z.string().trim().min(1).max(80).optional(),
    cropName: z.string().trim().min(1).max(100).optional(),
  })
  .refine((val) => Boolean(val.cropId || val.cropName), {
    message: 'Each rotation slot must specify cropId or cropName.',
  });

export const rotationComparisonWeightsSchema = z
  .object({
    diversity: z.number().min(0).max(100).optional(),
    waterEfficiency: z.number().min(0).max(100).optional(),
    nitrogenAndNutrientBalance: z.number().min(0).max(100).optional(),
    soilHealth: z.number().min(0).max(100).optional(),
    seasonalAndRegionalFit: z.number().min(0).max(100).optional(),
    pestBreakAndRisk: z.number().min(0).max(100).optional(),
  })
  .refine(
    (w) => {
      const vals = Object.values(w).filter((v): v is number => v !== undefined);
      return vals.length === 0 || vals.some((v) => v > 0);
    },
    { message: 'At least one rotation indicator weight must be > 0.' },
  );

export const rotationPreferencesSchema = z.object({
  farmingSystem: farmingSystemEnum.optional(),
  irrigationAvailable: z.boolean().optional(),
  waterConservationPriority: preferencePriorityEnum.optional(),
  soilImprovementPriority: preferencePriorityEnum.optional(),
  diversificationPreference: preferencePriorityEnum.optional(),
  startingSeason: growingSeasonEnum.optional(),
  seasonsCount: z.number().int().min(3).max(8).optional(),
});

export const rotationGenerateBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    inputs: cropSuitabilityInputsSchema.optional(),
    preferences: rotationPreferencesSchema.optional(),
    currentCrop: z.string().trim().min(1).max(100).optional(),
    existingSequence: z.array(rotationSeasonSlotSchema).min(3).max(8).optional(),
    customSequence: z.array(rotationSeasonSlotSchema).min(3).max(8).optional(),
    indicatorWeights: rotationComparisonWeightsSchema.optional(),
    autoFetchMissingFarmData: z.boolean().optional(),
    strictRegionFilter: z.boolean().optional(),
    dateRange: dateRangeSchema.optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const rotationCompareBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    inputs: cropSuitabilityInputsSchema.optional(),
    preferences: rotationPreferencesSchema.optional(),
    strategies: z
      .array(
        z.object({
          id: rotationStrategyIdEnum,
          label: z.string().trim().min(1).max(100),
          description: z.string().trim().max(300).optional(),
          sequence: z.array(rotationSeasonSlotSchema).min(3).max(8),
        }),
      )
      .min(1)
      .max(6),
    indicatorWeights: rotationComparisonWeightsSchema.optional(),
    autoFetchMissingFarmData: z.boolean().optional(),
    strictRegionFilter: z.boolean().optional(),
    dateRange: dateRangeSchema.optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const aiAssistantBodySchema = z.object({
  prompt: z.string().trim().min(3, 'prompt must be at least 3 characters').max(2000),
  language: z.enum(['en', 'hi']).optional(),
  location: coordinatesSchema.optional(),
  boundary: soilBoundaryContextSchema.optional(),
  geometry: geoJsonPolygonSchema.optional(),
  bbox: boundingBoxSchema.optional(),
  spatialProcessingMode: spatialProcessingModeSchema.optional(),
  currentCrop: z.string().trim().min(1).max(100).optional(),
  contextNotes: z.string().trim().max(2000).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
  farmContext: z
    .object({
      farmName: z.string().trim().max(160).optional(),
      boundary: soilBoundaryContextSchema.optional(),
      geometry: geoJsonPolygonSchema.optional(),
      bbox: boundingBoxSchema.optional(),
      spatialProcessingMode: spatialProcessingModeSchema.optional(),
      state: z.string().trim().max(100).optional(),
      agroClimaticZoneId: z.string().trim().max(100).optional(),
      growingSeason: growingSeasonEnum.optional(),
      farmingSystem: farmingSystemEnum.optional(),
      irrigationAvailable: z.boolean().optional(),
      currentCrop: z.string().trim().max(100).optional(),
      labSoilTest: z
        .object({
          ph: z.number().min(2).max(11).nullable().optional(),
          organicCarbonGKg: z.number().min(0).max(200).nullable().optional(),
          totalNitrogenGKg: z.number().min(0).max(100).nullable().optional(),
          availableNitrogenMgKg: z.number().min(0).max(10000).nullable().optional(),
          phosphorusMgKg: z.number().min(0).max(5000).nullable().optional(),
          potassiumMgKg: z.number().min(0).max(10000).nullable().optional(),
          textureClass: z.string().max(80).nullable().optional(),
          sampleDate: z.string().max(40).optional(),
          labName: z.string().max(120).optional(),
          notes: z.string().max(500).optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
      weatherTelemetry: z.record(z.string(), z.unknown()).nullable().optional(),
      climateTrends: z.record(z.string(), z.unknown()).nullable().optional(),
      soilProfile: z.record(z.string(), z.unknown()).nullable().optional(),
      soilMoisture: z.record(z.string(), z.unknown()).nullable().optional(),
      cropRecommendations: z.record(z.string(), z.unknown()).nullable().optional(),
      rotationPlan: z.record(z.string(), z.unknown()).nullable().optional(),
      ecostressPayload: z.record(z.string(), z.unknown()).nullable().optional(),
      hlsPayload: z.record(z.string(), z.unknown()).nullable().optional(),
      environmentalContext: z.record(z.string(), z.unknown()).nullable().optional(),
      environmentalAnalytics: z.record(z.string(), z.unknown()).nullable().optional(),
      farmIntelligence: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .optional(),
  autoFetchContext: z.boolean().optional(),
});

export const ecostressProductIdEnum = z.enum(['ECO_L3T_JET.002', 'ECO_L4T_ESI.002']);

export const ecostressLayerIdEnum = z.enum([
  'ETdaily',
  'ETinstUncertainty',
  'PTJPLSMinst',
  'STICinst',
  'MOD16inst',
  'BESSinst',
  'PTJPLSMcanopy',
  'PTJPLSMsoil',
  'PTJPLSMinterception',
  'STICcanopy',
  'ESI',
  'PET',
  'cloud',
  'water',
]);

export const ecostressJobSubmitBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema
      .refine(
        (range) => range.startDate >= '2018-07-10',
        { message: 'ECOSTRESS Collection 2 observations start on 2018-07-10.' },
      )
      .refine(
        (range) => {
          const diffDays =
            (Date.parse(`${range.endDate}T00:00:00Z`) -
              Date.parse(`${range.startDate}T00:00:00Z`)) /
            (1000 * 60 * 60 * 24);
          return diffDays <= 366;
        },
        { message: 'ECOSTRESS extraction dateRange cannot exceed 366 days per task.' },
      ),
    products: z.array(ecostressProductIdEnum).min(1).max(2).optional(),
    layers: z.array(ecostressLayerIdEnum).min(1).max(16).optional(),
    taskName: z.string().trim().min(1).max(120).optional(),
    outputFormat: z.enum(['geotiff', 'netcdf4']).optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const ecostressJobParamsSchema = z.object({
  jobId: z
    .string()
    .trim()
    .min(4)
    .max(100)
    .regex(/^[a-z0-9-]+$/i, 'jobId must contain alphanumeric characters and hyphens only'),
});

export const ecostressJobStatusQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const hlsProductIdEnum = z.enum(['HLSL30.002', 'HLSS30.002']);

export const hlsLayerIdEnum = z.enum([
  'B03',
  'B04',
  'B05',
  'B8A',
  'B08',
  'B11',
  'B12',
  'Fmask',
]);

export const hlsJobSubmitBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema
      .refine(
        (range) => range.startDate >= '2013-04-11',
        { message: 'NASA HLS Collection 2 observations start on 2013-04-11.' },
      )
      .refine(
        (range) => {
          const diffDays =
            (Date.parse(`${range.endDate}T00:00:00Z`) -
              Date.parse(`${range.startDate}T00:00:00Z`)) /
            (1000 * 60 * 60 * 24);
          return diffDays <= 366;
        },
        { message: 'NASA HLS extraction dateRange cannot exceed 366 days per task.' },
      ),
    products: z.array(hlsProductIdEnum).min(1).max(2).optional(),
    layers: z.array(hlsLayerIdEnum).min(1).max(10).optional(),
    taskName: z.string().trim().min(1).max(120).optional(),
    outputFormat: z.enum(['geotiff', 'netcdf4']).optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const hlsJobParamsSchema = z.object({
  jobId: z
    .string()
    .trim()
    .min(4)
    .max(100)
    .regex(/^[a-z0-9-]+$/i, 'jobId must contain alphanumeric characters and hyphens only'),
});

export const hlsJobStatusQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const vegetationQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    polygon: z.string().transform(parseJsonPolygonQuery).optional(),
    bbox: z.string().transform(parseJsonOrCsvBboxQuery).optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    products: z.string().optional(),
  })
  .refine(
    (q) =>
      (q.latitude !== undefined && q.longitude !== undefined) ||
      Boolean(q.polygon || q.bbox),
    {
      message: 'Provide latitude & longitude or polygon / bbox.',
    },
  )
  .refine(
    (q) => q.spatialProcessingMode !== 'polygon' || Boolean(q.polygon || q.bbox),
    {
      message: 'spatialProcessingMode "polygon" requires polygon or bbox query parameter.',
    },
  );

export const monitoringThresholdsSchema = z.object({
  staleDaysThreshold: z.number().int().min(1).max(365).optional(),
  minCoveragePercent: z.number().min(0).max(100).optional(),
  minimumTrendObservations: z.number().int().min(2).max(20).optional(),
  minimumTrendSpanDays: z.number().int().min(1).max(180).optional(),
  lowNdviThreshold: z.number().min(-1).max(1).optional(),
  ndviDropDeltaThreshold: z.number().min(0.01).max(2).optional(),
  lowNdwiThreshold: z.number().min(-1).max(1).optional(),
  ndwiDropDeltaThreshold: z.number().min(0.01).max(2).optional(),
  esiStressThreshold: z.number().min(0).max(1).optional(),
  esiModerateThreshold: z.number().min(0).max(1).optional(),
  etSharpDropPercent: z.number().min(5).max(95).optional(),
  crossMissionGapDaysThreshold: z.number().int().min(1).max(120).optional(),
});

export const environmentalAnalyticsBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema.optional(),
    ecostressResult: z.record(z.string(), z.unknown()).nullable().optional(),
    hlsResult: z.record(z.string(), z.unknown()).nullable().optional(),
    thresholds: monitoringThresholdsSchema.optional(),
    autoFetchCompletedResults: z.boolean().optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });

export const farmIntelligenceBodySchema = z
  .object({
    location: coordinatesSchema.optional(),
    boundary: soilBoundaryContextSchema.optional(),
    geometry: geoJsonPolygonSchema.optional(),
    bbox: boundingBoxSchema.optional(),
    spatialProcessingMode: spatialProcessingModeSchema.optional(),
    dateRange: dateRangeSchema.optional(),
    ecostressResult: z.record(z.string(), z.unknown()).nullable().optional(),
    hlsResult: z.record(z.string(), z.unknown()).nullable().optional(),
    weatherTelemetry: z.record(z.string(), z.unknown()).nullable().optional(),
    soilProfile: z.record(z.string(), z.unknown()).nullable().optional(),
    soilMoisture: z.record(z.string(), z.unknown()).nullable().optional(),
    labSoilTest: z.record(z.string(), z.unknown()).nullable().optional(),
    phase4Analytics: z.record(z.string(), z.unknown()).nullable().optional(),
    autoFetchCompletedResults: z.boolean().optional(),
  })
  .refine(hasAnySpatialTarget, {
    message: 'Provide location, boundary, geometry, or bbox.',
  })
  .refine(hasPolygonIfRequired, {
    message: 'spatialProcessingMode "polygon" requires GeoJSON Polygon geometry or bbox.',
  });


