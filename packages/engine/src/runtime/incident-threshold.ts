import type { Counters } from '../../../contracts/src/game.js';
import { COUNTERS, type IncidentDefinition } from './model.js';
import { characterCounter } from './expressions.js';

export function incidentThreshold(
  limit: number,
  character: string,
  definition: IncidentDefinition,
) {
  return limit + (definition.thresholdOffset ?? 0) * (character === '教主' ? 2 : 1);
}

/** The counter designated by an incident has priority over world and identity
 * substitutions. This quantity alone does not decide whether an incident occurs. */
export function incidentPressure(
  c: Counters,
  character: string,
  definition: IncidentDefinition,
  alternateWorld: boolean,
  addIntrigue: boolean,
) {
  const counter = definition.thresholdCounter ?? (alternateWorld ? 'goodwill' : 'paranoia');
  if (counter !== 'paranoia') return characterCounter(c, counter);
  if (character === 'AI') return COUNTERS.reduce((sum, k) => sum + c[k], 0);
  return characterCounter(c, counter) + (addIntrigue ? c.intrigue : 0);
}
