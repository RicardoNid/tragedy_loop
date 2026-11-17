import type { PolicyView } from './decision.js';
import type { Choice, Protagonist } from './game.js';

export type InvestigationTarget =
  | { kind: 'identity'; character: string }
  | { kind: 'culprit'; day: number };
export type Hypothesis = { identity: string; reverseIdentity?: string } | { culprit: string };
export type InvestigationView =
  | { kind: 'prompt'; view: PolicyView }
  | { kind: 'boundary'; view: Omit<PolicyView, 'menu' | 'targets' | 'answerKind'> };
export type InvestigationPlan =
  | { kind: 'stop'; answers: Hypothesis[] }
  | {
      kind: 'act';
      choice: Choice;
      reportsBefore: number;
      responses: { when: InvestigationView; then: InvestigationPlan }[];
    };
export interface InvestigationOptions {
  target: InvestigationTarget;
  maxAbilities?: number;
  seat?: Protagonist;
}
export interface InvestigationResult {
  status: 'optimal' | 'unknown' | 'no-candidates';
  reason?: 'incomplete' | 'unsupported' | 'limit';
  work: number;
  answers?: Hypothesis[];
  /** Worst possible number of distinct answers left under this executable plan. */
  worstRemaining?: number;
  plan?: InvestigationPlan;
}
