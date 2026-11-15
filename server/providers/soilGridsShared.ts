import type { SoilDepthInterval, SoilDepthLayer, SoilMeasurementStats } from '../../shared/index.ts';
import { classifyUsdaSoilTexture } from '../utils/soilTexture.ts';

export const SOILGRIDS_DEPTHS: readonly {
  interval: SoilDepthInterval;
  label: '0-5cm' | '5-15cm' | '15-30cm' | '30-60cm';
  topCm: number;
  bottomCm: number;
}[] = [
  { interval: '0-5', label: '0-5cm', topCm: 0, bottomCm: 5 },
  { interval: '5-15', label: '5-15cm', topCm: 5, bottomCm: 15 },
  { interval: '15-30', label: '15-30cm', topCm: 15, bottomCm: 30 },
  { interval: '30-60', label: '30-60cm', topCm: 30, bottomCm: 60 },
];

export type SoilGridsPropertyName =
  | 'phh2o'
  | 'soc'
  | 'nitrogen'
  | 'sand'
  | 'silt'
  | 'clay'
  | 'bdod'
  | 'cec';

export interface SoilGridsPropertyMeta {
  name: SoilGridsPropertyName;
  dFactor: number;
  unit: string;
  decimals: number;
}

export const SOILGRIDS_PROPERTY_META: Record<SoilGridsPropertyName, SoilGridsPropertyMeta> = {
  phh2o: { name: 'phh2o', dFactor: 10, unit: 'pH', decimals: 1 },
  soc: { name: 'soc', dFactor: 10, unit: 'g/kg', decimals: 1 },
  nitrogen: { name: 'nitrogen', dFactor: 100, unit: 'g/kg', decimals: 2 },
  sand: { name: 'sand', dFactor: 10, unit: '%', decimals: 1 },
  silt: { name: 'silt', dFactor: 10, unit: '%', decimals: 1 },
  clay: { name: 'clay', dFactor: 10, unit: '%', decimals: 1 },
  bdod: { name: 'bdod', dFactor: 100, unit: 'kg/dm³', decimals: 2 },
  cec: { name: 'cec', dFactor: 10, unit: 'cmol(c)/kg', decimals: 1 },
};

export function createEmptyStat(unit: string): SoilMeasurementStats {
  return {
    mean: null,
    q05: null,
    q95: null,
    uncertainty: null,
    unit,
  };
}

export function scaleSoilGridsValue(
  raw: number | null | undefined,
  dFactor: number,
  decimals: number,
): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= -32768) {
    return null;
  }
  const scaled = raw / dFactor;
  return Number(scaled.toFixed(decimals));
}

export function createEmptyDepthLayer(
  interval: SoilDepthInterval,
  topDepthCm: number,
  bottomDepthCm: number,
): SoilDepthLayer {
  return {
    depthIntervalCm: interval,
    topDepthCm,
    bottomDepthCm,
    ph: createEmptyStat('pH'),
    organicCarbonGKg: createEmptyStat('g/kg'),
    nitrogenGKg: createEmptyStat('g/kg'),
    sandPercent: createEmptyStat('%'),
    siltPercent: createEmptyStat('%'),
    clayPercent: createEmptyStat('%'),
    bulkDensityKgDm3: createEmptyStat('kg/dm³'),
    cecCmolKg: createEmptyStat('cmol(c)/kg'),
    textureClass: null,
  };
}

export function finalizeDepthLayers(layers: SoilDepthLayer[]): {
  layers: SoilDepthLayer[];
  hasAnySoilData: boolean;
  isComplete: boolean;
} {
  let validMetricCount = 0;
  const totalExpectedMetrics = layers.length * 8;

  const finalized = layers.map((layer) => {
    // SoilGrids encodes masked ocean/water/urban cells as 0 across all physical layers
    const maskedPixel =
      (layer.ph.mean === null || layer.ph.mean === 0) &&
      (layer.bulkDensityKgDm3.mean === null || layer.bulkDensityKgDm3.mean === 0) &&
      (layer.sandPercent.mean ?? 0) + (layer.siltPercent.mean ?? 0) + (layer.clayPercent.mean ?? 0) === 0;

    if (maskedPixel) {
      return createEmptyDepthLayer(layer.depthIntervalCm, layer.topDepthCm, layer.bottomDepthCm);
    }

    const metrics: SoilMeasurementStats[] = [
      layer.ph,
      layer.organicCarbonGKg,
      layer.nitrogenGKg,
      layer.sandPercent,
      layer.siltPercent,
      layer.clayPercent,
      layer.bulkDensityKgDm3,
      layer.cecCmolKg,
    ];

    for (const metric of metrics) {
      if (metric.mean !== null) {
        validMetricCount += 1;
      }
    }

    const textureClass = classifyUsdaSoilTexture(
      layer.sandPercent.mean,
      layer.siltPercent.mean,
      layer.clayPercent.mean,
    );

    return {
      ...layer,
      textureClass,
    };
  });

  return {
    layers: finalized,
    hasAnySoilData: validMetricCount > 0,
    isComplete: validMetricCount === totalExpectedMetrics,
  };
}
