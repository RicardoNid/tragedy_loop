import type { Choice } from '../../../contracts/src/game.js';
import { drive } from '../runtime/engine.js';
import { canonical, clone, type EngineState, type RulePack } from '../runtime/model.js';
import { enumerateChoices } from '../runtime/replay.js';
import { observedMenu, submitChoice, rulesSupported, type PolicyCandidates } from './position.js';

type View = ReturnType<typeof observedMenu>;
export interface PolicyNode {
  choice: Choice;
  /** Observer-local cursor at the moment of issuing choice. */
  reportsBefore: number;
  responses: { when: View; then: PolicyNode }[];
}
export interface PolicyAdvice {
  status: 'guaranteed' | 'no-guaranteed-policy' | 'unknown' | 'no-candidates';
  work: number;
  reason?: 'limit' | 'unsupported' | 'incomplete';
  policy?: PolicyNode;
}
type Branch = { state: EngineState; audit: number };
type Outcome = 'lose' | 'unsupported' | 'limit';

/** Follow the returned tree at the next captain prompt using only the visible change
 * since the previous command. Opponent decisions never occur in the policy. */
export function nextPolicyStep(node: PolicyNode, state: EngineState) {
  if (!state.pending || state.pending.actor === 'mastermind') return undefined;
  const key = canonical(observedMenu(state, node.reportsBefore));
  return node.responses.find((r) => canonical(r.when) === key)?.then;
}

interface SearchDomain {
  controls(s: EngineState): boolean;
  outcome(s: EngineState, audit: number): 'win' | 'lose' | undefined;
  choices(states: EngineState[], depth: number): Iterable<Choice> | 'lose' | 'unsupported';
  maxAbilities?: number;
  frontierLimit?: number;
  traceDeaths?: boolean;
}
export function searchPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  workLimit: number,
  domain: SearchDomain,
): PolicyAdvice {
  if (!Number.isSafeInteger(workLimit) || workLimit < 0) throw Error('Invalid policy work limit');
  if (!candidates.exhaustive) return { status: 'unknown', reason: 'incomplete', work: 0 };
  const root = candidates.states[0];
  if (!root) return { status: 'no-candidates', work: 0 };
  if (candidates.states.some((s) => !rulesSupported(pack, s)))
    return { status: 'unknown', reason: 'unsupported', work: 0 };
  let work = 0;

  function apply(branch: Branch, choice: Choice): Branch | 'unsupported' | 'limit' {
    if (work >= workLimit) return 'limit';
    work++;
    const r = submitChoice(pack, branch.state, choice);
    return r.status === 'rejected' ? 'unsupported' : { state: r.state, audit: branch.audit };
  }
  type Group = { when: View; branches: Branch[] };
  // On a given action, any losing continuation refutes the action. All other live
  // continuations must be grouped before deciding what the captain will do next.
  function expand(input: Branch[], choice: Choice, since: number): Group[] | Outcome {
    const groups = new Map<string, Group>();
    let retained = 0;
    function* successors(b: Branch, choices: Iterable<Choice>) {
      let any = false;
      for (const c of choices) {
        any = true;
        yield apply(b, c);
      }
      if (!any) yield 'unsupported' as const;
    }
    function* initial() {
      for (const b of input) yield apply(b, choice);
    }
    // A mastermind card placement may have thousands of legal siblings. Allocate
    // each child only when DFS visits it; a single immediate loss settles the action.
    const pending: Iterator<Branch | 'limit' | 'unsupported'>[] = [initial()];
    while (pending.length) {
      const item = pending.at(-1)!.next();
      if (item.done) {
        pending.pop();
        continue;
      }
      const b = item.value;
      if (typeof b === 'string') return b;
      const s = b.state;
      for (;;) {
        if (s.diagnostic) return 'unsupported';
        const end = domain.outcome(s, b.audit);
        b.audit = s.audit.length;
        if (end === 'lose') return 'lose';
        if (end === 'win') break;
        const d = s.pending;
        if (!d) {
          if (work >= workLimit) return 'limit';
          work++;
          drive(pack, s, 1);
          continue;
        }
        if (domain.controls(s)) {
          if (++retained > (domain.frontierLimit ?? Infinity)) return 'limit';
          const when = observedMenu(s, since);
          const key = canonical(when);
          const group = groups.get(key);
          if (group) group.branches.push(b);
          else groups.set(key, { when, branches: [b] });
        } else {
          pending.push(successors(b, enumerateChoices(s)));
        }
        break;
      }
    }
    return [...groups.values()];
  }

  function decide(branches: Branch[], abilities: number, depth: number): PolicyNode | Outcome {
    // Protect the JS stack even when a caller supplies an arbitrarily large budget.
    if (depth >= 128) return 'limit';
    const s = branches[0]!.state;
    const reportsBefore = s.observations.protagonists.length;
    let unresolved: Outcome = 'lose';
    const choices = domain.choices(
      branches.map((b) => b.state),
      depth,
    );
    if (typeof choices === 'string') return choices;
    let any = false;
    for (const choice of choices) {
      any = true;
      const cost = Number(choice.kind === 'ability');
      if (cost > abilities) continue;
      const groups = expand(branches, choice, reportsBefore);
      if (typeof groups === 'string') {
        if (groups === 'limit' && work >= workLimit) return groups;
        if (groups !== 'lose') unresolved = groups;
        continue;
      }
      const responses: PolicyNode['responses'] = [];
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
    return any ? unresolved : 'unsupported';
  }
  const branches = candidates.states.map((root) => {
    const state = clone(root);
    if (domain.traceDeaths) state.traceOutcomes = true;
    return { state, audit: state.audit.length };
  });
  const policy = decide(branches, domain.maxAbilities ?? Infinity, 0);
  if (typeof policy !== 'string') return { status: 'guaranteed', policy, work };
  if (policy === 'lose') return { status: 'no-guaranteed-policy', work };
  return { status: 'unknown', reason: policy, work };
}
