import type { Choice, GameSetup, Observation, Protagonist } from '../../../contracts/src/game.js';
import { drive } from '../runtime/engine.js';
import { canonical, clone, type EngineState, type RulePack } from '../runtime/model.js';
import { enumerateChoices, type RecordedChoice } from '../runtime/replay.js';
import { checkDayRoots } from './day-survival.js';
import type { PolicyNode } from './policy-search.js';
import {
  observedMenu,
  publicQuestion,
  rulesSupported,
  submitChoice,
  visibleReport,
  type PolicyCandidates,
} from './position.js';

export type DecisionGoal =
  | { kind: 'game' }
  | { kind: 'seat-win'; seat: Protagonist }
  | { kind: 'survival'; target: string; maxAbilities?: number };
type Failure =
  | 'lost'
  | 'death'
  | 'left-play'
  | 'illegal-choice'
  | 'missing-response'
  | 'ambiguous-response'
  | 'invalid-node'
  | 'ability-limit';
export interface PolicyVerification {
  status: 'verified' | 'counterexample' | 'unknown' | 'no-candidates';
  work: number;
  winningLeaves: number;
  reason?: Failure | 'limit' | 'unsupported' | 'incomplete';
  counterexample?: {
    at: Pick<EngineState, 'loop' | 'day' | 'phase'>;
    reports: Observation[];
    question?: ReturnType<typeof observedMenu>;
  };
  hostWitness?: {
    candidate: number;
    rootCommands: number;
    setup: GameSetup;
    choices: RecordedChoice[];
  };
}

// The runtime accepts guesses as input without building a menu. In a personal
// game the competing C can immediately win by naming all real culprits. For
// ordinary guesses enumerate the public vocabulary, including two-sided roles.
function* replies(pack: RulePack, s: EngineState): Generator<Choice> {
  if (s.pending!.kind !== 'guess') {
    yield* enumerateChoices(s);
    return;
  }
  if (s.flags['c-guess']) {
    const answers = Object.fromEntries(s.setup.incidents.map((i) => [String(i.day), i.culprit]));
    yield { kind: 'guess-culprits', answers };
    // Other joint answers are observable on a miss. Keep them available even
    // though the correct competing answer normally ends verification immediately.
    const days = s.setup.incidents.map((i) => String(i.day));
    const roster = Object.keys(s.characters);
    const indices = Array<number>(days.length).fill(0);
    while (roster.length && indices.length) {
      const alternative = Object.fromEntries(days.map((day, i) => [day, roster[indices[i]!]!]));
      if (days.some((day) => alternative[day] !== answers[day]))
        yield { kind: 'guess-culprits', answers: alternative };
      let digit = indices.length - 1;
      while (digit >= 0 && indices[digit] === roster.length - 1) indices[digit--] = 0;
      if (digit < 0) break;
      indices[digit] = indices[digit]! + 1;
    }
  } else {
    const guessed: string[] = JSON.parse(s.flags.guessed ?? '[]');
    const roles = Object.keys(pack.identities);
    for (const c of Object.values(s.characters)) {
      if (c.status === 'absent' || guessed.includes(c.id)) continue;
      for (const identity of roles) {
        yield { kind: 'guess', character: c.id, identity };
        if (s.setup.characters.some((entry) => entry.reverseIdentity))
          for (const reverseIdentity of roles)
            yield { kind: 'guess', character: c.id, identity, reverseIdentity };
      }
    }
  }
}

/** Check a fixed strategy directly against the runtime. No search ordering,
 * terminal cache or policy-construction routines participate in this proof. */
