import type { Choice } from '../../../contracts/src/game.js';
import { drive } from '../runtime/engine.js';
import { canonical, clone, type EngineState, type RulePack } from '../runtime/model.js';
import {
  checkDayRoots,
  dayMenuView,
  dayRulesSupported,
  submitDayChoice,
  type DayCandidates,
} from './day-survival.js';

type View = ReturnType<typeof dayMenuView>;
export interface DayPolicy {
  choice: Choice;
  /** Observer-local cursor at the moment of issuing choice. */
  reportsBefore: number;
  responses: { when: View; then: DayPolicy }[];
}
export interface PolicyAdvice {
  status: 'guaranteed' | 'no-guaranteed-policy' | 'unknown' | 'no-candidates';
  work: number;
  reason?: 'limit' | 'unsupported' | 'incomplete';
  policy?: DayPolicy;
}
type Branch = { state: EngineState; audit: number };
type Outcome = 'lose' | 'unsupported' | 'limit';

/** Follow the returned tree at the next captain prompt using only the visible change
 * since the previous command. Opponent decisions never occur in the policy. */
export function nextDayPolicy(node: DayPolicy, state: EngineState) {
  if (state.phase !== 'protagonist-abilities' || state.pending?.actor !== state.captain)
    return undefined;
  const key = canonical(dayMenuView(state, node.reportsBefore));
  return node.responses.find((r) => canonical(r.when) === key)?.then;
}

export function findDayPolicy(
  pack: RulePack,
  candidates: DayCandidates,
  target: string,
  maxAbilities: number,
  workLimit: number,
): PolicyAdvice {
  if (![maxAbilities, workLimit].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw Error('Invalid policy limits');
  checkDayRoots(pack, candidates, target);
  if (!candidates.exhaustive) return { status: 'unknown', reason: 'incomplete', work: 0 };
  const root = candidates.states[0];
  if (!root) return { status: 'no-candidates', work: 0 };
  if (candidates.states.some((s) => !dayRulesSupported(pack, s)))
    return { status: 'unknown', reason: 'unsupported', work: 0 };
  const { loop, day, captain } = root;
  let work = 0;

  function apply(branch: Branch, choice: Choice): Branch | 'unsupported' | 'limit' {
    if (work >= workLimit) return 'limit';
    work++;
    const r = submitDayChoice(pack, branch.state, choice);
    return r.status === 'rejected' ? 'unsupported' : { state: r.state, audit: branch.audit };
  }
  type Group = { when: View; branches: Branch[] };
  // On a given action, any losing continuation refutes the action. All other live
  // continuations must be grouped before deciding what the captain will do next.
  function expand(input: Branch[], choice: Choice, since: number): Group[] | Outcome {
    const groups = new Map<string, Group>();
    const pending: Branch[] = [];
    for (const b of input) {
      const next = apply(b, choice);
      if (typeof next === 'string') return next;
      pending.push(next);
    }
    while (pending.length) {
      const b = pending.pop()!;
      const s = b.state;
      for (;;) {
        for (; b.audit < s.audit.length; b.audit++)
          if (s.audit[b.audit]!.kind === 'character-died' && s.audit[b.audit]!.data === target)
            return 'lose';
        if (s.diagnostic) return 'unsupported';
        if (s.characters[target]!.status !== 'alive') return 'lose';
        if (s.winner || s.loop !== loop || s.day !== day || s.phase === 'loop-end') break;
        const d = s.pending;
        if (!d) {
          if (work >= workLimit) return 'limit';
          work++;
          drive(pack, s, 1);
          continue;
        }
        if (!d.options.length) return 'unsupported';
        if (s.phase === 'protagonist-abilities' && d.actor === captain) {
          const when = dayMenuView(s, since);
          const key = canonical(when);
          const group = groups.get(key);
          if (group) group.branches.push(b);
          else groups.set(key, { when, branches: [b] });
        } else {
          for (const c of d.options) {
            const next = apply(b, c);
            if (typeof next === 'string') return next;
            pending.push(next);
          }
        }
        break;
      }
    }
    return [...groups.values()];
  }

  function decide(branches: Branch[], abilities: number, depth: number): DayPolicy | Outcome {
    // Protect the JS stack even when a caller supplies an arbitrarily large budget.
    if (depth >= 128) return 'limit';
    const s = branches[0]!.state;
    const reportsBefore = s.observations.protagonists.length;
    let unresolved: Outcome = 'lose';
    for (const choice of s.pending!.options) {
      const cost = Number(choice.kind === 'ability');
      if (cost > abilities) continue;
      const groups = expand(branches, choice, reportsBefore);
      if (typeof groups === 'string') {
        if (groups === 'limit') return groups;
        if (groups !== 'lose') unresolved = groups;
        continue;
      }
      const responses: DayPolicy['responses'] = [];
      let failure: Outcome | undefined;
      for (const g of groups) {
        const then = decide(g.branches, abilities - cost, depth + 1);
        if (typeof then === 'string') {
          failure = then;
          if (then === 'lose' || work >= workLimit) break;
        } else responses.push({ when: g.when, then });
      }
      if (!failure) return { choice, reportsBefore, responses };
      if (failure !== 'lose') unresolved = failure;
      if (work >= workLimit && failure === 'limit') return failure;
    }
    return unresolved;
  }
  const branches = candidates.states.map((root) => {
    const state = clone(root);
    state.traceOutcomes = true;
    return { state, audit: state.audit.length };
  });
  const policy = decide(branches, maxAbilities, 0);
  if (typeof policy !== 'string') return { status: 'guaranteed', policy, work };
  if (policy === 'lose') return { status: 'no-guaranteed-policy', work };
  return { status: 'unknown', reason: policy, work };
}
