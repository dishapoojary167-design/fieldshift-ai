import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_REGIONS } from '../../shared/constants/regions.ts';
import type {
  CropCalendarEntry,
  CropProfile,
  RegionalKnowledgeBundle,
  RegionalSoilZone,
  RegionDescriptor,
  RotationRule,
} from '../../shared/types/index.ts';
import { NotFoundError } from '../utils/errors.ts';

interface RegionDatasetMapping {
  cropsFile: string;
  calendarsFile: string;
  soilZonesFile: string;
  rotationRulesFile: string;
}

const REGION_DATASET_MAPPINGS: Record<string, RegionDatasetMapping> = {
  'IN:IN-MH': {
    cropsFile: 'crops/maharashtra.crops.json',
    calendarsFile: 'crop-calendars/maharashtra.calendars.json',
    soilZonesFile: 'soil/maharashtra.zones.json',
    rotationRulesFile: 'rotation-rules/maharashtra.rules.json',
  },
};

export class KnowledgeRepository {
  private readonly dataRootDir: string;
  private readonly bundleCache = new Map<string, RegionalKnowledgeBundle>();

  constructor(dataRootDir?: string) {
    if (dataRootDir) {
      this.dataRootDir = dataRootDir;
    } else {
      const currentFile = fileURLToPath(import.meta.url);
      this.dataRootDir = path.resolve(path.dirname(currentFile), '../../data');
    }
  }

  listSupportedRegions(): RegionDescriptor[] {
    return SUPPORTED_REGIONS;
  }

  getConfiguredRegionCount(): number {
    return Object.keys(REGION_DATASET_MAPPINGS).length;
  }

  async loadRegionBundle(
    countryCode: string,
    regionCode: string,
  ): Promise<RegionalKnowledgeBundle> {
    const normalizedCountry = countryCode.toUpperCase();
    const normalizedRegion = regionCode.toUpperCase();
    const cacheKey = `${normalizedCountry}:${normalizedRegion}`;

    const cached = this.bundleCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const region = SUPPORTED_REGIONS.find(
      (item) =>
        item.countryCode.toUpperCase() === normalizedCountry &&
        item.regionCode.toUpperCase() === normalizedRegion,
    );

    const mapping = REGION_DATASET_MAPPINGS[cacheKey];
    if (!region || !mapping) {
      throw new NotFoundError(
        `No agricultural knowledge dataset registered for ${normalizedCountry}/${normalizedRegion}`,
      );
    }

    const [crops, calendars, soilZones, rotationRules] = await Promise.all([
      this.readJsonFile<CropProfile[]>(mapping.cropsFile),
      this.readJsonFile<CropCalendarEntry[]>(mapping.calendarsFile),
      this.readJsonFile<RegionalSoilZone[]>(mapping.soilZonesFile),
      this.readJsonFile<RotationRule[]>(mapping.rotationRulesFile),
    ]);

    const bundle: RegionalKnowledgeBundle = {
      region,
      crops,
      calendars,
      soilZones,
      rotationRules,
    };

    this.bundleCache.set(cacheKey, bundle);
    return bundle;
  }

  private async readJsonFile<T>(relativePath: string): Promise<T> {
    const fullPath = path.join(this.dataRootDir, relativePath);
    const raw = await fs.readFile(fullPath, 'utf-8');
    return JSON.parse(raw) as T;
  }
}
