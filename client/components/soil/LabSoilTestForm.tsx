import { useEffect, useState, type FormEvent } from 'react';
import { FlaskConical, Save, Trash2 } from 'lucide-react';
import type { LabSoilTestResult, SoilDepthInterval } from '../../../shared/index.ts';

interface LabSoilTestFormProps {
  parcelKey: string;
  parcelLabel: string;
  initialTest: LabSoilTestResult | null;
  onSave: (result: LabSoilTestResult) => void;
  onClear: () => void;
}

interface FormDraft {
  sampleDate: string;
  labName: string;
  sampleDepthCm: SoilDepthInterval;
  ph: string;
  organicMatterPercent: string;
  organicCarbonGKg: string;
  totalNitrogenGKg: string;
  availableNitrogenMgKg: string;
  phosphorusMgKg: string;
  potassiumMgKg: string;
  cecCmolKg: string;
  bulkDensityKgDm3: string;
  sandPercent: string;
  siltPercent: string;
  clayPercent: string;
  notes: string;
}

function toInputStr(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const num = Number.parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

function classifyTextureClient(
  sand: number | null,
  silt: number | null,
  clay: number | null,
): string | null {
  if (sand === null || silt === null || clay === null) {
    return null;
  }
  const total = sand + silt + clay;
  if (total <= 0) {
    return null;
  }
  const s = (sand / total) * 100;
  const si = (silt / total) * 100;
  const c = (clay / total) * 100;
  if (c >= 40) return s <= 45 && si < 40 ? 'Clay' : si >= 40 ? 'Silty Clay' : 'Sandy Clay';
  if (c >= 27) return s <= 20 ? 'Silty Clay Loam' : s <= 45 ? 'Clay Loam' : 'Sandy Clay Loam';
  if (c >= 20) return si < 28 && s > 45 ? 'Sandy Clay Loam' : si >= 50 ? 'Silt Loam' : 'Loam';
  if (c < 12 && si >= 80) return 'Silt';
  if (si >= 50) return 'Silt Loam';
  if (c >= 7 && si >= 28 && si < 50 && s <= 52) return 'Loam';
  if (si + 1.5 * c < 15) return 'Sand';
  if (si + 1.5 * c >= 15 && si + 2 * c < 30) return 'Loamy Sand';
  return 'Sandy Loam';
}

function createDraft(existing: LabSoilTestResult | null): FormDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    sampleDate: existing?.sampleDate ?? today,
    labName: existing?.labName ?? '',
    sampleDepthCm: existing?.sampleDepthCm ?? '0-15' as SoilDepthInterval,
    ph: toInputStr(existing?.ph),
    organicMatterPercent: toInputStr(existing?.organicMatterPercent),
    organicCarbonGKg: toInputStr(existing?.organicCarbonGKg),
    totalNitrogenGKg: toInputStr(existing?.totalNitrogenGKg),
    availableNitrogenMgKg: toInputStr(existing?.availableNitrogenMgKg),
    phosphorusMgKg: toInputStr(existing?.phosphorusMgKg),
    potassiumMgKg: toInputStr(existing?.potassiumMgKg),
    cecCmolKg: toInputStr(existing?.cecCmolKg),
    bulkDensityKgDm3: toInputStr(existing?.bulkDensityKgDm3),
    sandPercent: toInputStr(existing?.sandPercent),
    siltPercent: toInputStr(existing?.siltPercent),
    clayPercent: toInputStr(existing?.clayPercent),
    notes: existing?.notes ?? '',
  };
}

