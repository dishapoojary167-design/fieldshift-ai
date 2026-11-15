import type {
  CropSuitabilityOption,
  EcostressEvapotranspirationObservation,
  EcostressObservationQualityStatus,
  EcostressResultPayload,
  HlsObservationQualityStatus,
  HlsProductId,
  HlsResultPayload,
  HlsSurfaceReflectanceObservation,
  SupportingEnvironmentalObservation,
} from '../../../shared/index.ts';

export const ENVIRONMENTAL_STALE_DAYS_THRESHOLD = 45;

export interface EnvironmentalTrendPoint {
  id: string;
  date: string;
  timestamp: string;
  value: number;
  productId: string;
  sensorLabel: string;
  qualityStatus: string;
  coveragePercent: number | null;
  isStale: boolean;
}

export interface LatestEcostressView {
  latestEtWm2: number | null;
  etObservationDate: string | null;
  etRetrievalDate: string | null;
  etProductId: string | null;
  etCoveragePercent: number | null;
  etQualityStatus: EcostressObservationQualityStatus | null;
  etIsStale: boolean;
  latestEsiRatio: number | null;
  esiObservationDate: string | null;
  esiRetrievalDate: string | null;
  esiProductId: string | null;
  esiCoveragePercent: number | null;
  esiQualityStatus: EcostressObservationQualityStatus | null;
  esiIsStale: boolean;
  meanEtWm2: number | null;
  meanEsiRatio: number | null;
  meanCoveragePercent: number | null;
  totalObservations: number;
  clearSkyObservations: number;
  cloudMaskedObservations: number;
  waterMaskedObservations: number;
  staleObservations: number;
}

export interface LatestHlsView {
  latestNdvi: number | null;
  ndviAcquisitionDate: string | null;
  ndviRetrievalDate: string | null;
  ndviProductId: HlsProductId | null;
  ndviSensorLabel: string | null;
  ndviCoveragePercent: number | null;
  ndviQualityStatus: HlsObservationQualityStatus | null;
  ndviIsStale: boolean;
  latestNdwi: number | null;
  ndwiAcquisitionDate: string | null;
  ndwiProductId: HlsProductId | null;
  ndwiSensorLabel: string | null;
  ndwiCoveragePercent: number | null;
  ndwiQualityStatus: HlsObservationQualityStatus | null;
  ndwiIsStale: boolean;
  meanNdvi: number | null;
  minNdvi: number | null;
  maxNdvi: number | null;
  meanNdwi: number | null;
  meanCoveragePercent: number | null;
  totalObservations: number;
  clearSkyObservations: number;
  cloudMaskedObservations: number;
  shadowMaskedObservations: number;
  waterMaskedObservations: number;
  staleObservations: number;
}

export function isTimestampStale(
  timestamp: string | null | undefined,
  explicitStale = false,
  referenceNowMs = Date.now(),
  thresholdDays = ENVIRONMENTAL_STALE_DAYS_THRESHOLD,
): boolean {
  if (explicitStale) return true;
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const ageDays = (referenceNowMs - parsed) / 86_400_000;
  return ageDays > thresholdDays;
}

export function formatUtcTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  if (iso.length >= 16 && iso.includes('T')) {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }
  return iso.slice(0, 10);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  return iso.slice(0, 10);
}

export function formatHlsSensorName(productId: HlsProductId | string): string {
  if (productId === 'HLSL30.002') return 'Landsat 8/9 OLI (HLSL30)';
  if (productId === 'HLSS30.002') return 'Sentinel-2 MSI (HLSS30)';
  return productId;
}

export function formatQualityLabel(
  status: EcostressObservationQualityStatus | HlsObservationQualityStatus | string | null | undefined,
): string {
  switch (status) {
    case 'valid':
      return 'Clear Sky / Valid';
    case 'cloud_masked':
      return 'Cloud Masked';
    case 'shadow_masked':
      return 'Shadow Masked';
    case 'water_masked':
      return 'Water Masked';
    case 'stale':
      return 'Stale Observation';
    case 'invalid_data':
      return 'Invalid / Rejected';
    case 'missing_data':
      return 'Unavailable / NoData';
    default:
      return 'Unknown';
  }
}

