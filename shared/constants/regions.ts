import type { RegionDescriptor } from '../types/farm.ts';

export const DEFAULT_COUNTRY_CODE = 'IN';
export const DEFAULT_REGION_CODE = 'IN-MH';

export const SUPPORTED_REGIONS: RegionDescriptor[] = [
  {
    countryCode: 'IN',
    countryName: 'India',
    regionCode: 'IN-MH',
    regionName: 'Maharashtra',
    center: {
      latitude: 19.7515,
      longitude: 75.7139,
    },
    bbox: {
      west: 72.6,
      south: 15.6,
      east: 80.9,
      north: 22.1,
    },
    defaultZoom: 6,
    agroClimaticZones: [
      'South Konkan Coastal',
      'North Konkan Coastal',
      'Western Ghat',
      'Sub-Montane',
      'Western Maharashtra Plain',
      'Scarcity Zone',
      'Central Maharashtra Plateau',
      'Central Vidarbha',
      'Eastern Vidarbha',
    ],
    primarySeasons: ['kharif', 'rabi', 'zaid'],
    climateSummary:
      'Tropical monsoon climate with sharp rainfall gradients from Konkan coast and Western Ghats to the semi-arid Deccan plateau and Vidarbha plains.',
    isDefaultDemo: true,
  },
];
