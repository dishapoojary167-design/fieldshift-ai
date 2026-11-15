export { ActionRecommendationEngine } from './ActionRecommendationEngine.ts';
export {
  FarmLevelIntelligenceService,
  PHASE5_INTELLIGENCE_ENGINE_VERSION,
  type EvaluateFarmIntelligenceParams,
} from './FarmLevelIntelligenceService.ts';
export {
  PREDICTIVE_ENGINE_VERSION,
  PredictiveInsightsEngine,
} from './PredictiveInsightsEngine.ts';

import type { Phase5FarmIntelligence } from '../../shared/index.ts';
import {
  FarmLevelIntelligenceService,
  type EvaluateFarmIntelligenceParams,
} from './FarmLevelIntelligenceService.ts';

export function runPhase5FarmIntelligence(
  params: EvaluateFarmIntelligenceParams,
): Phase5FarmIntelligence {
  const service = new FarmLevelIntelligenceService();
  return service.evaluate(params);
}
