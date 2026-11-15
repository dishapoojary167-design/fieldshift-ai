import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RotationStrategyEvaluation } from '../../../shared/index.ts';

interface RotationWaterChartProps {
  strategies: RotationStrategyEvaluation[];
  activeStrategy: RotationStrategyEvaluation;
}

export function RotationWaterChart({ strategies, activeStrategy }: RotationWaterChartProps) {
  const strategyComparisonData = strategies.map((s) => ({
    name:
      s.strategyId === 'existing'
        ? 'Existing'
        : s.strategyId === 'alternative_a'
          ? 'Alt A (Soil)'
          : s.strategyId === 'alternative_b'
            ? 'Alt B (Water)'
            : 'Custom',
    avgMinMm: s.indicators.estimatedSeasonalWaterDemand.averageMinMmPerSeason ?? 0,
    avgMaxMm: s.indicators.estimatedSeasonalWaterDemand.averageMaxMmPerSeason ?? 0,
    category: s.indicators.estimatedSeasonalWaterDemand.demandCategory,
  }));

  const slotWaterData = activeStrategy.slots.map((slot) => ({
    slotLabel: `Y${slot.year} ${slot.season.slice(0, 3)} (${slot.cropName.split(' ')[0]})`,
    minMm: slot.estimatedWaterMmRange?.[0] ?? 0,
    maxMm: slot.estimatedWaterMmRange?.[1] ?? 0,
    cropName: slot.cropName,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Average Seasonal Water Reference by Strategy
          </h3>
          <span className="text-[11px] text-slate-500">ICAR crop range (mm/season)</span>
        </div>
        <div className="mt-3 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={strategyComparisonData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#334155' }} stroke="#cbd5e1" />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" unit=" mm" width={64} />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const item = payload[0].payload as (typeof strategyComparisonData)[number];
                  return (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      <div className="mt-1 font-mono tabular-nums text-slate-700">
                        Ref Range: {item.avgMinMm}–{item.avgMaxMm} mm/season
                      </div>
                      <div className="text-[11px] capitalize text-slate-500">
                        Demand Tier: {item.category}
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="avgMinMm" name="Seasonal Min (mm)" fill="#0284c7" radius={[3, 3, 0, 0]} barSize={20} />
              <Bar dataKey="avgMaxMm" name="Seasonal Max (mm)" fill="#0369a1" radius={[3, 3, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Seasonal Water Demand Profile: {activeStrategy.label}
          </h3>
          <span className="text-[11px] text-slate-500">Slot-by-slot reference</span>
        </div>
        <div className="mt-3 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slotWaterData} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="slotLabel"
                tick={{ fontSize: 10, fill: '#334155' }}
                stroke="#cbd5e1"
                interval={0}
                angle={-12}
                textAnchor="end"
                height={42}
              />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" unit=" mm" width={64} />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const item = payload[0].payload as (typeof slotWaterData)[number];
                  return (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <div className="font-semibold text-slate-900">{item.cropName}</div>
                      <div className="mt-1 font-mono tabular-nums text-slate-700">
                        ICAR Crop Requirement: {item.minMm}–{item.maxMm} mm
                      </div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="minMm" name="Min Water (mm)" fill="#14b8a6" radius={[3, 3, 0, 0]} barSize={18} />
              <Bar dataKey="maxMm" name="Max Water (mm)" fill="#0f766e" radius={[3, 3, 0, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

interface StrategySubScoreChartProps {
  strategies: RotationStrategyEvaluation[];
}

export function StrategySubScoreChart({ strategies }: StrategySubScoreChartProps) {
  const dimensions: Array<{ key: keyof RotationStrategyEvaluation['subScores']; label: string }> = [
    { key: 'diversity', label: 'Diversity' },
    { key: 'waterEfficiency', label: 'Water Fit' },
    { key: 'nitrogenAndNutrientBalance', label: 'N Balance' },
    { key: 'soilHealth', label: 'Soil Health' },
    { key: 'seasonalAndRegionalFit', label: 'Season Fit' },
    { key: 'pestBreakAndRisk', label: 'Pest Break' },
  ];

  const data = dimensions.map((dim) => {
    const row: Record<string, string | number> = { dimension: dim.label };
    for (const s of strategies) {
      row[s.strategyId] = s.subScores[dim.key];
    }
    return row;
  });

  const palette: Record<string, string> = {
    existing: '#64748b',
    alternative_a: '#059669',
    alternative_b: '#0284c7',
    user_defined: '#d97706',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Multi-Indicator Strategy Comparison (0–100 Sub-Scores)
        </h3>
        <span className="text-[11px] text-slate-500">
          Deterministic indicator index (higher = stronger agronomic alignment)
        </span>
      </div>
      <div className="mt-3 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="dimension" tick={{ fontSize: 11, fill: '#334155' }} stroke="#cbd5e1" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" />
            <Tooltip cursor={{ fill: '#f1f5f9' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {strategies.map((s) => (
              <Bar
                key={s.strategyId}
                dataKey={s.strategyId}
                name={s.label}
                fill={palette[s.strategyId] ?? '#334155'}
                radius={[3, 3, 0, 0]}
                barSize={16}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CropFamilySequenceStrip({ strategy }: { strategy: RotationStrategyEvaluation }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Botanical Family Sequence &amp; Legume Break Visualization
        </h3>
        <span className="text-xs text-slate-600">
          {strategy.indicators.cropDiversity.uniqueFamiliesCount} distinct families ·{' '}
          {strategy.indicators.cropDiversity.legumeSlotsCount}/{strategy.slots.length} N-fixing
          seasons · {strategy.indicators.cropDiversity.consecutiveFamilyRepeats} consecutive family
          repeats
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {strategy.slots.map((slot) => {
          const familyTone =
            slot.cropFamily === 'Fabaceae'
              ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900'
              : slot.cropFamily === 'Poaceae'
                ? 'border-amber-300 bg-amber-50/60 text-amber-900'
                : slot.cropFamily === 'Brassicaceae'
                  ? 'border-sky-300 bg-sky-50/60 text-sky-900'
                  : 'border-slate-200 bg-slate-50 text-slate-800';

          return (
            <div key={slot.slotIndex} className={`rounded-md border p-3 text-xs ${familyTone}`}>
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="font-semibold">
                  Y{slot.year} {slot.season}
                </span>
                <span>{slot.cropFamily}</span>
              </div>
              <div className="mt-1 font-semibold text-sm">{slot.cropName}</div>
              <div className="mt-1 text-[11px] opacity-85">
                {slot.fixesNitrogen ? 'Fixes Atmospheric N' : `${slot.cropGroup} (N Consumer)`}
                {slot.transitionFromPrevious?.familyRepeated ? ' · Family Repeated' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
