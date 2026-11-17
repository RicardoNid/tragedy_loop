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