export function verifyPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  policy: PolicyNode,
  goal: DecisionGoal,
  workLimit: number,
  includeHostWitness = false,
): PolicyVerification {
  if (!Number.isSafeInteger(workLimit) || workLimit < 0) throw Error('Invalid verification limit');
  if (!goal || !['game', 'seat-win', 'survival'].includes(goal.kind))
    throw Error('Invalid verification goal');
  const seat = goal.kind === 'seat-win' ? goal.seat : undefined;
  const abilityLimit = goal.kind === 'survival' ? (goal.maxAbilities ?? 2) : Infinity;
  if (goal.kind === 'seat-win' && !['p0', 'p1', 'p2'].includes(goal.seat))
    throw Error('Invalid seat');
  if (goal.kind === 'survival') {
    if (!Number.isSafeInteger(abilityLimit) || abilityLimit < 0)
      throw Error('Invalid ability limit');
    checkDayRoots(pack, candidates, goal.target);
  } else {
    let expected: string | undefined;
    for (const s of candidates.states) {
      if (
        s.ruleDigest !== pack.digest ||
        s.setup.module !== pack.module ||
        s.setup.anniversary !== pack.anniversary
      )
        throw Error('Mismatched verification rule pack');
      const view = publicQuestion(s, seat);
      if (expected !== undefined && expected !== view)
        throw Error('Different observed decision positions');
      expected = view;
    }
  }
  let work = 0,
    winningLeaves = 0;
  let doubt: 'incomplete' | 'unsupported' | undefined = candidates.exhaustive
    ? undefined
    : 'incomplete';
  const result = (
    status: PolicyVerification['status'],
    reason?: PolicyVerification['reason'],
  ): PolicyVerification => ({ status, work, winningLeaves, ...(reason && { reason }) });
  for (const [candidate, root] of candidates.states.entries()) {
    if (
      !rulesSupported(pack, root) ||
      (pack.module === 'LL' && goal.kind !== 'survival' && (!seat || !root.ll))
    ) {
      doubt = 'unsupported';
      continue;
    }
    const start = clone(root);
    if (goal.kind === 'survival') start.traceOutcomes = true;
    type Path = { s: EngineState; previous?: PolicyNode; abilities: number; audit: number };
    type Item = Path | 'limit' | 'unsupported';
    const stack: Iterator<Item>[] = [
      [{ s: start, abilities: 0, audit: start.audit.length }][Symbol.iterator](),
    ];
    const since = root.observations.protagonists.length;
    function fail(reason: Failure, s: EngineState, controlled = false): PolicyVerification {
      return {
        ...result('counterexample', reason),
        counterexample: {
          at: { loop: s.loop, day: s.day, phase: s.phase },
          reports: s.observations.protagonists.slice(since).map(visibleReport),
          ...(controlled && { question: observedMenu(s, since, seat) }),
        },
        ...(includeHostWitness && {
          hostWitness: {
            candidate,
            rootCommands: root.choices.length,
            setup: clone(root.setup),
            choices: s.choices.map(({ actor, choice }) => ({ actor, choice: clone(choice) })),
          },
        }),
      };
    }
    function* opponents(path: Path): Generator<Item> {
      let any = false;
      for (const choice of replies(pack, path.s)) {
        any = true;
        if (work >= workLimit) {
          yield 'limit';
          return;
        }
        work++;
        const r = submitChoice(pack, path.s, choice);
        yield r.status === 'rejected' ? 'unsupported' : { ...path, s: r.state };
      }
      if (!any) yield 'unsupported';
    }
    while (stack.length) {
      const next = stack.at(-1)!.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      const path = next.value;
      if (path === 'limit') return result('unknown', 'limit');
      if (path === 'unsupported') {
        doubt = 'unsupported';
        continue;
      }
      let s = path.s;
      for (;;) {
        if (s.diagnostic) {
          doubt = 'unsupported';
          break;
        }
        if (goal.kind === 'survival') {
          const target = goal.target;
          for (let i = path.audit; i < s.audit.length; i++)
            if (s.audit[i]!.kind === 'character-died' && s.audit[i]!.data === target)
              return fail('death', s);
          const status = s.characters[target]!.status;
          if (status !== 'alive') return fail(status === 'dead' ? 'death' : 'left-play', s);
          if (s.winner || s.loop !== root.loop || s.day !== root.day || s.phase === 'loop-end') {
            winningLeaves++;
            break;
          }
        } else if (s.winner) {
          if (seat ? !s.winners?.includes(seat) : s.winner !== 'protagonists')
            return fail('lost', s);
          winningLeaves++;
          break;
        }
        path.audit = s.audit.length;
        if (!s.pending) {
          if (work >= workLimit) return result('unknown', 'limit');
          work++;
          drive(pack, s, 1);
          continue;
        }
        const controlled =
          goal.kind === 'survival'
            ? s.phase === 'protagonist-abilities' && s.pending.actor === root.captain
            : seat
              ? s.pending.actor === seat
              : s.pending.actor !== 'mastermind';
        if (!controlled) {
          stack.push(opponents({ ...path, s }));
          break;
        }
        let node = policy;
        if (path.previous) {
          const view = canonical(observedMenu(s, path.previous.reportsBefore, seat));
          const matches = path.previous.responses.filter(
            (entry) => entry && canonical(entry.when) === view,
          );
          if (matches.length !== 1)
            return fail(matches.length ? 'ambiguous-response' : 'missing-response', s, true);
          node = matches[0]!.then;
        }
        if (
          !node ||
          node.seat !== seat ||
          !Array.isArray(node.responses) ||
          node.reportsBefore !== s.observations.protagonists.length
        )
          return fail('invalid-node', s, true);
        if (node.choice?.kind === 'ability' && ++path.abilities > abilityLimit)
          return fail('ability-limit', s, true);
        if (work >= workLimit) return result('unknown', 'limit');
        work++;
        const r = submitChoice(pack, s, node.choice);
        if (r.status === 'rejected') return fail('illegal-choice', s, true);
        s = r.state;
        path.previous = node;
      }
    }
  }
  if (doubt) return result('unknown', doubt);
  return result(candidates.states.length ? 'verified' : 'no-candidates');
}
