import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Droplets,
  Info,
  Loader2,
  ShieldAlert,
  Sprout,
  X,
  XCircle,
} from 'lucide-react';
import type { CropKnowledgeProfile, CropSuitabilityOption } from '../../../shared/index.ts';
import { apiClient } from '../../services/apiClient.ts';
import { CropProfileDetail } from './CropProfileDetail.tsx';
import { FactorScoreChart } from './FactorScoreChart.tsx';

interface CropProfileDrawerProps {
  crop: CropSuitabilityOption | null;
  suitabilityVsYieldDisclaimer: string;
  onClose: () => void;
}

export function CropProfileDrawer({
  crop,
  suitabilityVsYieldDisclaimer,
  onClose,
}: CropProfileDrawerProps) {
  const [knowledgeProfile, setKnowledgeProfile] = useState<CropKnowledgeProfile | null>(null);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [showFullDossier, setShowFullDossier] = useState(false);

  useEffect(() => {
    setKnowledgeProfile(null);
    setShowFullDossier(false);
  }, [crop?.cropId]);

  useEffect(() => {
    if (!crop) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [crop, onClose]);

  async function handleToggleFullDossier() {
    if (!crop) return;
    if (showFullDossier) {
      setShowFullDossier(false);
      return;
    }
    setShowFullDossier(true);
    if (!knowledgeProfile) {
      setLoadingKnowledge(true);
      try {
        const profile = await apiClient.getCropProfileById(crop.cropId);
        setKnowledgeProfile(profile);
      } catch {
        // Optional dossier load
      } finally {
        setLoadingKnowledge(false);
      }
    }
  }

  if (!crop) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-profile-drawer-title"
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden bg-slate-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Drawer Header */}
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">
                {crop.rank ? `Rank #${crop.rank}` : 'Excluded'}
              </span>
              <span>·</span>
              <span>{crop.cropGroup}</span>
              <span>·</span>
              <span
                className={`font-semibold ${
                  crop.suitabilityCategory === 'Highly Suitable'
                    ? 'text-emerald-700'
                    : crop.suitabilityCategory === 'Moderately Suitable'
                      ? 'text-sky-700'
                      : crop.suitabilityCategory === 'Marginally Suitable'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                }`}
              >
                {crop.suitabilityCategory}
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                Confidence {crop.dataConfidence.score}% ({crop.dataConfidence.level})
              </span>
            </div>
            <h2
              id="crop-profile-drawer-title"
              className="mt-1 text-xl font-semibold text-slate-900"
            >
              {crop.cropName}{' '}
              <span className="text-sm font-normal italic text-slate-500">
                ({crop.scientificName})
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right font-mono tabular-nums">
              <div className="text-2xl font-bold text-slate-900">
                {crop.suitabilityScore}
                <span className="text-sm font-normal text-slate-500"> / 100</span>
              </div>
              <div className="text-[11px] text-slate-500">Suitability Score</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close crop profile"
              className="rounded-md border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Profile Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Deterministic Explanation & Yield Disclaimer */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Explainable Suitability Summary
            </h3>
            <p className="text-sm text-slate-800 leading-relaxed">{crop.explanation}</p>
            <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span>{suitabilityVsYieldDisclaimer}</span>
            </div>
          </section>

          {/* Rejection Reasons / Hard Constraints (if excluded) */}
          {crop.hardConstraintsFailed.length > 0 && (
            <section className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-800">
                <XCircle className="h-4 w-4 shrink-0 text-rose-600" />
                Rejection Reasons &amp; Hard Constraints Violated
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-900">
                {crop.hardConstraintsFailed.map((violation, idx) => (
                  <li key={idx}>
                    <span className="font-mono font-semibold">{violation.code}</span>:{' '}
                    {violation.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Data Confidence, Missing & Uncertain Inputs Audit */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Data Confidence &amp; Missing / Uncertain Inputs
              </h3>
              <span className="font-mono text-xs font-semibold tabular-nums text-slate-800">
                Confidence: {crop.dataConfidence.score}% ({crop.dataConfidence.level}) · Coverage:{' '}
                {crop.dataConfidence.completenessPercent}%
              </span>
            </div>
            <p className="text-xs text-slate-700">{crop.dataConfidence.note}</p>
            {(crop.missingOrUncertainInputs?.length ?? 0) > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
                {crop.missingOrUncertainInputs?.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              crop.missingDataWarnings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                  {crop.missingDataWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )
            )}
          </section>

          {/* Factor-Level Scoring Chart */}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Factor-Level Suitability Scoring Chart
              </h3>
              <span className="text-[11px] text-slate-500">
                Dashed lines mark Moderate (60) and High (78) thresholds
              </span>
            </div>
            <div className="mt-3">
              <FactorScoreChart factorScores={crop.factorScores} cropName={crop.cropName} />
            </div>
          </section>

          {/* Individual Factor Breakdown Table */}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Individual Factor Scores &amp; Crop Requirements
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Factor</th>
                    <th className="py-2 pr-3 font-medium">Observed</th>
                    <th className="py-2 pr-3 font-medium">Optimal Crop Range</th>
                    <th className="py-2 pr-3 font-medium text-right">Score</th>
                    <th className="py-2 pr-3 font-medium text-right">Weight</th>
                    <th className="py-2 font-medium">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {crop.factorScores.map((f) => (
                    <tr key={f.factorId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-slate-900">
                        {f.label}
                        <div className="text-[10px] font-normal text-slate-500">
                          {f.dataSource.replaceAll('_', ' ')}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-800">
                        {f.observedValue}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600">{f.cropSuitabilityRange}</td>
                      <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                        {f.score !== null ? `${f.score}/100` : 'Missing'}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600">
                        {Math.round(f.effectiveWeight * 100)}%
                      </td>
                      <td className="py-2.5 text-slate-600">{f.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Soil Compatibility, Seasonal Suitability, Water Requirement */}
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2">
              <h3 className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-500">
                <Sprout className="h-3.5 w-3.5 text-emerald-600" />
                Soil Compatibility
              </h3>
              <p className="font-medium text-slate-800">{crop.soilCompatibility.summary}</p>
              <div className="space-y-1 text-slate-600">
                <p>
                  <span className="font-medium text-slate-800">pH:</span>{' '}
                  {crop.soilCompatibility.phFit}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Texture:</span>{' '}
                  {crop.soilCompatibility.textureFit}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Organic Carbon:</span>{' '}
                  {crop.soilCompatibility.soilHealthNote}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Drainage:</span>{' '}
                  {crop.soilCompatibility.drainageNote}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2">
              <h3 className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-500">
                <Calendar className="h-3.5 w-3.5 text-sky-600" />
                Seasonal Suitability
              </h3>
              <p className="font-medium text-slate-800">{crop.seasonalSuitability.summary}</p>
              <div className="space-y-1 text-slate-600">
                <p>
                  <span className="font-medium text-slate-800">Documented Seasons:</span>{' '}
                  {crop.seasonalSuitability.documentedSeasons.join(', ') || 'Unavailable'}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Sowing Window:</span>{' '}
                  {crop.seasonalSuitability.sowingWindow ?? 'Consult regional KVK calendar'}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Duration:</span>{' '}
                  {crop.seasonalSuitability.durationDaysRange
                    ? `${crop.seasonalSuitability.durationDaysRange[0]}–${crop.seasonalSuitability.durationDaysRange[1]} days`
                    : 'Varietal range unavailable'}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2">
              <h3 className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-500">
                <Droplets className="h-3.5 w-3.5 text-blue-600" />
                Water Requirement
              </h3>
              <p className="font-medium text-slate-800 capitalize">
                {crop.waterRequirementDetail.category} Demand
                {crop.waterRequirementDetail.seasonalMinMm !== null &&
                crop.waterRequirementDetail.seasonalMaxMm !== null
                  ? ` (${crop.waterRequirementDetail.seasonalMinMm}–${crop.waterRequirementDetail.seasonalMaxMm} mm/season)`
                  : ''}
              </p>
              <div className="space-y-1 text-slate-600">
                <p>
                  <span className="font-medium text-slate-800">Rainfed Viability:</span>{' '}
                  <span className="capitalize">
                    {crop.waterRequirementDetail.rainfedViability}
                  </span>
                </p>
                <p>
                  <span className="font-medium text-slate-800">Drought Tolerance:</span>{' '}
                  {crop.waterRequirementDetail.droughtTolerance}
                </p>
                <p>
                  <span className="font-medium text-slate-800">Waterlogging Risk:</span>{' '}
                  {crop.waterRequirementDetail.waterloggingSensitivity}
                </p>
                <p>
                  <span className="font-medium text-slate-800">System Fit:</span>{' '}
                  {crop.waterRequirementDetail.conservationFitNote}
                </p>
              </div>
            </section>
          </div>

          {/* Supporting Environmental Observations */}
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Supporting Environmental &amp; Satellite Observations
              </h3>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {crop.supportingObservations.map((obs) => (
                  <div
                    key={obs.parameter}
                    className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{obs.label}</span>
                      <span
                        className={`text-[10px] font-semibold uppercase ${
                          obs.influenceOnRecommendation === 'positive'
                            ? 'text-emerald-700'
                            : obs.influenceOnRecommendation === 'limiting'
                              ? 'text-rose-700'
                              : obs.status === 'available'
                                ? 'text-slate-600'
                                : 'text-amber-700'
                        }`}
                      >
                        {obs.influenceOnRecommendation
                          ? obs.influenceOnRecommendation
                          : obs.status}
                      </span>
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                      {obs.observedValue}
                    </div>
                    <div className="text-[11px] text-slate-600">{obs.sourceLabel}</div>
                    {(obs.spatialResolution || obs.observationPeriod) && (
                      <div className="text-[10px] text-slate-500 font-mono">
                        {[obs.spatialResolution, obs.observationPeriod].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {obs.stalenessNote && (
                      <div className="text-[10px] text-amber-700">{obs.stalenessNote}</div>
                    )}
                    {obs.representativenessNote && (
                      <div className="text-[10px] text-slate-500 line-clamp-2">
                        {obs.representativenessNote}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {crop.dataSourcesUsed && crop.dataSourcesUsed.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Data Sources &amp; Spatial Limitations
                </h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {crop.dataSourcesUsed.map((src) => (
                    <div
                      key={src.id}
                      className="rounded border border-slate-200 bg-white p-2.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{src.name}</span>
                        <span
                          className={`text-[10px] font-semibold uppercase ${
                            src.isFresh ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {src.isFresh ? 'Fresh' : 'Stale'}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        {src.dataset} · <span className="font-mono">{src.spatialResolution}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">{src.limitations}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Advantages & Limitations */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Advantages
              </h3>
              {crop.advantages.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-slate-700">
                  {crop.advantages.map((adv, idx) => (
                    <li key={idx}>{adv}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  No strong advantages recorded for the evaluated factors.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                {crop.limitingFactors.length > 0 ? (
                  <ShieldAlert className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                Limitations &amp; Risk Factors
              </h3>
              {crop.limitations.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-slate-700">
                  {crop.limitations.map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  No major agronomic limitations identified from available inputs.
                </p>
              )}
            </section>
          </div>

          {/* Expandable Full ICAR Knowledge Base Profile */}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-slate-600" />
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                    Full ICAR / KVK Crop Knowledge Dossier
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Inspect published nutrient, irrigation, nitrogen fixation, and rotation rules.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleToggleFullDossier()}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                {showFullDossier ? 'Hide ICAR Dossier' : 'Open ICAR Dossier'}
              </button>
            </div>

            {showFullDossier && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                {loadingKnowledge && (
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading ICAR crop knowledge profile…
                  </div>
                )}
                {knowledgeProfile && <CropProfileDetail crop={knowledgeProfile} />}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