function isUsableNumber(val: number | null | undefined): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

export function sortEcostressObservationsChronological(
  observations: EcostressEvapotranspirationObservation[],
): EcostressEvapotranspirationObservation[] {
  return [...observations].sort((a, b) =>
    a.observationTimestamp.localeCompare(b.observationTimestamp),
  );
}

export function sortHlsObservationsChronological(
  observations: HlsSurfaceReflectanceObservation[],
): HlsSurfaceReflectanceObservation[] {
  return [...observations].sort((a, b) =>
    a.observationTimestamp.localeCompare(b.observationTimestamp),
  );
}

export function extractLatestEcostressView(
  payload: EcostressResultPayload | null,
  referenceNowMs = Date.now(),
): LatestEcostressView | null {
  if (!payload) return null;
  const sorted = sortEcostressObservationsChronological(payload.observations);

  const validEtObs = sorted.filter(
    (o) =>
      isUsableNumber(o.etDailyWm2) &&
      o.cloudMaskFlag !== 1 &&
      o.waterMaskFlag !== 1 &&
      o.qualityStatus !== 'cloud_masked' &&
      o.qualityStatus !== 'water_masked' &&
      o.qualityStatus !== 'invalid_data' &&
      o.qualityStatus !== 'missing_data',
  );
  const chosenEt = validEtObs.at(-1) ?? null;

  const validEsiObs = sorted.filter(
    (o) =>
      isUsableNumber(o.esiRatio) &&
      o.cloudMaskFlag !== 1 &&
      o.waterMaskFlag !== 1 &&
      o.qualityStatus !== 'cloud_masked' &&
      o.qualityStatus !== 'water_masked' &&
      o.qualityStatus !== 'invalid_data' &&
      o.qualityStatus !== 'missing_data',
  );
  const chosenEsi = validEsiObs.at(-1) ?? null;

  return {
    latestEtWm2: chosenEt?.etDailyWm2 ?? payload.summary.latestEtDailyWm2 ?? null,
    etObservationDate: chosenEt?.observationTimestamp ?? null,
    etRetrievalDate: chosenEt?.retrievalTimestamp ?? payload.retrievedAt,
    etProductId: chosenEt?.productId ?? null,
    etCoveragePercent: chosenEt?.coveragePercent ?? null,
    etQualityStatus: chosenEt?.qualityStatus ?? null,
    etIsStale: chosenEt
      ? isTimestampStale(chosenEt.observationTimestamp, chosenEt.isStale, referenceNowMs)
      : false,
    latestEsiRatio: chosenEsi?.esiRatio ?? payload.summary.latestEsiRatio ?? null,
    esiObservationDate: chosenEsi?.observationTimestamp ?? null,
    esiRetrievalDate: chosenEsi?.retrievalTimestamp ?? payload.retrievedAt,
    esiProductId: chosenEsi?.productId ?? null,
    esiCoveragePercent: chosenEsi?.coveragePercent ?? null,
    esiQualityStatus: chosenEsi?.qualityStatus ?? null,
    esiIsStale: chosenEsi
      ? isTimestampStale(chosenEsi.observationTimestamp, chosenEsi.isStale, referenceNowMs)
      : false,
    meanEtWm2: payload.summary.meanEtDailyWm2,
    meanEsiRatio: payload.summary.meanEsiRatio,
    meanCoveragePercent: payload.summary.meanCoveragePercent,
    totalObservations: payload.summary.totalObservations,
    clearSkyObservations: payload.summary.clearSkyObservations,
    cloudMaskedObservations: payload.summary.cloudMaskedObservations,
    waterMaskedObservations: payload.summary.waterMaskedObservations,
    staleObservations: payload.summary.staleObservations,
  };
}

