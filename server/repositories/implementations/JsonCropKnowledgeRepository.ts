import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgroClimaticRegionsResult,
  CropCatalogFilter,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
  IndianAgroClimaticZone,
} from '../../../shared/index.ts';
import type { ICropKnowledgeRepository } from '../interfaces/ICropKnowledgeRepository.ts';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CROPS_DATA_PATH = resolve(CURRENT_DIR, '../../../data/crop-knowledge-base.json');
const DEFAULT_ZONES_DATA_PATH = resolve(
  CURRENT_DIR,
  '../../../data/indian-agro-climatic-zones.json',
);

export interface JsonCropKnowledgeRepositoryOptions {
  cropsDataPath?: string;
  zonesDataPath?: string;
}

export class JsonCropKnowledgeRepository implements ICropKnowledgeRepository {
  private readonly crops: CropKnowledgeProfile[];
  private readonly zones: IndianAgroClimaticZone[];

  constructor(options: JsonCropKnowledgeRepositoryOptions = {}) {
    const cropsPath = options.cropsDataPath ?? DEFAULT_CROPS_DATA_PATH;
    const zonesPath = options.zonesDataPath ?? DEFAULT_ZONES_DATA_PATH;

    this.crops = JSON.parse(readFileSync(cropsPath, 'utf-8')) as CropKnowledgeProfile[];
    this.zones = JSON.parse(readFileSync(zonesPath, 'utf-8')) as IndianAgroClimaticZone[];
  }

  async searchCrops(filter: CropCatalogFilter): Promise<CropKnowledgeCatalogResult> {
    const normalizedSearch = filter.search?.trim().toLowerCase();
    const zoneFilter = (filter.agroClimaticZone ?? filter.climateZone)?.trim().toLowerCase();
    const stateFilter = filter.state?.trim().toLowerCase();
    const familyFilter = filter.cropFamily?.trim().toLowerCase();
    const textureFilter = filter.soilTexture?.trim().toLowerCase();

    const matched = this.crops.filter((crop) => {
      if (normalizedSearch) {
        const haystack = [
          crop.id,
          crop.cropName,
          crop.scientificName,
          crop.cropFamily,
          crop.cropGroup,
          ...crop.localNames,
          ...(crop.regionalSuitability.value ?? []).flatMap((entry) => [
            entry.agroClimaticZoneName,
            ...entry.states,
          ]),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      if (filter.season) {
        const seasons = crop.growingSeasons.value ?? [];
        if (!seasons.includes(filter.season)) {
          return false;
        }
      }

      if (zoneFilter) {
        const regions = crop.regionalSuitability.value ?? [];
        const hasZone = regions.some(
          (entry) =>
            entry.agroClimaticZoneId.toLowerCase() === zoneFilter ||
            entry.agroClimaticZoneName.toLowerCase().includes(zoneFilter),
        );
        if (!hasZone) {
          return false;
        }
      }

      if (stateFilter) {
        const regions = crop.regionalSuitability.value ?? [];
        const hasState = regions.some((entry) =>
          entry.states.some((s) => s.toLowerCase() === stateFilter || s.toLowerCase().includes(stateFilter)),
        );
        if (!hasState) {
          return false;
        }
      }

      if (familyFilter && crop.cropFamily.toLowerCase() !== familyFilter) {
        return false;
      }

      if (filter.waterRequirement) {
        if (crop.waterRequirements.value?.category !== filter.waterRequirement) {
          return false;
        }
      }

      if (filter.nitrogenFixingOnly) {
        if (!crop.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen) {
          return false;
        }
      }

      if (textureFilter) {
        const textures = crop.soilPreferences.value?.preferredTextures ?? [];
        if (!textures.some((t) => t.toLowerCase().includes(textureFilter))) {
          return false;
        }
      }

      if (filter.phTarget !== undefined) {
        const soilPref = crop.soilPreferences.value;
        if (!soilPref || filter.phTarget < soilPref.phMin || filter.phTarget > soilPref.phMax) {
          return false;
        }
      }

      return true;
    });

    return {
      totalCount: this.crops.length,
      filteredCount: matched.length,
      appliedFilter: filter,
      crops: matched,
      knowledgeSeparationNotice:
        'This endpoint serves curated ICAR/KVK agronomic crop profiles only and does not compute farm-specific suitability scores or recommendations.',
      dataAttribution:
        'Curated from ICAR Crop Research Institutes (IISR, IIPR, IIWBR, IIMR, NRRI, DGR, DRMR), AICRP Zonal Advisories, and Krishi Vigyan Kendra (KVK) packages of practices.',
    };
  }

  async getCropById(cropId: string): Promise<CropKnowledgeProfile | null> {
    const normalizedId = cropId.trim().toLowerCase();
    return this.crops.find((crop) => crop.id.toLowerCase() === normalizedId) ?? null;
  }

  async getAgroClimaticRegions(): Promise<AgroClimaticRegionsResult> {
    const stateMap = new Map<string, Set<string>>();

    for (const zone of this.zones) {
      for (const state of zone.statesAndUts) {
        const set = stateMap.get(state) ?? new Set<string>();
        set.add(zone.id);
        stateMap.set(state, set);
      }
    }

    const states = Array.from(stateMap.entries())
      .map(([state, zoneIds]) => {
        const cropCount = this.crops.filter((crop) =>
          (crop.regionalSuitability.value ?? []).some((entry) =>
            entry.states.some((s) => s.toLowerCase() === state.toLowerCase()),
          ),
        ).length;

        return {
          state,
          agroClimaticZoneIds: Array.from(zoneIds).sort(),
          cropCount,
        };
      })
      .sort((a, b) => a.state.localeCompare(b.state));

    return {
      zones: this.zones,
      states,
      sourceAttribution:
        'ICAR-IASRI & Planning Commission of India 15 Agro-Climatic Regions classification cross-referenced with ICAR/KVK crop advisories.',
    };
  }
}
