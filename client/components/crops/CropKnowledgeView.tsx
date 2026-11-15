import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, Filter, Loader2, RotateCcw, Search } from 'lucide-react';
import type {
  AgroClimaticRegionsResult,
  CropCatalogFilter,
  CropGrowingSeason,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
  SoilProfile,
  WaterRequirementCategory,
} from '../../../shared/index.ts';
import { apiClient, ApiClientError } from '../../services/apiClient.ts';
import { CropProfileDetail } from './CropProfileDetail.tsx';

interface CropKnowledgeViewProps {
  soilProfile: SoilProfile | null;
  onReturnToMap: () => void;
}

const SEASON_OPTIONS: Array<{ value: CropGrowingSeason | ''; label: string }> = [
  { value: '', label: 'All Seasons' },
  { value: 'Kharif', label: 'Kharif (Monsoon)' },
  { value: 'Rabi', label: 'Rabi (Winter)' },
  { value: 'Zaid', label: 'Zaid' },
  { value: 'Summer', label: 'Summer' },
];

const WATER_OPTIONS: Array<{ value: WaterRequirementCategory | ''; label: string }> = [
  { value: '', label: 'All Water Tiers' },
  { value: 'low', label: 'Low Water (≤ 400–600 mm)' },
  { value: 'moderate', label: 'Moderate Water (450–800 mm)' },
  { value: 'high', label: 'High Water (900+ mm)' },
];