export function extractLatestHlsView(
  payload: HlsResultPayload | null,
  referenceNowMs = Date.now(),
): LatestHlsView | null {
  if (!payload) return null;
  const sorted = sortHlsObservationsChronological(payload.observations);

  const validNdviObs = sorted.filter(
    (o) =>
      isUsableNumber(o.ndvi) &&
      o.cloudMaskFlag !== 1 &&
      o.shadowMaskFlag !== 1 &&
      o.waterMaskFlag !== 1 &&
      o.qualityStatus !== 'cloud_masked' &&
      o.qualityStatus !== 'shadow_masked' &&
      o.qualityStatus !== 'water_masked' &&
      o.qualityStatus !== 'invalid_data' &&
      o.qualityStatus !== 'missing_data',
  );
  const chosenNdvi = validNdviObs.at(-1) ?? null;

  const validNdwiObs = sorted.filter(
    (o) =>
      isUsableNumber(o.ndwi) &&
      o.cloudMaskFlag !== 1 &&
      o.shadowMaskFlag !== 1 &&
      o.waterMaskFlag !== 1 &&
      o.qualityStatus !== 'cloud_masked' &&
      o.qualityStatus !== 'shadow_masked' &&
      o.qualityStatus !== 'water_masked' &&
      o.qualityStatus !== 'invalid_data' &&
      o.qualityStatus !== 'missing_data',
  );
  const chosenNdwi = validNdwiObs.at(-1) ?? null;

  return {
    latestNdvi: chosenNdvi?.ndvi ?? payload.summary.latestNdvi ?? null,
    ndviAcquisitionDate: chosenNdvi?.observationTimestamp ?? null,
    ndviRetrievalDate: chosenNdvi?.retrievalTimestamp ?? payload.retrievedAt,
    ndviProductId: chosenNdvi?.productId ?? null,
    ndviSensorLabel: chosenNdvi ? formatHlsSensorName(chosenNdvi.productId) : null,
    ndviCoveragePercent: chosenNdvi?.coveragePercent ?? null,
    ndviQualityStatus: chosenNdvi?.qualityStatus ?? null,
    ndviIsStale: chosenNdvi
      ? isTimestampStale(chosenNdvi.observationTimestamp, chosenNdvi.isStale, referenceNowMs)
      : false,
    latestNdwi: chosenNdwi?.ndwi ?? payload.summary.latestNdwi ?? null,
    ndwiAcquisitionDate: chosenNdwi?.observationTimestamp ?? null,
    ndwiProductId: chosenNdwi?.productId ?? null,
    ndwiSensorLabel: chosenNdwi ? formatHlsSensorName(chosenNdwi.productId) : null,
    ndwiCoveragePercent: chosenNdwi?.coveragePercent ?? null,
    ndwiQualityStatus: chosenNdwi?.qualityStatus ?? null,
    ndwiIsStale: chosenNdwi
      ? isTimestampStale(chosenNdwi.observationTimestamp, chosenNdwi.isStale, referenceNowMs)
      : false,
    meanNdvi: payload.summary.meanNdvi,
    minNdvi: payload.summary.minNdvi,
    maxNdvi: payload.summary.maxNdvi,
    meanNdwi: payload.summary.meanNdwi,
    meanCoveragePercent: payload.summary.meanCoveragePercent,
    totalObservations: payload.summary.totalObservations,
    clearSkyObservations: payload.summary.clearSkyObservations,
    cloudMaskedObservations: payload.summary.cloudMaskedObservations,
    shadowMaskedObservations: payload.summary.shadowMaskedObservations,
    waterMaskedObservations: payload.summary.waterMaskedObservations,
    staleObservations: payload.summary.staleObservations,
  };
}

