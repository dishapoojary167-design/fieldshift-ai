import { BookOpen, CheckCircle2, HelpCircle, Info } from 'lucide-react';
import type {
  AgronomicSourceReference,
  CropKnowledgeProfile,
  CropParameterValidationStatus,
  ValidatedCropParameter,
} from '../../../shared/index.ts';

interface CropProfileDetailProps {
  crop: CropKnowledgeProfile;
  selectedStateFilter?: string;
}

function ValidationMetaFooter({
  status,
  note,
  sources,
}: {
  status: CropParameterValidationStatus;
  note: string;
  sources: AgronomicSourceReference[];
}) {
  const statusLabel =
    status === 'icar_kvk_verified'
      ? 'ICAR / KVK Verified'
      : status === 'provisional_regional'
        ? 'Regional / Provisional Range'
        : 'Unavailable as Single National Constant';

  const statusClass =
    status === 'icar_kvk_verified'
      ? 'text-emerald-700'
      : status === 'provisional_regional'
        ? 'text-amber-700'
        : 'text-slate-600';

  const Icon =
    status === 'icar_kvk_verified'
      ? CheckCircle2
      : status === 'provisional_regional'
        ? Info
        : HelpCircle;

  return (
    <div className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-600 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 font-medium">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${statusClass}`} />
        <span className={statusClass}>{statusLabel}</span>
        <span className="text-slate-400">·</span>
        <span className="font-normal text-slate-600">{note}</span>
      </div>
      <div className="text-slate-500">
        <span className="font-medium text-slate-600">Source:</span>{' '}
        {sources
          .map((s) => `${s.institute} — ${s.title}${s.year ? ` (${s.year})` : ''}`)
          .join(' | ')}
      </div>
    </div>
  );
}

function ParameterCard<T>({
  title,
  param,
  children,
}: {
  title: string;
  param: ValidatedCropParameter<T>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title}
        </h3>
        {param.unit && (
          <span className="font-mono text-[11px] text-slate-500">{param.unit}</span>
        )}
      </div>
      <div className="mt-2.5">{children}</div>
      <ValidationMetaFooter
        status={param.validationStatus}
        note={param.validationNote}
        sources={param.sources}
      />
    </section>
  );
}

function fmtRange(range: [number, number] | null, suffix = ''): string {
  if (!range) {
    return 'Unavailable / Not Applicable';
  }
  const [min, max] = range;
  return min === max ? `${min}${suffix}` : `${min}–${max}${suffix}`;
}

