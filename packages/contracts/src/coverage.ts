import type { PolicyNode } from './decision.js';
export interface CoverageResult {
  status: 'optimal' | 'bounded' | 'unknown' | 'no-candidates';
  scripts: number;
  lower: number;
  upper?: number;
  work: number;
  evaluations: number;
  reason?: 'incomplete' | 'unsupported' | 'limit';
  policy?: PolicyNode;
}
export interface CoverageCheck {
  scripts: number;
  verified: number;
  refuted: number;
  unresolved: number;
  work: number;
  exhaustive: boolean;
}
export type ScriptVerdict = 'verified' | 'refuted' | 'unresolved';
export interface CoverageComparison {
  relation:
    | 'equivalent'
    | 'left-superset'
    | 'right-superset'
    | 'incomparable'
    | 'unknown'
    | 'no-candidates';
  exhaustive: boolean;
  work: number;
  scripts: { script: number; left: ScriptVerdict; right: ScriptVerdict }[];
}