export function buildNdviSeries(
  payload: HlsResultPayload | null,
  referenceNowMs = Date.now(),
): EnvironmentalTrendPoint[] {
  if (!payload) return [];
  return sortHlsObservationsChronological(payload.observations)
    .filter(
      (o) =>
        isUsableNumber(o.ndvi) &&
        o.cloudMaskFlag !== 1 &&
        o.shadowMaskFlag !== 1 &&
        o.waterMaskFlag !== 1 &&
        o.qualityStatus !== 'cloud_masked' &&
        o.qualityStatus !== 'shadow_masked' &&
        o.qualityStatus !== 'water_masked' &&
        o.qualityStatus !== 'invalid_data' &&
        o.qualityStatus !== 'missing_data',
    )
    .map((o, idx) => ({
      id: `${o.productId}-${o.observationTimestamp}-${idx}`,
      date: formatShortDate(o.observationTimestamp),
      timestamp: o.observationTimestamp,
      value: o.ndvi as number,
      productId: o.productId,
      sensorLabel: formatHlsSensorName(o.productId),
      qualityStatus: o.qualityStatus,
      coveragePercent: o.coveragePercent,
      isStale: isTimestampStale(o.observationTimestamp, o.isStale, referenceNowMs),
    }));
}

export function buildNdwiSeries(
  payload: HlsResultPayload | null,
  referenceNowMs = Date.now(),
): EnvironmentalTrendPoint[] {
  if (!payload) return [];
  return sortHlsObservationsChronological(payload.observations)
    .filter(
      (o) =>
        isUsableNumber(o.ndwi) &&
        o.cloudMaskFlag !== 1 &&
        o.shadowMaskFlag !== 1 &&
        o.waterMaskFlag !== 1 &&
        o.qualityStatus !== 'cloud_masked' &&
        o.qualityStatus !== 'shadow_masked' &&
        o.qualityStatus !== 'water_masked' &&
        o.qualityStatus !== 'invalid_data' &&
        o.qualityStatus !== 'missing_data',
    )
    .map((o, idx) => ({
      id: `${o.productId}-${o.observationTimestamp}-${idx}`,
      date: formatShortDate(o.observationTimestamp),
      timestamp: o.observationTimestamp,
      value: o.ndwi as number,
      productId: o.productId,
      sensorLabel: formatHlsSensorName(o.productId),
      qualityStatus: o.qualityStatus,
      coveragePercent: o.coveragePercent,
      isStale: isTimestampStale(o.observationTimestamp, o.isStale, referenceNowMs),
    }));
}

export function buildEtSeries(
  payload: EcostressResultPayload | null,
  referenceNowMs = Date.now(),
): EnvironmentalTrendPoint[] {
  if (!payload) return [];
  return sortEcostressObservationsChronological(payload.observations)
    .filter(
      (o) =>
        isUsableNumber(o.etDailyWm2) &&
        o.cloudMaskFlag !== 1 &&
        o.waterMaskFlag !== 1 &&
        o.qualityStatus !== 'cloud_masked' &&
        o.qualityStatus !== 'water_masked' &&
        o.qualityStatus !== 'invalid_data' &&
        o.qualityStatus !== 'missing_data',
    )
    .map((o, idx) => ({
      id: `${o.productId}-${o.observationTimestamp}-${idx}`,
      date: formatShortDate(o.observationTimestamp),
      timestamp: o.observationTimestamp,
      value: o.etDailyWm2 as number,
      productId: o.productId,
      sensorLabel: 'ECOSTRESS ECO_L3T_JET (70m)',
      qualityStatus: o.qualityStatus,
      coveragePercent: o.coveragePercent,
      isStale: isTimestampStale(o.observationTimestamp, o.isStale, referenceNowMs),
    }));
}

