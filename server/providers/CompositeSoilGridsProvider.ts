import type { GeoCoordinates } from '../../shared/index.ts';
import { PolygonProcessingUnsupportedError } from '../errors/AppError.ts';
import {
  assertCentroidSamplingSupported,
  type SpatialProviderOptions,
} from '../utils/spatialRequest.ts';
import type { ISoilGridsProvider, SoilGridsProviderResult } from './ISoilGridsProvider.ts';
import { SoilGridsRestProvider } from './SoilGridsRestProvider.ts';
import { SoilGridsWcsProvider } from './SoilGridsWcsProvider.ts';
import { createEmptyDepthLayer, SOILGRIDS_DEPTHS } from './soilGridsShared.ts';

export interface CompositeSoilGridsProviderOptions {
  primaryProvider?: ISoilGridsProvider;
  fallbackProvider?: ISoilGridsProvider;
}

/**
 * Coordinates ISRIC SoilGrids REST v2.0 as the primary source with automatic failover
 * to ISRIC OGC WCS 2.0.1 GeoTIFF services if REST is throttled, slow, or offline.
 * Never fabricates soil values if both upstream providers fail.
 */
export class CompositeSoilGridsProvider implements ISoilGridsProvider {
  public readonly providerId = 'soilgrids-composite';
  private readonly primaryProvider: ISoilGridsProvider;
  private readonly fallbackProvider: ISoilGridsProvider;

  constructor(options: CompositeSoilGridsProviderOptions = {}) {
    this.primaryProvider = options.primaryProvider ?? new SoilGridsRestProvider();
    this.fallbackProvider = options.fallbackProvider ?? new SoilGridsWcsProvider();
  }

  async fetchDepthProfile(
    location: GeoCoordinates,
    options?: SpatialProviderOptions,
  ): Promise<SoilGridsProviderResult> {
    assertCentroidSamplingSupported(options, this.providerId);

    let primaryFailureReason: string | undefined;

    try {
      const primaryResult = await this.primaryProvider.fetchDepthProfile(location, options);
      if (primaryResult.status !== 'unavailable') {
        return primaryResult;
      }
      primaryFailureReason = primaryResult.caveats[0] ?? 'Primary SoilGrids REST returned no soil data.';
    } catch (error) {
      if (error instanceof PolygonProcessingUnsupportedError) {
        throw error;
      }
      primaryFailureReason =
        error instanceof Error
          ? error.message
          : 'ISRIC SoilGrids REST v2.0 endpoint did not respond.';
    }

    try {
      const fallbackResult = await this.fallbackProvider.fetchDepthProfile(location, options);
      return {
        ...fallbackResult,
        fallbackUsed: true,
        fallbackReason: `Primary SoilGrids REST fallback triggered: ${primaryFailureReason}`,
      };
    } catch (fallbackError) {
      if (fallbackError instanceof PolygonProcessingUnsupportedError) {
        throw fallbackError;
      }
      const fallbackMsg =
        fallbackError instanceof Error ? fallbackError.message : 'WCS fallback unavailable.';

      return {
        status: 'unavailable',
        providerUsed: 'none',
        fallbackUsed: true,
        fallbackReason: `REST failed (${primaryFailureReason}); WCS fallback failed (${fallbackMsg}).`,
        depthLayers: SOILGRIDS_DEPTHS.map((d) =>
          createEmptyDepthLayer(d.interval, d.topCm, d.bottomCm),
        ),
        sourceAttribution: {
          id: 'isric-soilgrids-unavailable',
          name: 'ISRIC SoilGrids v2.0',
          attribution: 'ISRIC — World Soil Information (SoilGrids 250 m v2.0)',
          url: 'https://www.isric.org/explore/soilgrids',
          cached: false,
          retrievedAt: new Date().toISOString(),
        },
        caveats: [
          'ISRIC SoilGrids REST v2.0 and OGC WCS services are both currently unavailable for this coordinate.',
          'No modelled soil values were fabricated. Enter laboratory soil-test measurements or retry shortly.',
        ],
      };
    }
  }
}
