import type { EngineState, RulePack } from '../runtime/model.js';
import { checkDayRoots } from './day-survival.js';
import type { PolicyCandidates } from './position.js';
import { nextPolicyStep, searchPolicy, type PolicyNode } from './policy-search.js';

export type { PolicyNode as DayPolicy, PolicyAdvice } from './policy-search.js';

export function nextDayPolicy(node: PolicyNode, state: EngineState) {
  if (state.phase === 'protagonist-abilities' && state.pending?.actor === state.captain)
    return nextPolicyStep(node, state);
}

export function findDayPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  target: string,
  maxAbilities: number,
  workLimit: number,
) {
  if (!Number.isSafeInteger(maxAbilities) || maxAbilities < 0) throw Error('Invalid policy limits');
  checkDayRoots(pack, candidates, target);
  const root = candidates.states[0];
  return searchPolicy(pack, candidates, workLimit, {
    maxAbilities,
    traceDeaths: true,
    controls: (s) => s.phase === 'protagonist-abilities' && s.pending?.actor === root?.captain,
    choices: (states) => states[0]!.pending!.options,
    outcome(s, audit) {
      for (let i = audit; i < s.audit.length; i++)
        if (s.audit[i]!.kind === 'character-died' && s.audit[i]!.data === target) return 'lose';
      if (s.characters[target]!.status !== 'alive') return 'lose';
      if (s.winner || s.loop !== root!.loop || s.day !== root!.day || s.phase === 'loop-end')
        return 'win';
    },
  });
}