export function buildEsiSeries(
  payload: EcostressResultPayload | null,
  referenceNowMs = Date.now(),
): EnvironmentalTrendPoint[] {
  if (!payload) return [];
  return sortEcostressObservationsChronological(payload.observations)
    .filter(
      (o) =>
        isUsableNumber(o.esiRatio) &&
        o.cloudMaskFlag !== 1 &&
        o.waterMaskFlag !== 1 &&
        o.qualityStatus !== 'cloud_masked' &&
        o.qualityStatus !== 'water_masked' &&
        o.qualityStatus !== 'invalid_data' &&
        o.qualityStatus !== 'missing_data',
    )
    .map((o, idx) => ({
      id: `${o.productId}-${o.observationTimestamp}-${idx}`,
      date: formatShortDate(o.observationTimestamp),
      timestamp: o.observationTimestamp,
      value: o.esiRatio as number,
      productId: o.productId,
      sensorLabel: 'ECOSTRESS ECO_L4T_ESI (70m)',
      qualityStatus: o.qualityStatus,
      coveragePercent: o.coveragePercent,
      isStale: isTimestampStale(o.observationTimestamp, o.isStale, referenceNowMs),
    }));
}

export function areDatesDistinct(dateA: string | null, dateB: string | null): boolean {
  if (!dateA || !dateB) return false;
  return formatShortDate(dateA) !== formatShortDate(dateB);
}

const ENVIRONMENTAL_EVIDENCE_PARAMS = [
  { parameter: 'etDailyWm2', fallbackLabel: 'ECOSTRESS Daily ET' },
  { parameter: 'esiRatio', fallbackLabel: 'ECOSTRESS ESI' },
  { parameter: 'ndvi', fallbackLabel: 'Landsat/HLS NDVI' },
  { parameter: 'ndwi', fallbackLabel: 'Landsat/HLS NDWI' },
] as const;

export function buildCardEnvironmentalEvidence(crop: CropSuitabilityOption): {
  satelliteItems: Array<{
    parameter: string;
    label: string;
    observedValue: string;
    status: 'available' | 'missing';
    sourceLabel: string;
    datasetId?: string;
    spatialResolution?: string;
    observationTimestamp?: string;
    note?: string;
  }>;
  warnings: string[];
  sources: Array<{
    id: string;
    name: string;
    dataset: string;
    spatialResolution: string;
    observationDate?: string;
  }>;
} {
  const obsByParam = new Map<string, SupportingEnvironmentalObservation>(
    crop.supportingObservations.map((o) => [o.parameter, o]),
  );

  const satelliteItems = ENVIRONMENTAL_EVIDENCE_PARAMS.map(({ parameter, fallbackLabel }) => {
    const obs = obsByParam.get(parameter);
    if (!obs) {
      return {
        parameter,
        label: fallbackLabel,
        observedValue: 'Unavailable',
        status: 'missing' as const,
        sourceLabel: 'Unavailable',
      };
    }
    const noteParts = [obs.stalenessNote, obs.representativenessNote].filter(Boolean);
    return {
      parameter,
      label: obs.label,
      observedValue: obs.observedValue,
      status: obs.status,
      sourceLabel: obs.sourceLabel,
      datasetId: obs.datasetId,
      spatialResolution: obs.spatialResolution,
      observationTimestamp: obs.observationTimestamp ?? obs.observationPeriod,
      note: noteParts.length > 0 ? noteParts.join(' · ') : undefined,
    };
  });

  const warningSet = new Set<string>();
  for (const w of crop.missingOrUncertainInputs ?? []) warningSet.add(w);
  for (const w of crop.missingDataWarnings) warningSet.add(w);
  for (const item of satelliteItems) {
    if (item.status === 'missing') {
      warningSet.add(`${item.label} observation is unavailable for this parcel.`);
    } else if (item.note && /stale|cloud|mask|coarse|lag/i.test(item.note)) {
      warningSet.add(`${item.label}: ${item.note}`);
    }
  }

  const sources = (crop.dataSourcesUsed ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    dataset: s.dataset,
    spatialResolution: s.spatialResolution,
    observationDate: s.observationDate,
  }));

  return {
    satelliteItems,
    warnings: Array.from(warningSet),
    sources,
  };
}
