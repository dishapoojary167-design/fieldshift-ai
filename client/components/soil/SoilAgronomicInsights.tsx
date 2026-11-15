import type {
  LabSoilTestResult,
  SoilMoistureSnapshot,
  SoilProfile,
} from '../../../shared/index.ts';

interface AgronomicExplanation {
  topic: string;
  provenance: string;
  summary: string;
  managementImplication: string;
}

export function SoilAgronomicInsights({
  profile,
  moisture,
  labTest,
}: {
  profile: SoilProfile | null;
  moisture: SoilMoistureSnapshot | null;
  labTest: LabSoilTestResult | null;
}) {
  const insights: AgronomicExplanation[] = [];

  const effectivePh = labTest?.ph ?? profile?.surfaceSummary.ph.mean ?? null;
  const phOrigin = labTest?.ph !== null && labTest?.ph !== undefined
    ? 'Measured Lab Sample'
    : 'SoilGrids Modelled Estimate';

  if (effectivePh !== null) {
    if (effectivePh < 5.5) {
      insights.push({
        topic: `Acidic Soil Reaction (${effectivePh.toFixed(1)} pH)`,
        provenance: phOrigin,
        summary:
          'Strongly acidic conditions increase aluminum and manganese solubility while reducing phosphorus, calcium, and molybdenum availability.',
        managementImplication:
          'Verify buffer pH via laboratory testing before applying agricultural limestone; consider acid-tolerant species if liming is deferred.',
      });
    } else if (effectivePh <= 7.3) {
      insights.push({
        topic: `Optimal Nutrient Availability Band (${effectivePh.toFixed(1)} pH)`,
        provenance: phOrigin,
        summary:
          'Soil pH lies in the neutral agronomic zone (5.8–7.3), where primary macronutrients (N, P, K) and rhizobial nodulation perform efficiently.',
        managementImplication:
          'Maintain current pH through periodic soil sampling every 2–3 seasons to offset nitrogen-fertilizer acidification.',
      });
    } else {
      insights.push({
        topic: `Alkaline Soil Reaction (${effectivePh.toFixed(1)} pH)`,
        provenance: phOrigin,
        summary:
          'Alkaline conditions (> 7.3 pH) promote calcium-phosphate precipitation and reduce iron, zinc, and manganese plant uptake.',
        managementImplication:
          'Favor banded phosphorus placement, acidifying ammonium-based N sources where appropriate, or micronutrient foliar/seed-zone supplementation.',
      });
    }
  }

  const effectiveSoc = labTest?.organicCarbonGKg ?? profile?.surfaceSummary.organicCarbonGKg.mean ?? null;
  const socOrigin =
    labTest?.organicCarbonGKg !== null && labTest?.organicCarbonGKg !== undefined
      ? 'Measured Lab Sample'
      : 'SoilGrids Modelled Estimate';

  if (effectiveSoc !== null) {
    const approxOm = (effectiveSoc / 5.8).toFixed(1);
    if (effectiveSoc < 12) {
      insights.push({
        topic: `Low Soil Organic Carbon (${effectiveSoc.toFixed(1)} g/kg · ~${approxOm}% OM)`,
        provenance: socOrigin,
        summary:
          'Low organic carbon limits aggregate stability, cation exchange buffering, and topsoil infiltration during intense rainfall.',
        managementImplication:
          'Prioritize high-biomass cover crops, residue retention, reduced tillage, or compost/manure amendments to rebuild surface carbon.',
      });
    } else if (effectiveSoc < 25) {
      insights.push({
        topic: `Moderate Soil Organic Carbon (${effectiveSoc.toFixed(1)} g/kg · ~${approxOm}% OM)`,
        provenance: socOrigin,
        summary:
          'Moderate soil carbon supports baseline biological mineralization and aggregate structure under continuous cropping.',
        managementImplication:
          'Protect carbon stocks with strip-till/no-till passes and diverse crop rotations to gradually raise water-holding capacity.',
      });
    } else {
      insights.push({
        topic: `High Soil Organic Carbon (${effectiveSoc.toFixed(1)} g/kg · ~${approxOm}% OM)`,
        provenance: socOrigin,
        summary:
          'Carbon-rich topsoil enhances cation exchange capacity, nitrogen mineralization buffering, and structural resilience against compaction.',
        managementImplication:
          'Credit mineralized nitrogen conservatively in fertility budgets and avoid excessive inversion tillage.',
      });
    }
  }

  const effectiveTexture = labTest?.textureClass ?? profile?.surfaceSummary.textureClass ?? null;
  const effectiveBd = labTest?.bulkDensityKgDm3 ?? profile?.surfaceSummary.bulkDensityKgDm3.mean ?? null;

  if (effectiveTexture) {
    insights.push({
      topic: `Soil Texture & Drainage (${effectiveTexture})`,
      provenance: labTest?.textureClass ? 'Measured Lab Texture' : 'SoilGrids Modelled Texture',
      summary:
        profile?.surfaceSummary.waterRetentionSummary ??
        `Classified as ${effectiveTexture} on the USDA soil texture triangle.`,
      managementImplication:
        effectiveBd !== null && effectiveBd >= 1.55
          ? `Bulk density (${effectiveBd.toFixed(2)} kg/dm³) indicates potential subsoil compaction risk; evaluate penetrometer resistance before wet field traffic.`
          : 'Schedule tillage and heavy equipment passes when soil moisture is below plastic limit to preserve pore continuity.',
    });
  }

  if (moisture && (moisture.surfaceMoistureM3M3 !== null || moisture.rootZoneMoistureM3M3 !== null)) {
    const rz = moisture.rootZoneMoistureM3M3 ?? moisture.surfaceMoistureM3M3!;
    if (rz < 0.16) {
      insights.push({
        topic: `Low Satellite Root-Zone Moisture (${rz.toFixed(3)} m³/m³)`,
        provenance: 'NASA SMAP L4 Satellite',
        summary:
          'SMAP L4 volumetric moisture indicates dry regional profile conditions with limited plant-available water reserve.',
        managementImplication:
          'Avoid moisture-wasting tillage, verify germination-zone moisture prior to seeding, and prioritize drought-resilient cultivars.',
      });
    } else if (rz <= 0.36) {
      insights.push({
        topic: `Adequate Profile Soil Moisture (${rz.toFixed(3)} m³/m³)`,
        provenance: 'NASA SMAP L4 Satellite',
        summary:
          'SMAP L4 analyzed moisture sits within a well-hydrated agronomic working band supporting root uptake and microbial activity.',
        managementImplication:
          'Compare against on-farm rain gauges and soil feel/probe checks before scheduling supplemental irrigation.',
      });
    } else {
      insights.push({
        topic: `High / Near-Saturated Soil Moisture (${rz.toFixed(3)} m³/m³)`,
        provenance: 'NASA SMAP L4 Satellite',
        summary:
          'Elevated volumetric moisture indicates high soil water storage, increasing risks of surface runoff, denitrification, and traffic compaction.',
        managementImplication:
          'Delay heavy axle loads or anhydrous/nitrate applications until topsoil drains below field capacity.',
      });
    }
  }

  if (
    labTest &&
    (labTest.phosphorusMgKg !== null ||
      labTest.potassiumMgKg !== null ||
      labTest.availableNitrogenMgKg !== null)
  ) {
    const parts: string[] = [];
    if (labTest.availableNitrogenMgKg !== null) {
      parts.push(`Available NO₃-N: ${labTest.availableNitrogenMgKg} mg/kg`);
    }
    if (labTest.phosphorusMgKg !== null) {
      parts.push(
        `Phosphorus: ${labTest.phosphorusMgKg} mg/kg (${labTest.phosphorusMgKg < 15 ? 'low—yield response likely' : labTest.phosphorusMgKg <= 35 ? 'medium—maintenance rate' : 'high—drawdown possible'})`,
      );
    }
    if (labTest.potassiumMgKg !== null) {
      parts.push(
        `Potassium: ${labTest.potassiumMgKg} mg/kg (${labTest.potassiumMgKg < 120 ? 'low—build recommended' : labTest.potassiumMgKg <= 200 ? 'medium—maintenance rate' : 'sufficient'})`,
      );
    }

    insights.push({
      topic: 'Laboratory NPK Fertility Calibration',
      provenance: 'Measured Lab Sample',
      summary: parts.join(' · '),
      managementImplication:
        'Regional satellite models (SoilGrids / SMAP) do not measure plant-available P or K; use these laboratory test values to calibrate variable-rate fertilizer prescriptions.',
    });
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">
        Farming-Oriented Soil Interpretations
      </h2>
      <p className="mt-0.5 text-xs text-slate-600">
        Rule-based agronomic notes derived strictly from retrieved measurements — unavailable properties are omitted rather than assumed.
      </p>

      {insights.length === 0 ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          No sufficient SoilGrids, SMAP, or laboratory measurements are currently available to generate agronomic interpretations.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {insights.map((item) => (
            <article key={item.topic} className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">{item.topic}</h3>
                <span className="font-mono text-[10px] text-slate-500">{item.provenance}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{item.summary}</p>
              <p className="mt-2 border-t border-slate-200 pt-1.5 text-[11px] leading-relaxed text-slate-700">
                <span className="font-semibold text-slate-900">Field Practice:</span>{' '}
                {item.managementImplication}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
