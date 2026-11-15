import type {
  GeoCoordinates,
  LocationCandidate,
  LocationContext,
  LocationResolveRequest,
  RegionSummary,
} from '../../../shared/index.ts';
import { ExternalServiceError, NotFoundError, ServiceNotImplementedError } from '../../errors/AppError.ts';
import type { ILocationRepository } from '../interfaces/index.ts';

interface NominatimSearchItem {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  boundingbox?: [string, string, string, string];
  address?: {
    country_code?: string;
    state?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
  };
}

interface NominatimReverseItem {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    country_code?: string;
    state?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
  };
}

export type FetchLike = typeof fetch;

const COORDINATE_PAIR_REGEX = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseCoordinateQuery(query: string): GeoCoordinates | null {
  const match = COORDINATE_PAIR_REGEX.exec(query);
  if (!match) {
    return null;
  }
  const latitude = Number.parseFloat(match[1]);
  const longitude = Number.parseFloat(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function formatRegionLabel(address?: NominatimSearchItem['address'], fallback?: string): string | undefined {
  if (address) {
    const locality = address.city || address.town || address.village || address.county;
    if (locality && address.state) {
      return `${locality}, ${address.state}`;
    }
    if (locality) {
      return locality;
    }
    if (address.state) {
      return address.state;
    }
  }
  return fallback;
}

export class NominatimLocationRepository implements ILocationRepository {
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;

  constructor(fetchFn: FetchLike = fetch, baseUrl = 'https://nominatim.openstreetmap.org') {
    this.fetchFn = fetchFn;
    this.baseUrl = baseUrl;
  }

  async resolveLocation(request: LocationResolveRequest): Promise<LocationContext> {
    if (request.coordinates) {
      return this.reverseLookup(request.coordinates);
    }

    const query = request.query?.trim() ?? '';
    const directCoords = parseCoordinateQuery(query);
    if (directCoords) {
      return this.reverseLookup(directCoords);
    }

    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        headers: {
          'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new ExternalServiceError('Failed to reach geocoding service.', {
        reason: error instanceof Error ? error.message : 'Network error',
      });
    }

    if (!response.ok) {
      throw new ExternalServiceError('Geocoding service returned an error response.', {
        upstreamStatus: response.status,
      });
    }

    const items = (await response.json()) as NominatimSearchItem[];
    if (!Array.isArray(items) || items.length === 0) {
      throw new NotFoundError(`No geographic location found for "${query}".`);
    }

    const candidates: LocationCandidate[] = items.map((item) => {
      const bbox =
        item.boundingbox && item.boundingbox.length === 4
          ? ([
              Number.parseFloat(item.boundingbox[0]),
              Number.parseFloat(item.boundingbox[1]),
              Number.parseFloat(item.boundingbox[2]),
              Number.parseFloat(item.boundingbox[3]),
            ] as [number, number, number, number])
          : undefined;

      return {
        displayName: item.display_name,
        coordinates: {
          latitude: Number.parseFloat(item.lat),
          longitude: Number.parseFloat(item.lon),
        },
        countryCode: item.address?.country_code?.toUpperCase(),
        regionName: formatRegionLabel(item.address, item.display_name),
        type: item.type,
        boundingBox: bbox,
      };
    });

    const primary = candidates[0];
    return {
      coordinates: primary.coordinates,
      regionName: primary.regionName ?? primary.displayName,
      countryCode: primary.countryCode,
      source: 'OpenStreetMap Nominatim',
      candidates,
    };
  }

  private async reverseLookup(coordinates: GeoCoordinates): Promise<LocationContext> {
    const url = new URL('/reverse', this.baseUrl);
    url.searchParams.set('lat', String(coordinates.latitude));
    url.searchParams.set('lon', String(coordinates.longitude));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');

    try {
      const response = await this.fetchFn(url.toString(), {
        headers: {
          'User-Agent': 'FieldShift-AI/0.1.0 (NASA Space Apps 2026)',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return {
          coordinates,
          source: 'Coordinate Input',
        };
      }

      const item = (await response.json()) as NominatimReverseItem;
      const regionName = formatRegionLabel(item.address, item.display_name);
      return {
        coordinates,
        regionName,
        countryCode: item.address?.country_code?.toUpperCase(),
        source: 'OpenStreetMap Nominatim',
        candidates: regionName
          ? [
              {
                displayName: item.display_name || regionName,
                coordinates,
                countryCode: item.address?.country_code?.toUpperCase(),
                regionName,
              },
            ]
          : undefined,
      };
    } catch {
      return {
        coordinates,
        source: 'Coordinate Input',
      };
    }
  }

  async listRegions(): Promise<RegionSummary[]> {
    throw new ServiceNotImplementedError('LocationRepository', 'listRegions');
  }
}