export function CropProfileDetail({ crop, selectedStateFilter }: CropProfileDetailProps) {
  const temp = crop.temperatureRequirements.value;
  const water = crop.waterRequirements.value;
  const soil = crop.soilPreferences.value;
  const duration = crop.growingDuration.value;
  const nutrients = crop.nutrientRequirements.value;
  const irrigation = crop.irrigationNeeds.value;
  const nFix = crop.nitrogenFixationCharacteristics.value;
  const rotation = crop.cropRotationCompatibility.value;
  const regions = crop.regionalSuitability.value ?? [];

  return (
    <div className="space-y-4">
      {/* Crop Dossier Header */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold uppercase tracking-wider text-slate-600">
                {crop.cropGroup}
              </span>
              <span>·</span>
              <span>Family: {crop.cropFamily}</span>
              <span>·</span>
              <span>
                Seasons: {(crop.growingSeasons.value ?? []).join(' / ') || 'Unavailable'}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{crop.cropName}</h2>
            <p className="mt-0.5 text-sm italic text-slate-600">{crop.scientificName}</p>
            {crop.localNames.length > 0 && (
              <p className="mt-1.5 text-xs text-slate-600">
                <span className="font-medium text-slate-700">Indian Regional Names:</span>{' '}
                {crop.localNames.join(' · ')}
              </p>
            )}
          </div>

          <div className="text-right text-xs text-slate-500">
            <div>Profile ID: <span className="font-mono text-slate-700">{crop.id}</span></div>
            <div className="mt-0.5">
              Reviewed: <span className="font-mono text-slate-700">{crop.lastReviewedDate}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <div>
            <span className="font-semibold text-slate-900">
              Agronomic Reference Profile Only:
            </span>{' '}
            All figures below represent published ICAR / KVK crop requirements and documented
            constraints—not a site-specific suitability score or yield forecast.{' '}
            <span className="text-slate-600">{crop.unavailableParametersNote}</span>
          </div>
        </div>
      </section>

      {/* Core Agronomic Requirements Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <ParameterCard
          title="Temperature Requirements"
          param={crop.temperatureRequirements}
        >
          {temp ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Optimal Range</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {temp.optimalMinC}–{temp.optimalMaxC} °C
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Min Germination</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {temp.germinationMinC !== null ? `${temp.germinationMinC} °C` : 'Unavailable'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Heat Stress Cutoff</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {temp.heatStressThresholdC !== null
                    ? `> ${temp.heatStressThresholdC} °C`
                    : 'Unavailable'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Frost Sensitivity</dt>
                <dd className="text-slate-800">{temp.frostSensitivity}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard title="Water Requirements" param={crop.waterRequirements}>
          {water ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Seasonal Water Duty</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {water.seasonalMinMm}–{water.seasonalMaxMm} mm
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Demand Class</dt>
                <dd className="font-semibold capitalize text-slate-900">{water.category}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Drought Tolerance</dt>
                <dd className="text-slate-800">{water.droughtTolerance}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Waterlogging Sensitivity</dt>
                <dd className="text-slate-800">{water.waterloggingSensitivity}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard title="Soil Preferences" param={crop.soilPreferences}>
          {soil ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Optimal pH Range</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {soil.phMin.toFixed(1)}–{soil.phMax.toFixed(1)} pH
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Salinity Threshold (ECe)</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {soil.salinityThresholdEcDsM !== null
                    ? `${soil.salinityThresholdEcDsM.toFixed(1)} dS/m`
                    : 'Unavailable'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Preferred Soil Textures</dt>
                <dd className="font-medium text-slate-900">
                  {soil.preferredTextures.join(' · ')}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Indian Soil Types</dt>
                <dd className="text-slate-800">{soil.indianSoilTypes.join(' · ')}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Drainage &amp; Salinity</dt>
                <dd className="text-slate-800">
                  {soil.drainageRequirement} {soil.salinityToleranceNote}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard title="Growing Duration & Seasons" param={crop.growingDuration}>
          {duration ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Duration Window</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {duration.minDays}–{duration.maxDays} days
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Documented Seasons</dt>
                <dd className="font-semibold text-slate-900">
                  {(crop.growingSeasons.value ?? []).join(' · ')}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Maturity Groups</dt>
                <dd className="text-slate-800">{duration.maturityNote}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard title="Nutrient Requirements (NPK)" param={crop.nutrientRequirements}>
          {nutrients ? (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-center">
                <div>
                  <div className="text-[11px] text-slate-500">Nitrogen (N)</div>
                  <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
                    {fmtRange(nutrients.nitrogenKgHa, ' kg/ha')}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Phosphorus (P₂O₅)</div>
                  <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
                    {fmtRange(nutrients.phosphorusP2O5KgHa, ' kg/ha')}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Potassium (K₂O)</div>
                  <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
                    {fmtRange(nutrients.potassiumK2OKgHa, ' kg/ha')}
                  </div>
                </div>
              </div>
              <div>
                <span className="font-medium text-slate-700">Secondary &amp; Micronutrients:</span>{' '}
                <span className="text-slate-700">{nutrients.secondaryAndMicronutrients}</span>
              </div>
              <div>
                <span className="font-medium text-slate-700">Soil-Test Calibration:</span>{' '}
                <span className="text-slate-700">{nutrients.soilTestCalibrationNote}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard title="Irrigation Needs & Critical Stages" param={crop.irrigationNeeds}>
          {irrigation ? (
            <dl className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-slate-500">Rainfed Viability</dt>
                  <dd className="font-semibold capitalize text-slate-900">
                    {irrigation.rainfedViability}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Typical Irrigation Count</dt>
                  <dd className="font-mono font-semibold tabular-nums text-slate-900">
                    {irrigation.recommendedIrrigationsRange
                      ? fmtRange(irrigation.recommendedIrrigationsRange, ' irrigations')
                      : 'Unavailable (AWD/Percolation-dependent)'}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="text-slate-500">Critical Moisture Stages</dt>
                <dd className="mt-0.5 text-slate-800">
                  {irrigation.criticalGrowthStages.join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Management Note</dt>
                <dd className="text-slate-800">{irrigation.managementNote}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>
      </div>

      {/* Biological Nitrogen Fixation & Rotation Compatibility */}
      <div className="grid gap-4 md:grid-cols-2">
        <ParameterCard
          title="Nitrogen Fixation Characteristics"
          param={crop.nitrogenFixationCharacteristics}
        >
          {nFix ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Atmospheric N Fixation</dt>
                <dd className="font-semibold text-slate-900">
                  {nFix.fixesAtmosphericNitrogen ? 'Yes (Symbiotic Legume)' : 'No (Non-Legume)'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Symbiont Species</dt>
                <dd className="italic text-slate-800">
                  {nFix.symbiontSpecies ?? 'Not Applicable'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Estimated BNF Rate</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {nFix.estimatedFixationKgNHa
                    ? fmtRange(nFix.estimatedFixationKgNHa, ' kg N/ha')
                    : 'Not Applicable'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Residual N Credit</dt>
                <dd className="font-mono font-semibold tabular-nums text-slate-900">
                  {nFix.residualNitrogenCreditKgNHa
                    ? fmtRange(nFix.residualNitrogenCreditKgNHa, ' kg N/ha')
                    : 'Not Applicable'}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Nodulation &amp; Inoculation</dt>
                <dd className="text-slate-800">{nFix.nodulationAndInoculationNote}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>

        <ParameterCard
          title="Crop Rotation Compatibility"
          param={crop.cropRotationCompatibility}
        >
          {rotation ? (
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Beneficial Preceding Crops</dt>
                <dd className="font-medium text-slate-900">
                  {rotation.beneficialPrecedingCrops.join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Beneficial Succeeding Crops</dt>
                <dd className="font-medium text-slate-900">
                  {rotation.beneficialSucceedingCrops.join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Incompatible / Caution Sequences</dt>
                <dd className="mt-0.5 space-y-1 text-amber-800">
                  {rotation.incompatibleOrCautionSequences.map((warning, idx) => (
                    <div key={idx}>• {warning}</div>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Agronomic Rationale</dt>
                <dd className="text-slate-800">{rotation.agronomicRationale}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-slate-500">Unavailable</p>
          )}
        </ParameterCard>
      </div>

      {/* Indian Agro-Climatic Zones & States Suitability Table */}
      <ParameterCard
        title="Regional Suitability Across Indian Agro-Climatic Zones & States"
        param={crop.regionalSuitability}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Agro-Climatic Region</th>
                <th className="py-2 pr-3 font-medium">Indian States</th>
                <th className="py-2 pr-3 font-medium">Primary Season</th>
                <th className="py-2 pr-3 font-medium">Typical Sowing Window</th>
                <th className="py-2 font-medium">Regional Notes</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((entry) => {
                const stateMatches =
                  selectedStateFilter &&
                  entry.states.some(
                    (s) => s.toLowerCase() === selectedStateFilter.toLowerCase(),
                  );
                return (
                  <tr
                    key={entry.agroClimaticZoneId}
                    className={`border-b border-slate-100 last:border-0 ${
                      stateMatches ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {entry.agroClimaticZoneName}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">
                      {entry.states.join(', ')}
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-slate-800">
                      {entry.primarySeason}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-700">
                      {entry.typicalSowingWindow}
                    </td>
                    <td className="py-2.5 text-slate-600">{entry.regionalNotes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ParameterCard>
    </div>
  );
}
