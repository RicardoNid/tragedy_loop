import type { DecisionGoal } from '../../../contracts/src/decision.js';
import type { Choice } from '../../../contracts/src/game.js';
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
  opening?: Choice,
) {
  switch (goal.kind) {
    case 'survival':
      return findDayPolicy(
        pack,
        candidates,
        goal.target,
        goal.maxAbilities ?? 2,
        workLimit,
        opening,
      );
    case 'seat-win':
      return findWinningPolicy(
        pack,
        candidates,
        workLimit,
        frontierLimit,
        goal.seat,
        undefined,
        opening,
      );
    case 'game':
      return findWinningPolicy(
        pack,
        candidates,
        workLimit,
        frontierLimit,
        undefined,
        undefined,
        opening,
      );
    default:
      throw Error('Invalid decision goal');
  }
}
