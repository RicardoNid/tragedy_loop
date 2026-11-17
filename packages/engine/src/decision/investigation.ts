import type {
  Hypothesis,
  InvestigationOptions,
  InvestigationPlan,
  InvestigationResult,
  InvestigationTarget,
  InvestigationView,
} from '../../../contracts/src/investigation.js';
import type { Choice } from '../../../contracts/src/game.js';
import { drive } from '../runtime/engine.js';
import { canonical, type EngineState, type RulePack } from '../runtime/model.js';
import { enumerateChoices } from '../runtime/replay.js';
import {
  observedBoard,
  observedMenu,
  publicQuestion,
  rulesSupported,
  submitChoice,
  type PolicyCandidates,
} from './position.js';

type World = { state: EngineState; answer: Hypothesis };
type Group = { when: InvestigationView; worlds: World[] };
type Evaluation = { plan: InvestigationPlan; worst: number };
type Unresolved = 'unsupported' | 'limit';
type SearchResult = { feasible?: Evaluation; unresolved?: Unresolved };
function hypothesis(s: EngineState, target: InvestigationTarget): Hypothesis {
  if (target.kind === 'culprit') {
    const item = s.setup.incidents.find((i) => i.day === target.day);
    if (!item) throw Error('No scheduled incident on the requested day');
    return { culprit: item.culprit };
  }
  const c = s.characters[target.character];
  if (!c || (c.status === 'absent' && !s.appeared.includes(c.id)))
    throw Error('Expected a visible character');
  const reverseIdentity = s.setup.characters.find((entry) => entry.id === c.id)?.reverseIdentity;
  return { identity: c.initialIdentity, ...(reverseIdentity && { reverseIdentity }) };
}
function answersOf(worlds: World[]): Hypothesis[] {
  const result = new Map(worlds.map((w) => [canonical(w.answer), w.answer]));
  return [...result.keys()].sort().map((key) => result.get(key)!);
}
/** Minimize the maximum number of distinct answers still compatible with a
 * protagonist observation. A leaf ends this investigation without submitting a
 * game command. Once declared, an ability must finish all required choices. */