export function CropKnowledgeView({ soilProfile, onReturnToMap }: CropKnowledgeViewProps) {
  const [regionsData, setRegionsData] = useState<AgroClimaticRegionsResult | null>(null);
  const [catalogData, setCatalogData] = useState<CropKnowledgeCatalogResult | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<string>('soybean');

  const [searchInput, setSearchInput] = useState<string>('');
  const [season, setSeason] = useState<CropGrowingSeason | ''>('');
  const [agroClimaticZone, setAgroClimaticZone] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [waterRequirement, setWaterRequirement] = useState<WaterRequirementCategory | ''>('');
  const [nitrogenFixingOnly, setNitrogenFixingOnly] = useState<boolean>(false);
  const [matchActiveSoilPh, setMatchActiveSoilPh] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const activeSoilPh = soilProfile?.surfaceSummary.ph.mean ?? null;

  useEffect(() => {
    let active = true;
    apiClient
      .getCropRegions()
      .then((res) => {
        if (active) {
          setRegionsData(res);
        }
      })
      .catch(() => {
        // Regions dropdown fallback handled gracefully if unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  const currentFilter = useMemo<CropCatalogFilter>(() => {
    const filter: CropCatalogFilter = {};
    const trimmed = searchInput.trim();
    if (trimmed) filter.search = trimmed;
    if (season) filter.season = season;
    if (agroClimaticZone) filter.agroClimaticZone = agroClimaticZone;
    if (stateFilter) filter.state = stateFilter;
    if (waterRequirement) filter.waterRequirement = waterRequirement;
    if (nitrogenFixingOnly) filter.nitrogenFixingOnly = true;
    if (matchActiveSoilPh && activeSoilPh !== null) {
      filter.phTarget = Number(activeSoilPh.toFixed(1));
    }
    return filter;
  }, [
    searchInput,
    season,
    agroClimaticZone,
    stateFilter,
    waterRequirement,
    nitrogenFixingOnly,
    matchActiveSoilPh,
    activeSoilPh,
  ]);

  const fetchCatalog = useCallback(async (filter: CropCatalogFilter) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.searchCropCatalog(filter);
      setCatalogData(result);
      setSelectedCropId((prev) => {
        if (result.crops.some((crop) => crop.id === prev)) {
          return prev;
        }
        return result.crops[0]?.id ?? '';
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to query the ICAR/KVK crop knowledge base.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCatalog(currentFilter);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [currentFilter, fetchCatalog]);

  function handleResetFilters() {
    setSearchInput('');
    setSeason('');
    setAgroClimaticZone('');
    setStateFilter('');
    setWaterRequirement('');
    setNitrogenFixingOnly(false);
    setMatchActiveSoilPh(false);
  }

  const selectedCrop: CropKnowledgeProfile | null = useMemo(() => {
    if (!catalogData || catalogData.crops.length === 0) {
      return null;
    }
    return catalogData.crops.find((c) => c.id === selectedCropId) ?? catalogData.crops[0];
  }, [catalogData, selectedCropId]);

  const activeZoneMeta = useMemo(() => {
    if (!agroClimaticZone || !regionsData) {
      return null;
    }
    return regionsData.zones.find((z) => z.id === agroClimaticZone) ?? null;
  }, [agroClimaticZone, regionsData]);

  const hasActiveFilters = Boolean(
    searchInput.trim() ||
      season ||
      agroClimaticZone ||
      stateFilter ||
      waterRequirement ||
      nitrogenFixingOnly ||
      matchActiveSoilPh,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Header & Knowledge Separation Notice */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              ICAR &amp; KVK Curated Agronomic Reference
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              Indian Crop Knowledge Base
            </h1>
            <p className="mt-1 max-w-3xl text-xs text-slate-600">
              Searchable crop profiles organized by Indian Agro-Climatic Zones and States,
              including per-parameter ICAR/KVK citations, validation status, biological
              nitrogen fixation traits, and crop rotation compatibility.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReturnToMap}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              Return to Map
            </button>
          </div>
        </div>

        {/* Search & Filter Controls */}
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label
              htmlFor="crop-kb-search"
              className="block text-[11px] font-medium text-slate-600"
            >
              Search Crop / Scientific / Local Name
            </label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                id="crop-kb-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="e.g. Soybean, Chana, Bajra, Oryza..."
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="crop-kb-zone"
              className="block text-[11px] font-medium text-slate-600"
            >
              Agro-Climatic Zone
            </label>
            <select
              id="crop-kb-zone"
              value={agroClimaticZone}
              onChange={(e) => setAgroClimaticZone(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All 15 Indian Zones</option>
              {(regionsData?.zones ?? []).map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.zoneNumber}. {zone.shortName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="crop-kb-state"
              className="block text-[11px] font-medium text-slate-600"
            >
              Indian State / UT
            </label>
            <select
              id="crop-kb-state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All States</option>
              {(regionsData?.states ?? []).map((st) => (
                <option key={st.state} value={st.state}>
                  {st.state} ({st.cropCount})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="crop-kb-season"
              className="block text-[11px] font-medium text-slate-600"
            >
              Growing Season
            </label>
            <select
              id="crop-kb-season"
              value={season}
              onChange={(e) => setSeason(e.target.value as CropGrowingSeason | '')}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {SEASON_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="crop-kb-water"
              className="block text-[11px] font-medium text-slate-600"
            >
              Water Requirement
            </label>
            <select
              id="crop-kb-water"
              value={waterRequirement}
              onChange={(e) =>
                setWaterRequirement(e.target.value as WaterRequirementCategory | '')
              }
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {WATER_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Secondary toggles & Filter Summary */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={nitrogenFixingOnly}
                onChange={(e) => setNitrogenFixingOnly(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>Nitrogen-fixing legumes only</span>
            </label>

            {activeSoilPh !== null && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={matchActiveSoilPh}
                  onChange={(e) => setMatchActiveSoilPh(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                <span>
                  Match loaded SoilGrids pH (
                  <span className="font-mono font-semibold tabular-nums">
                    {activeSoilPh.toFixed(1)}
                  </span>
                  )
                </span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3">
            {catalogData && (
              <span className="font-mono text-[11px] tabular-nums text-slate-600">
                Showing {catalogData.filteredCount} of {catalogData.totalCount} ICAR profiles
              </span>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Selected Agro-Climatic Zone Context Summary */}
        {activeZoneMeta && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">
              Zone {activeZoneMeta.zoneNumber}: {activeZoneMeta.name}
            </div>
            <p className="mt-0.5 text-slate-600">{activeZoneMeta.climateSummary}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span>
                <span className="font-medium text-slate-700">States:</span>{' '}
                {activeZoneMeta.statesAndUts.join(', ')}
              </span>
              <span>
                <span className="font-medium text-slate-700">Soils:</span>{' '}
                {activeZoneMeta.typicalSoilOrders.join(', ')}
              </span>
              {activeZoneMeta.annualRainfallMmRange && (
                <span>
                  <span className="font-medium text-slate-700">Annual Rainfall:</span>{' '}
                  <span className="font-mono tabular-nums">
                    {activeZoneMeta.annualRainfallMmRange[0]}–
                    {activeZoneMeta.annualRainfallMmRange[1]} mm
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Error State */}
      {error && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchCatalog(currentFilter)}
            className="rounded border border-rose-300 bg-white px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-100 cursor-pointer"
          >
            Retry
          </button>
        </section>
      )}

      {/* Loading State */}
      {loading && !catalogData && (
        <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-12 text-xs text-slate-600">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
          Loading ICAR &amp; KVK crop profiles…
        </div>
      )}

      {/* Empty Search Result */}
      {!loading && catalogData && catalogData.crops.length === 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <Filter className="mx-auto h-6 w-6 text-slate-400" />
          <h2 className="mt-2 text-sm font-semibold text-slate-900">
            No crop profiles match your current filters
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Try clearing one or more agro-climatic zone, state, season, or pH filters to
            inspect all documented ICAR crop profiles.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-4 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer"
          >
            Show All Crop Profiles
          </button>
        </section>
      )}

      {/* Master-Detail Knowledge Base Workspace */}
      {catalogData && catalogData.crops.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
          {/* Crop List Rail */}
          <aside aria-label="Crop knowledge directory" className="space-y-2">
            {catalogData.crops.map((crop) => {
              const isSelected = selectedCrop?.id === crop.id;
              const water = crop.waterRequirements.value;
              const duration = crop.growingDuration.value;
              const fixesN = crop.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen;

              return (
                <button
                  key={crop.id}
                  type="button"
                  onClick={() => setSelectedCropId(crop.id)}
                  className={`w-full rounded-lg border p-3.5 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {crop.cropName}
                      </div>
                      <div className="text-[11px] italic text-slate-500">
                        {crop.scientificName}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500">
                      {crop.cropGroup}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                    <span>{(crop.growingSeasons.value ?? []).join(' / ')}</span>
                    {water && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono tabular-nums">
                          {water.seasonalMinMm}–{water.seasonalMaxMm} mm
                        </span>
                      </>
                    )}
                    {duration && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono tabular-nums">
                          {duration.minDays}–{duration.maxDays} d
                        </span>
                      </>
                    )}
                  </div>

                  {fixesN && (
                    <div className="mt-1.5 text-[11px] font-medium text-emerald-700">
                      Symbiotic N-Fixing Legume
                    </div>
                  )}
                </button>
              );
            })}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                <BookOpen className="h-3.5 w-3.5 text-slate-500" />
                Source Attribution
              </div>
              <p className="mt-1">{catalogData.dataAttribution}</p>
            </div>
          </aside>

          {/* Selected Crop Full Dossier */}
          <div className="min-w-0">
            {selectedCrop && (
              <CropProfileDetail
                crop={selectedCrop}
                selectedStateFilter={stateFilter || undefined}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
