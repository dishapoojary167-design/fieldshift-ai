import { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Droplets,
  Satellite,
  Sprout,
} from 'lucide-react';
import type { CropSuitabilityOption } from '../../../shared/index.ts';
import { buildCardEnvironmentalEvidence } from '../environmental/environmentalUtils.ts';

export { buildCardEnvironmentalEvidence };

interface CropRecommendationCardProps {
  crop: CropSuitabilityOption;
  isSelected: boolean;
  onSelectForChart: (cropId: string) => void;
  onOpenProfile: (crop: CropSuitabilityOption) => void;
}

function getCategoryAccent(category: CropSuitabilityOption['suitabilityCategory']): string {
  switch (category) {
    case 'Highly Suitable':
      return 'text-emerald-700';
    case 'Moderately Suitable':
      return 'text-sky-700';
    case 'Marginally Suitable':
      return 'text-amber-700';
    case 'Unsuitable':
      return 'text-rose-700';
    case 'Insufficient Data':
      return 'text-slate-600';
  }
}

function getScoreTextColor(score: number): string {
  if (score >= 78) return 'text-emerald-700';
  if (score >= 60) return 'text-sky-700';
  if (score >= 40) return 'text-amber-700';
  return 'text-rose-700';
}

export function CropRecommendationCard({
  crop,
  isSelected,
  onSelectForChart,
  onOpenProfile,
}: CropRecommendationCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const topAdvantage = crop.advantages[0] ?? 'Aligned with regional crop calendar.';
  const topLimitation = crop.limitations[0] ?? null;
  const evaluatedFactorsCount = crop.factorScores.filter((f) => f.status === 'evaluated').length;
  const keyObservations = crop.supportingObservations
    .filter((o) => o.status === 'available')
    .slice(0, 3);
  const sourceNames = Array.from(
    new Set((crop.dataSourcesUsed ?? []).map((s) => s.name)),
  );
  const uncertainCount = crop.missingOrUncertainInputs?.length ?? crop.missingDataWarnings.length;
  const firstUncertain =
    crop.missingOrUncertainInputs?.[0] ?? crop.missingDataWarnings[0] ?? null;

  const evidence = buildCardEnvironmentalEvidence(crop);
  const availableSatCount = evidence.satelliteItems.filter((i) => i.status === 'available').length;

  return (
    <article
      onClick={() => onSelectForChart(crop.cropId)}
      className={`flex flex-col justify-between rounded-lg border bg-white p-4 transition-colors cursor-pointer ${
        isSelected
          ? 'border-blue-600 ring-1 ring-blue-600/20'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div>
        {/* Top Row: Rank + Crop Title + Score */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className="font-mono font-semibold text-slate-800">
                #{crop.rank ?? '—'}
              </span>
              <span>·</span>
              <span>{crop.cropGroup}</span>
              <span>·</span>
              <span className={getCategoryAccent(crop.suitabilityCategory)}>
                {crop.suitabilityCategory}
              </span>
            </div>
            <h3 className="mt-1 text-base font-semibold text-slate-900 truncate">
              {crop.cropName}
            </h3>
            <p className="text-[11px] italic text-slate-500 truncate">
              {crop.scientificName}
            </p>
          </div>

          <div className="shrink-0 text-right font-mono tabular-nums">
            <div className={`text-2xl font-bold leading-none ${getScoreTextColor(crop.suitabilityScore)}`}>
              {crop.suitabilityScore}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">/ 100 fit</div>
          </div>
        </div>

        {/* Confidence & Score Bar */}
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all ${
                crop.suitabilityScore >= 78
                  ? 'bg-emerald-600'
                  : crop.suitabilityScore >= 60
                    ? 'bg-sky-600'
                    : crop.suitabilityScore >= 40
                      ? 'bg-amber-500'
                      : 'bg-rose-600'
              }`}
              style={{ width: `${Math.max(4, Math.min(100, crop.suitabilityScore))}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600">
            <span>
              Confidence:{' '}
              <span className="font-mono font-medium tabular-nums text-slate-800">
                {crop.dataConfidence.score}%
              </span>{' '}
              ({crop.dataConfidence.level})
            </span>
            <span className="font-mono text-[10px] text-slate-600 tabular-nums">
              {evaluatedFactorsCount}/{crop.factorScores.length} factors
            </span>
          </div>
        </div>

        {/* Structured Agronomic Indicators */}
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-700">
          <div className="flex items-start gap-2">
            <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              <span className="font-medium text-slate-800">Season:</span>{' '}
              {crop.seasonalSuitability.sowingWindow
                ? `${crop.growingSeasons.join('/')} · Sow ${crop.seasonalSuitability.sowingWindow}`
                : crop.growingSeasons.join(' / ')}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Droplets className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              <span className="font-medium text-slate-800">Water:</span>{' '}
              <span className="capitalize">{crop.waterRequirementDetail.category}</span>
              {crop.waterRequirementDetail.seasonalMinMm !== null &&
              crop.waterRequirementDetail.seasonalMaxMm !== null
                ? ` (${crop.waterRequirementDetail.seasonalMinMm}–${crop.waterRequirementDetail.seasonalMaxMm} mm)`
                : ''}{' '}
              · Rainfed: <span className="capitalize">{crop.waterRequirementDetail.rainfedViability}</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Sprout className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="line-clamp-2">
              <span className="font-medium text-slate-800">Soil Fit:</span>{' '}
              {crop.soilCompatibility.phFit}
            </span>
          </div>
        </div>

        {/* Supporting Observations & Data Sources Snapshot */}
        <div className="mt-2.5 border-t border-slate-100 pt-2.5 text-[11px] space-y-1">
          {keyObservations.length > 0 && (
            <div className="text-slate-600 line-clamp-2">
              <span className="font-semibold text-slate-700">Observations:</span>{' '}
              <span className="font-mono tabular-nums">
                {keyObservations.map((o) => `${o.label.split(' ')[0]} ${o.observedValue}`).join(' · ')}
              </span>
            </div>
          )}
          {sourceNames.length > 0 && (
            <div className="text-slate-500 truncate">
              <span className="font-semibold text-slate-700">Sources:</span>{' '}
              {sourceNames.join(', ')}
            </div>
          )}
        </div>

        {/* Collapsible Environmental Evidence Section (ECOSTRESS ET/ESI & Landsat/HLS NDVI/NDWI) */}
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            aria-expanded={evidenceOpen}
            onClick={(e) => {
              e.stopPropagation();
              setEvidenceOpen((prev) => !prev);
            }}
            className="flex w-full items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Satellite className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
              <span>
                Environmental Evidence{' '}
                <span className="font-mono text-[10px] text-slate-500">
                  ({availableSatCount}/4 NASA sat.)
                </span>
              </span>
            </span>
            {evidenceOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            )}
          </button>

          {evidenceOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-2 space-y-2 rounded border border-slate-200 bg-slate-50/50 p-2.5 text-[11px]"
            >
              <div className="grid grid-cols-2 gap-2">
                {evidence.satelliteItems.map((item) => (
                  <div
                    key={item.parameter}
                    className="rounded border border-slate-200 bg-white p-2"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-slate-700 truncate">{item.label}</span>
                      <span
                        className={`font-mono text-[10px] uppercase shrink-0 ${
                          item.status === 'available' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {item.status === 'available' ? 'OK' : 'N/A'}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 truncate">
                      {item.observedValue}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500 truncate">
                      {item.sourceLabel}
                    </div>
                    {(item.observationTimestamp || item.spatialResolution) && (
                      <div className="mt-0.5 font-mono tabular-nums text-[10px] text-slate-400 truncate">
                        {[item.observationTimestamp, item.spatialResolution].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {evidence.warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900 space-y-0.5">
                  <div className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3 w-3 text-amber-700 shrink-0" aria-hidden="true" />
                    Data Quality &amp; Missing-Data Warnings
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                    {evidence.warnings.slice(0, 4).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evidence.sources.length > 0 && (
                <div className="border-t border-slate-200 pt-1.5 text-[10px] text-slate-600">
                  <span className="font-semibold text-slate-700">NASA &amp; Ground Attribution:</span>{' '}
                  {evidence.sources
                    .map(
                      (s) =>
                        `${s.name} (${s.spatialResolution}${s.observationDate ? `, ${s.observationDate}` : ''})`,
                    )
                    .join(' · ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preference Alignment Notes (if any) */}
        {crop.preferenceAdjustments.length > 0 && (
          <div className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
            {crop.preferenceAdjustments.map((adj, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{adj.factor}</span>
                <span
                  className={`font-mono font-semibold tabular-nums shrink-0 ${
                    adj.delta >= 0 ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {adj.delta >= 0 ? `+${adj.delta}` : adj.delta} pts
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Advantage, Limitations & Missing/Uncertain Inputs Preview */}
        <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2.5 text-[11px]">
          <p className="line-clamp-2 text-emerald-800">
            <span className="font-semibold">Driver:</span> {topAdvantage}
          </p>
          {topLimitation && (
            <p className="line-clamp-2 text-amber-800">
              <span className="font-semibold">Limitation:</span> {topLimitation}
            </p>
          )}
          {uncertainCount > 0 && firstUncertain && (
            <p className="line-clamp-1 text-slate-600">
              <span className="font-semibold">Uncertain ({uncertainCount}):</span> {firstUncertain}
            </p>
          )}
        </div>
      </div>

      {/* Footer CTA */}
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-[11px] text-slate-500">
          {isSelected ? 'Showing in factor chart' : 'Click card to chart'}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile(crop);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 cursor-pointer whitespace-nowrap"
        >
          Inspect Profile
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