export function solveInvestigation(
  pack: RulePack,
  candidates: PolicyCandidates,
  options: InvestigationOptions,
  workLimit: number,
  frontierLimit = 1024,
): InvestigationResult {
  const maxAbilities = options?.maxAbilities ?? 1,
    seat = options?.seat;
  if (
    ![workLimit, maxAbilities, frontierLimit].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    !frontierLimit
  )
    throw Error('Invalid investigation limits');
  const target = options?.target;
  if (
    !target ||
    (target.kind === 'identity'
      ? typeof target.character !== 'string'
      : target.kind !== 'culprit' || !Number.isSafeInteger(target.day) || target.day < 1) ||
    (seat !== undefined && !['p0', 'p1', 'p2'].includes(seat))
  )
    throw Error('Invalid investigation target or seat');
  let question: string | undefined;
  const worlds = candidates.states.map((state) => {
    if (
      state.ruleDigest !== pack.digest ||
      state.setup.module !== pack.module ||
      state.setup.anniversary !== pack.anniversary ||
      state.phase !== 'protagonist-abilities' ||
      state.pending?.kind !== 'ability' ||
      state.pending.actor !== state.captain
    )
      throw Error('Expected the protagonist goodwill ability menu');
    const view = publicQuestion(state, seat);
    if (question !== undefined && question !== view)
      throw Error('Different observed decision positions');
    question = view;
    return { state, answer: hypothesis(state, target) };
  });
  if (!candidates.exhaustive) return { status: 'unknown', reason: 'incomplete', work: 0 };
  if (!worlds.length) return { status: 'no-candidates', work: 0 };
  if (
    worlds.some(
      (w) => !rulesSupported(pack, w.state) || (pack.module === 'LL' && (!seat || !w.state.ll)),
    )
  )
    return { status: 'unknown', reason: 'unsupported', work: 0 };
  const root = worlds[0]!.state;
  let work = 0;

  function expand(input: World[], move: Choice, since: number): Group[] | Unresolved {
    const groups = new Map<string, Group>();
    let retained = 0;
    function apply(world: World, choice: Choice): World | Unresolved {
      if (work >= workLimit) return 'limit';
      work++;
      const r = submitChoice(pack, world.state, choice);
      return r.status === 'rejected' ? 'unsupported' : { state: r.state, answer: world.answer };
    }
    function* initial() {
      for (const w of input) yield apply(w, move);
    }
    function* others(w: World) {
      let any = false;
      for (const choice of enumerateChoices(w.state)) {
        any = true;
        yield apply(w, choice);
      }
      if (!any) yield 'unsupported' as const;
    }
    const stack: Iterator<World | Unresolved>[] = [initial()];
    while (stack.length) {
      const next = stack.at(-1)!.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      const w = next.value;
      if (typeof w === 'string') return w;
      const s = w.state;
      for (;;) {
        if (s.diagnostic) return 'unsupported';
        let when: InvestigationView;
        if (
          s.winner ||
          s.loop !== root.loop ||
          s.day !== root.day ||
          s.phase !== 'protagonist-abilities'
        ) {
          when = { kind: 'boundary', view: observedBoard(s, since, seat) };
        } else if (!s.pending) {
          if (work >= workLimit) return 'limit';
          work++;
          drive(pack, s, 1);
          continue;
        } else if (s.pending.actor === 'mastermind' || (seat && s.pending.actor !== seat)) {
          stack.push(others(w));
          break;
        } else {
          when = { kind: 'prompt', view: observedMenu(s, since, seat) };
        }
        if (++retained > frontierLimit) return 'limit';
        const key = canonical(when);
        const group = groups.get(key);
        if (group) group.worlds.push(w);
        else groups.set(key, { when, worlds: [w] });
        break;
      }
    }
    return [...groups.values()];
  }

  function decide(
    input: World[],
    available: number,
    boundary: boolean,
    depth: number,
  ): SearchResult {
    const answers = answersOf(input),
      s = input[0]!.state;
    const canStop = boundary || s.pending!.kind === 'ability';
    let best: Evaluation | undefined = canStop
      ? { plan: { kind: 'stop', answers }, worst: answers.length }
      : undefined;
    if (boundary || (canStop && (!available || answers.length === 1))) return { feasible: best };
    if (depth >= 128) return { feasible: best, unresolved: 'limit' };
    let unresolved: Unresolved | undefined;
    const since = s.observations.protagonists.length;
    // Stopping is always an available investigation decision at the goodwill
    // menu. Passing into a subsequent incident is outside this horizon.
    const choices = s.pending!.options.filter((c) => !canStop || c.kind === 'ability');
    if (!choices.length && !best) return { unresolved: 'unsupported' };
    for (const choice of choices) {
      const expanded = expand(input, choice, since);
      if (typeof expanded === 'string') {
        unresolved = expanded;
        if (work >= workLimit) break;
        continue;
      }
      const responses: Extract<InvestigationPlan, { kind: 'act' }>['responses'] = [];
      let worst = 0,
        dominated = false,
        partial: Unresolved | undefined;
      for (const g of expanded) {
        const r = decide(
          g.worlds,
          available - Number(choice.kind === 'ability'),
          g.when.kind === 'boundary',
          depth + 1,
        );
        // Only a proven optimum is a lower bound. A merely feasible child
        // gives an upper bound and cannot eliminate competing investigations.
        if (best && r.feasible && !r.unresolved && r.feasible.worst >= best.worst) {
          dominated = true;
          break;
        }
        if (r.unresolved) partial = r.unresolved;
        if (!r.feasible) break;
        responses.push({ when: g.when, then: r.feasible.plan });
        worst = Math.max(worst, r.feasible.worst);
      }
      if (dominated) continue;
      if (partial) unresolved = partial;
      if (responses.length === expanded.length && responses.length && (!best || worst < best.worst))
        best = { worst, plan: { kind: 'act', choice, reportsBefore: since, responses } };
      // One answer is the universal lower bound of every nonempty branch.
      if (best?.worst === 1) return { feasible: best };
    }
    return { feasible: best, unresolved };
  }
  const result = decide(worlds, maxAbilities, false, 0);
  return {
    status: result.unresolved ? 'unknown' : 'optimal',
    ...(result.unresolved && { reason: result.unresolved }),
    work,
    answers: answersOf(worlds),
    ...(result.feasible && { worstRemaining: result.feasible.worst, plan: result.feasible.plan }),
  };
}
