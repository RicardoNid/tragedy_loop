import type { DecisionGoal } from '../../../contracts/src/decision.js';
import type { RulePack } from '../runtime/model.js';
import type { PolicyCandidates } from './position.js';
import { findDayPolicy } from './day-policy.js';
import { findWinningPolicy } from './game-policy.js';

export function solveGoal(
  pack: RulePack,
  candidates: PolicyCandidates,
  goal: DecisionGoal,
  workLimit: number,
  frontierLimit = 512,
) {
  switch (goal.kind) {
    case 'survival':
      return findDayPolicy(pack, candidates, goal.target, goal.maxAbilities ?? 2, workLimit);
    case 'seat-win':
      return findWinningPolicy(pack, candidates, workLimit, frontierLimit, goal.seat);
    case 'game':
      return findWinningPolicy(pack, candidates, workLimit, frontierLimit);
    default:
      throw Error('Invalid decision goal');
  }
}
