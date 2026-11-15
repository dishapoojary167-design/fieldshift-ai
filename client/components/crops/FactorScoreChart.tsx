import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CropFactorScore, CropSuitabilityOption } from '../../../shared/index.ts';

interface FactorScoreChartProps {
  factorScores: CropFactorScore[];
  cropName: string;
  height?: number;
}

function getScoreBarColor(score: number | null, status: CropFactorScore['status']): string {
  if (status === 'missing' || score === null) {
    return '#cbd5e1';
  }
  if (score >= 78) return '#059669';
  if (score >= 60) return '#0284c7';
  if (score >= 40) return '#d97706';
  return '#e11d48';
}

interface FactorChartDatum {
  label: string;
  score: number;
  rawScore: number | null;
  status: CropFactorScore['status'];
  effectiveWeightPct: number;
  observedValue: string;
  dataSource: string;
}

export function FactorScoreChart({
  factorScores,
  cropName,
  height = 280,
}: FactorScoreChartProps) {
  const data: FactorChartDatum[] = factorScores.map((f) => ({
    label: f.label,
    score: f.status === 'evaluated' && f.score !== null ? f.score : 0,
    rawScore: f.score,
    status: f.status,
    effectiveWeightPct: Math.round(f.effectiveWeight * 100),
    observedValue: f.observedValue,
    dataSource: f.dataSource.replaceAll('_', ' '),
  }));

  return (
    <div className="w-full" style={{ height }} aria-label={`Factor scores chart for ${cropName}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 6, right: 24, left: 16, bottom: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
          />
          <YAxis
            type="category"
            dataKey="label"
            width={118}
            tick={{ fontSize: 11, fill: '#334155' }}
            stroke="#cbd5e1"
          />
          <ReferenceLine x={60} stroke="#94a3b8" strokeDasharray="3 3" />
          <ReferenceLine x={78} stroke="#059669" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const item = payload[0].payload as FactorChartDatum;
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="font-semibold text-slate-900">{item.label}</div>
                  <div className="mt-1 font-mono tabular-nums text-slate-800">
                    {item.status === 'evaluated' && item.rawScore !== null
                      ? `Score: ${item.rawScore} / 100 · Weight: ${item.effectiveWeightPct}%`
                      : 'Status: Missing input (excluded from weighted average)'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    Observed: {item.observedValue} ({item.dataSource})
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="score" radius={[0, 3, 3, 0]} barSize={18}>
            {data.map((entry) => (
              <Cell
                key={entry.label}
                fill={getScoreBarColor(entry.rawScore, entry.status)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CropComparisonChartProps {
  recommendations: CropSuitabilityOption[];
  selectedCropId?: string;
  onSelectCrop?: (cropId: string) => void;
}

export function CropComparisonChart({
  recommendations,
  selectedCropId,
  onSelectCrop,
}: CropComparisonChartProps) {
  const topCrops = recommendations.slice(0, 8);
  const data = topCrops.map((crop) => ({
    cropId: crop.cropId,
    name: `#${crop.rank ?? '-'} ${crop.cropName}`,
    suitabilityScore: crop.suitabilityScore,
    confidenceScore: crop.dataConfidence.score,
    category: crop.suitabilityCategory,
  }));

  if (data.length === 0) {
    return null;
  }

  return (
    <div className="w-full h-72" aria-label="Ranked crop suitability comparison chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#334155' }}
            stroke="#cbd5e1"
            interval={0}
            angle={-15}
            textAnchor="end"
            height={48}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            stroke="#cbd5e1"
          />
          <ReferenceLine y={78} stroke="#059669" strokeDasharray="3 3" />
          <Tooltip
            cursor={{ fill: '#f1f5f9' }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const item = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="font-semibold text-slate-900">{item.name}</div>
                  <div className="mt-1 font-mono tabular-nums text-slate-800">
                    Suitability: {item.suitabilityScore} / 100 ({item.category})
                  </div>
                  <div className="font-mono tabular-nums text-slate-600">
                    Data Confidence: {item.confidenceScore}%
                  </div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="suitabilityScore"
            name="Suitability Score (0–100)"
            radius={[3, 3, 0, 0]}
            barSize={22}
            onClick={(entry) => {
              const cropId = (entry as unknown as { cropId?: string })?.cropId;
              if (cropId && onSelectCrop) {
                onSelectCrop(cropId);
              }
            }}
            className={onSelectCrop ? 'cursor-pointer' : undefined}
          >
            {data.map((entry) => (
              <Cell
                key={entry.cropId}
                fill={
                  entry.cropId === selectedCropId
                    ? '#1d4ed8'
                    : entry.suitabilityScore >= 78
                      ? '#059669'
                      : '#0284c7'
                }
              />
            ))}
          </Bar>
          <Bar
            dataKey="confidenceScore"
            name="Data Confidence (%)"
            fill="#94a3b8"
            radius={[3, 3, 0, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
