export {
  DEFAULT_MIN_COVERAGE_PERCENT,
  DEFAULT_STALE_DAYS_THRESHOLD,
  EnvironmentalDataQualityValidator,
  isFillValueCheck,
  normalizeProductsList,
  type DataQualityValidationOptions,
} from './EnvironmentalDataQualityValidator.ts';
export {
  DEFAULT_MIN_TREND_OBSERVATIONS,
  DEFAULT_MIN_TREND_SPAN_DAYS,
  MultiTemporalAnalyzer,
  type MultiTemporalAnalyzerOptions,
} from './MultiTemporalAnalyzer.ts';
export {
  DEFAULT_MONITORING_THRESHOLDS,
  EnvironmentalStressDetector,
} from './EnvironmentalStressDetector.ts';
export {
  EnvironmentalIntelligenceEngine,
  type EnvironmentalIntelligenceOptions,
} from './EnvironmentalIntelligenceEngine.ts';
export {
  EnvironmentalAlertMonitor,
  PHASE4_ANALYTICS_ENGINE_VERSION,
} from './EnvironmentalAlertMonitor.ts';

import type {
  EcostressResultPayload,
  HlsResultPayload,
  MonitoringThresholdsConfig,
  Phase4EnvironmentalAnalytics,
} from '../../shared/index.ts';
import { EnvironmentalIntelligenceEngine } from './EnvironmentalIntelligenceEngine.ts';

export function runPhase4EnvironmentalAnalytics(params: {
  ecostressPayload?: EcostressResultPayload | null;
  hlsPayload?: HlsResultPayload | null;
  thresholds?: Partial<MonitoringThresholdsConfig>;
  referenceNowMs?: number;
}): Phase4EnvironmentalAnalytics {
  const engine = new EnvironmentalIntelligenceEngine({
    thresholds: params.thresholds,
    referenceNowMs: params.referenceNowMs,
  });
  return engine.evaluate(params);
}
