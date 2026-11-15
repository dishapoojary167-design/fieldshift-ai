import {
  calculateAreaHectaresFromGeoJsonPolygon,
  calculateBoundingBoxCenter,
  calculateBoundingBoxFromGeoJsonPolygon,
  calculateCentroidFromGeoJsonPolygon,
  countGeoJsonPolygonVertices,
  type BoundingBox,
  type GeoCoordinates,
  type GeoJsonPolygon,
  type SoilBoundaryContext,
  type SpatialProcessingMetadata,
  type SpatialProcessingMode,
} from '../../shared/index.ts';
import { PolygonProcessingUnsupportedError, ValidationError } from '../errors/AppError.ts';

export interface SpatialProviderOptions {
  boundary?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  spatialProcessingMode?: SpatialProcessingMode;
}

export interface ResolvedSpatialContext {
  targetLocation: GeoCoordinates;
  boundaryContext?: SoilBoundaryContext;
  geometry?: GeoJsonPolygon;
  bbox?: BoundingBox;
  requestedMode: SpatialProcessingMode;
  spatialProcessing: SpatialProcessingMetadata;
}

export function resolveSpatialRequestContext(
  input: {
    location?: GeoCoordinates;
    boundary?: SoilBoundaryContext;
    geometry?: GeoJsonPolygon;
    bbox?: BoundingBox;
    spatialProcessingMode?: SpatialProcessingMode;
  },
  stageLabel = 'spatial telemetry lookup',
  options?: { allowPolygonMode?: boolean },
): ResolvedSpatialContext {
  const geometry = input.boundary?.geometry ?? input.geometry;
  const bbox =
    input.boundary?.bbox ??
    input.bbox ??
    (geometry ? calculateBoundingBoxFromGeoJsonPolygon(geometry) : undefined);

  const requestedMode: SpatialProcessingMode = input.spatialProcessingMode ?? 'auto';

  if (requestedMode === 'polygon') {
    if (!geometry && !bbox) {
      throw new ValidationError(
        'Polygon processing was requested (spatialProcessingMode: "polygon"), but no GeoJSON Polygon geometry or bounding box was provided.',
      );
    }
    if (!options?.allowPolygonMode) {
      throw new PolygonProcessingUnsupportedError(stageLabel, {
        requestedMode,
        hasPolygonGeometry: Boolean(geometry),
        hasBoundingBox: Boolean(bbox),
        ...(geometry ? { vertexCount: countGeoJsonPolygonVertices(geometry) } : {}),
      });
    }
  }

  const derivedLocation =
    input.boundary?.centroid ??
    input.location ??
    (geometry
      ? calculateCentroidFromGeoJsonPolygon(geometry)
      : bbox
        ? calculateBoundingBoxCenter(bbox)
        : undefined);

  if (!derivedLocation) {
    throw new ValidationError(
      'Unable to resolve target farm coordinates from location, boundary, geometry, or bbox.',
    );
  }

  let boundaryContext: SoilBoundaryContext | undefined = input.boundary;
  if (input.boundary) {
    boundaryContext = {
      ...input.boundary,
      ...(geometry ? { geometry } : {}),
      ...(bbox ? { bbox } : {}),
    };
  } else if (geometry || bbox) {
    boundaryContext = {
      id: 'custom-polygon',
      name: 'Selected Farm Boundary',
      areaHectares: geometry ? calculateAreaHectaresFromGeoJsonPolygon(geometry) : 0,
      centroid: geometry
        ? calculateCentroidFromGeoJsonPolygon(geometry)
        : calculateBoundingBoxCenter(bbox!),
      ...(geometry ? { geometry } : {}),
      ...(bbox ? { bbox } : {}),
    };
  }

  const hasBoundaryOrGeom = Boolean(boundaryContext);
  const appliedMode: SpatialProcessingMetadata['appliedMode'] =
    requestedMode === 'polygon' && options?.allowPolygonMode
      ? 'polygon'
      : hasBoundaryOrGeom
        ? 'centroid'
        : 'point';

  const vertexCount = geometry ? countGeoJsonPolygonVertices(geometry) : undefined;

  const spatialProcessing: SpatialProcessingMetadata = {
    requestedMode,
    appliedMode,
    hasPolygonGeometry: Boolean(geometry),
    hasBoundingBox: Boolean(bbox),
    ...(vertexCount !== undefined ? { vertexCount } : {}),
    note:
      appliedMode === 'polygon'
        ? `Polygon raster statistics mode active (${vertexCount ?? 'bbox'} vertices); high-res satellite payloads are analyzed at parcel polygon scale.`
        : geometry
          ? `Full GeoJSON polygon (${vertexCount} vertices${bbox ? ' + bounding box' : ''}) preserved; current point/grid providers sample at farm centroid without polygon zonal averaging.`
          : bbox
            ? 'Bounding box preserved; current point/grid providers sample at parcel centroid/center.'
            : 'Point/centroid sampling executed.',
  };

  return {
    targetLocation: derivedLocation,
    boundaryContext,
    geometry,
    bbox,
    requestedMode,
    spatialProcessing,
  };
}

export function assertCentroidSamplingSupported(
  options: SpatialProviderOptions | undefined,
  providerName: string,
): void {
  if (options?.spatialProcessingMode === 'polygon') {
    const hasGeom = Boolean(options.boundary?.geometry ?? options.geometry);
    const hasBbox = Boolean(options.boundary?.bbox ?? options.bbox);
    if (!hasGeom && !hasBbox) {
      throw new ValidationError(
        `Polygon processing was requested for ${providerName}, but no GeoJSON Polygon geometry or bounding box was provided.`,
      );
    }
    throw new PolygonProcessingUnsupportedError(providerName, {
      hasPolygonGeometry: hasGeom,
      hasBoundingBox: hasBbox,
    });
  }
}
