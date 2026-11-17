import type { EngineState, RulePack } from '../runtime/model.js';
import { canonical } from '../runtime/model.js';
import { visibleReport } from './position.js';
import { acceptedIdentities, culpritAnswer, type FinalGuess } from '../runtime/final-answers.js';

export interface FinalAdvice {
  /** Coverage of the whole current question. A partial guarantee still has safe first moves. */
  status: 'guaranteed' | 'partial' | 'no-guarantee' | 'unknown' | 'no-candidates';
  checked: number;
  reason?: 'incomplete' | 'limit' | 'special-rule';
  safeChoices: FinalGuess[];
  /** One executable answer per remaining character, or the single collective LL answer. */
  plan: FinalGuess[];
}

function answers(pack: RulePack, state: EngineState) {
  if (
    state.ruleDigest !== pack.digest ||
    state.phase !== 'final-guess' ||
    state.pending?.kind !== 'guess' ||
    state.winner
  )
    throw Error('Expected a pending final decision for this rule pack');
  const sheet = {
    loop: state.loop,
    day: state.day,
    days: state.setup.days,
    loops: state.setup.loops,
    actor: state.pending.actor,
    incidents: state.setup.incidents
      .map((i) => ({ day: i.day, name: i.publicName ?? i.name }))
      .sort((a, b) => a.day - b.day),
    observations: state.observations.protagonists.map(visibleReport),
  };
  if (state.flags['c-guess']) {
    const joint = culpritAnswer(state);
    return {
      signature: canonical({ ...sheet, mode: 'culprits' }),
      count: 1,
      choices: [{ kind: 'guess-culprits', answers: joint }] as FinalGuess[],
    };
  }
  const guessed = new Set<string>(JSON.parse(state.flags.guessed ?? '[]'));
  const roster = Object.values(state.characters)
    .filter((c) => c.status !== 'absent' && !guessed.has(c.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!roster.length) throw Error('Empty pending identity question');
  const reverse = new Map(state.setup.characters.map((c) => [c.id, c.reverseIdentity]));
  const choices: FinalGuess[] = roster.flatMap((c) =>
    acceptedIdentities(pack, c.initialIdentity).map((identity) => ({
      kind: 'guess' as const,
      character: c.id,
      identity,
      ...(reverse.get(c.id) && { reverseIdentity: reverse.get(c.id) }),
    })),
  );
  return {
    signature: canonical({
      ...sheet,
      mode: 'identities',
      roster: roster.map((c) => [c.id, c.character]),
    }),
    count: roster.length,
    choices,
  };
}

/** Host-side intersection over viable worlds for one observed question. A correct ordinary
 * guess discloses only that answer and removes that character. Until a guess can fail,
 * there is no observation on which to branch. A common answer per slot is therefore
 * necessary and sufficient for a guaranteed line in this final decision. */
export function solveFinalDecision(
  pack: RulePack,
  candidates: { exhaustive: boolean; states: Iterable<EngineState> },
  limit: number = Number.MAX_SAFE_INTEGER,
): FinalAdvice {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid world limit');
  let signature: string | undefined;
  let count = 0,
    checked = 0;
  const common = new Map<string, FinalGuess>();
  const unknown = (reason: FinalAdvice['reason']): FinalAdvice => ({
    status: 'unknown',
    checked,
    reason,
    safeChoices: [],
    plan: [],
  });
  if (!candidates.exhaustive) return unknown('incomplete');
  for (const state of candidates.states) {
    if (checked === limit) return unknown('limit');
    checked++;
    if (state.setup.publicSpecialRules?.length) return unknown('special-rule');
    const world = answers(pack, state);
    if (signature === undefined) {
      signature = world.signature;
      count = world.count;
      for (const c of world.choices) common.set(canonical(c), c);
    } else {
      if (signature !== world.signature)
        throw Error('Candidate worlds have different final questions');
      const supported = new Set(world.choices.map(canonical));
      for (const key of common.keys()) if (!supported.has(key)) common.delete(key);
    }
  }
  if (!checked) return { status: 'no-candidates', checked, plan: [], safeChoices: [] };
  const safeChoices = [...common.keys()].sort().map((k) => common.get(k)!);
  const chosen = new Map<string, FinalGuess>();
  for (const c of safeChoices) {
    const id = c.kind === 'guess' ? c.character : '';
    if (!chosen.has(id)) chosen.set(id, c);
  }
  const guaranteed = chosen.size === count;
  return {
    status: guaranteed ? 'guaranteed' : chosen.size ? 'partial' : 'no-guarantee',
    checked,
    safeChoices,
    plan: guaranteed ? [...chosen.values()] : [],
  };
}