export function LabSoilTestForm({
  parcelKey,
  parcelLabel,
  initialTest,
  onSave,
  onClear,
}: LabSoilTestFormProps) {
  const [draft, setDraft] = useState<FormDraft>(() => {
    const d = createDraft(initialTest);
    if (!initialTest) {
      d.sampleDepthCm = '5-15';
    }
    return d;
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    const d = createDraft(initialTest);
    if (!initialTest) {
      d.sampleDepthCm = '5-15';
    }
    setDraft(d);
    setValidationError(null);
    setSavedBanner(null);
  }, [parcelKey, initialTest]);

  function updateField<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSavedBanner(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const ph = parseOptionalNumber(draft.ph);
    if (ph !== null && (ph < 2 || ph > 11)) {
      setValidationError('Soil pH must be between 2.0 and 11.0.');
      return;
    }

    const om = parseOptionalNumber(draft.organicMatterPercent);
    let oc = parseOptionalNumber(draft.organicCarbonGKg);
    // If farmer enters Soil Organic Matter % without explicit Organic Carbon g/kg, convert via Van Bemmelen (OM% * 5.8 g/kg)
    if (oc === null && om !== null) {
      if (om < 0 || om > 100) {
        setValidationError('Organic matter percentage must be between 0 and 100%.');
        return;
      }
      oc = Number((om * 5.8).toFixed(1));
    }

    const sand = parseOptionalNumber(draft.sandPercent);
    const silt = parseOptionalNumber(draft.siltPercent);
    const clay = parseOptionalNumber(draft.clayPercent);
    if (sand !== null && silt !== null && clay !== null) {
      const sum = sand + silt + clay;
      if (sum < 95 || sum > 105) {
        setValidationError(
          `Sand (${sand}%) + Silt (${silt}%) + Clay (${clay}%) sums to ${sum.toFixed(1)}%. Texture fractions should sum to ~100%.`,
        );
        return;
      }
    }

    const totalN = parseOptionalNumber(draft.totalNitrogenGKg);
    const availN = parseOptionalNumber(draft.availableNitrogenMgKg);
    const p = parseOptionalNumber(draft.phosphorusMgKg);
    const k = parseOptionalNumber(draft.potassiumMgKg);
    const cec = parseOptionalNumber(draft.cecCmolKg);
    const bd = parseOptionalNumber(draft.bulkDensityKgDm3);

    const hasAnyMeasurement = [ph, oc, om, totalN, availN, p, k, cec, bd, sand, silt, clay].some(
      (v) => v !== null,
    );

    if (!hasAnyMeasurement) {
      setValidationError('Enter at least one measured laboratory value before saving.');
      return;
    }

    const result: LabSoilTestResult = {
      id: initialTest?.id ?? `lab-${Date.now()}`,
      parcelKey,
      dataClassification: 'measured_lab',
      sampleDate: draft.sampleDate || new Date().toISOString().slice(0, 10),
      labName: draft.labName.trim() || 'Farmer / Agronomy Lab',
      sampleDepthCm: draft.sampleDepthCm,
      ph,
      organicCarbonGKg: oc,
      organicMatterPercent: om,
      totalNitrogenGKg: totalN,
      availableNitrogenMgKg: availN,
      phosphorusMgKg: p,
      potassiumMgKg: k,
      cecCmolKg: cec,
      bulkDensityKgDm3: bd,
      sandPercent: sand,
      siltPercent: silt,
      clayPercent: clay,
      textureClass: classifyTextureClient(sand, silt, clay),
      notes: draft.notes.trim(),
      updatedAt: new Date().toISOString(),
    };

    onSave(result);
    setSavedBanner('Laboratory test saved and synced to comparison charts.');
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">
              Laboratory Soil-Test Entry (Farmer Measured)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Parcel: <span className="font-medium text-slate-800">{parcelLabel}</span> · Leave unmeasured fields blank — blank fields remain unrecorded rather than estimated.
          </p>
        </div>

        {initialTest && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear Lab Record
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="lab-date" className="block text-[11px] font-medium text-slate-600">
              Sample Date
            </label>
            <input
              id="lab-date"
              type="date"
              value={draft.sampleDate}
              onChange={(e) => updateField('sampleDate', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-name" className="block text-[11px] font-medium text-slate-600">
              Laboratory / Method
            </label>
            <input
              id="lab-name"
              type="text"
              placeholder="e.g., ISU Soil Testing Lab (Mehlich-3)"
              value={draft.labName}
              onChange={(e) => updateField('labName', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-depth" className="block text-[11px] font-medium text-slate-600">
              Sample Depth Interval
            </label>
            <select
              id="lab-depth"
              value={draft.sampleDepthCm}
              onChange={(e) => updateField('sampleDepthCm', e.target.value as SoilDepthInterval)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            >
              <option value="0-5">0–5 cm</option>
              <option value="5-15">5–15 cm (Topsoil core)</option>
              <option value="15-30">15–30 cm (Plow layer)</option>
              <option value="30-60">30–60 cm (Subsoil)</option>
            </select>
          </div>
        </div>

        {/* Chemical & Macronutrient Inputs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="lab-ph" className="block text-[11px] font-medium text-slate-600">
              Soil pH (1:1 H₂O)
            </label>
            <input
              id="lab-ph"
              type="number"
              step="0.1"
              min="2"
              max="11"
              placeholder="e.g. 6.4"
              value={draft.ph}
              onChange={(e) => updateField('ph', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-avail-n" className="block text-[11px] font-medium text-slate-600">
              Available N (mg/kg NO₃⁻)
            </label>
            <input
              id="lab-avail-n"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 24"
              value={draft.availableNitrogenMgKg}
              onChange={(e) => updateField('availableNitrogenMgKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-p" className="block text-[11px] font-medium text-slate-600">
              Phosphorus P (mg/kg)
            </label>
            <input
              id="lab-p"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 32"
              value={draft.phosphorusMgKg}
              onChange={(e) => updateField('phosphorusMgKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-k" className="block text-[11px] font-medium text-slate-600">
              Potassium K (mg/kg)
            </label>
            <input
              id="lab-k"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 165"
              value={draft.potassiumMgKg}
              onChange={(e) => updateField('potassiumMgKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
        </div>

        {/* Carbon, Total N, CEC, Bulk Density */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <label htmlFor="lab-om" className="block text-[11px] font-medium text-slate-600">
              Organic Matter (%)
            </label>
            <input
              id="lab-om"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="e.g. 3.8"
              value={draft.organicMatterPercent}
              onChange={(e) => updateField('organicMatterPercent', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-soc" className="block text-[11px] font-medium text-slate-600">
              Organic Carbon (g/kg)
            </label>
            <input
              id="lab-soc"
              type="number"
              step="0.1"
              min="0"
              placeholder="Auto if OM% set"
              value={draft.organicCarbonGKg}
              onChange={(e) => updateField('organicCarbonGKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-total-n" className="block text-[11px] font-medium text-slate-600">
              Total Nitrogen (g/kg)
            </label>
            <input
              id="lab-total-n"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 2.10"
              value={draft.totalNitrogenGKg}
              onChange={(e) => updateField('totalNitrogenGKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-cec" className="block text-[11px] font-medium text-slate-600">
              CEC (cmol(c)/kg)
            </label>
            <input
              id="lab-cec"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 18.5"
              value={draft.cecCmolKg}
              onChange={(e) => updateField('cecCmolKg', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-bd" className="block text-[11px] font-medium text-slate-600">
              Bulk Density (kg/dm³)
            </label>
            <input
              id="lab-bd"
              type="number"
              step="0.01"
              min="0.2"
              max="2.5"
              placeholder="e.g. 1.32"
              value={draft.bulkDensityKgDm3}
              onChange={(e) => updateField('bulkDensityKgDm3', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
        </div>

        {/* Texture Fractions & Notes */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="lab-sand" className="block text-[11px] font-medium text-slate-600">
              Lab Sand (%)
            </label>
            <input
              id="lab-sand"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="0–100"
              value={draft.sandPercent}
              onChange={(e) => updateField('sandPercent', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-silt" className="block text-[11px] font-medium text-slate-600">
              Lab Silt (%)
            </label>
            <input
              id="lab-silt"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="0–100"
              value={draft.siltPercent}
              onChange={(e) => updateField('siltPercent', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-clay" className="block text-[11px] font-medium text-slate-600">
              Lab Clay (%)
            </label>
            <input
              id="lab-clay"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="0–100"
              value={draft.clayPercent}
              onChange={(e) => updateField('clayPercent', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="lab-notes" className="block text-[11px] font-medium text-slate-600">
              Sampling Notes
            </label>
            <input
              id="lab-notes"
              type="text"
              placeholder="Composite 12 cores"
              value={draft.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            />
          </div>
        </div>

        {validationError && (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {validationError}
          </p>
        )}

        {savedBanner && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {savedBanner}
          </p>
        )}

        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-[11px] text-slate-500">
            Stored locally per selected parcel. Soil Organic Matter (%) converts to Organic Carbon (g/kg) via standard 0.58 factor if Organic Carbon is blank.
          </p>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Save Lab Soil Test
          </button>
        </div>
      </form>
    </section>
  );
}
