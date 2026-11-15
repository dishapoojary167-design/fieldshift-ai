import type {
  GeoCoordinates,
  SoilDepthLayer,
  SoilSourceAttribution,
} from '../../shared/index.ts';
import type { SpatialProviderOptions } from '../utils/spatialRequest.ts';

export interface SoilGridsProviderResult {
  status: 'available' | 'partial' | 'unavailable';
  providerUsed: 'soilgrids-rest-v2' | 'soilgrids-wcs-fallback' | 'none';
  fallbackUsed: boolean;
  fallbackReason?: string;
  depthLayers: SoilDepthLayer[];
  sourceAttribution: SoilSourceAttribution;
  caveats: string[];
}

/**
 * Replaceable provider interface for ISRIC SoilGrids soil properties
 * (REST v2.0, OGC WCS fallback, or prepared soil reference providers).
 */
export interface ISoilGridsProvider {
  readonly providerId: string;
  fetchDepthProfile(
    location: GeoCoordinates,
    options?: SpatialProviderOptions,
  ): Promise<SoilGridsProviderResult>;
}
