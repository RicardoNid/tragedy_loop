import { enumerateChoices } from '../runtime/replay.js';
import type { Choice, Protagonist } from '../../../contracts/src/game.js';
import type { EngineState, RulePack } from '../runtime/model.js';
import { acceptedIdentities, culpritAnswer } from '../runtime/final-answers.js';
import { solveFinalDecision } from './final.js';
import { publicQuestion, type PolicyCandidates } from './position.js';
import { searchPolicy, type PolicyAdvice } from './policy-search.js';

/** Order a late card menu using direct intrigue loss conditions in the structural
 * rule programs. Every option still goes through the same forward proof. */
function lastDayCards(pack: RulePack, states: EngineState[]) {
  const s = states[0]!;
  const threats = new Set<string>();
  const plots = new Set(states.flatMap((s) => [s.setup.y, ...s.setup.x, s.setup.alternateY]));
  for (const plot of plots)
    for (const a of (plot && pack.plots[plot]?.abilities) || []) {
      const c = a.condition;
      if (
        a.timing === 'loop-end' &&
        a.mandatory &&
        a.steps.some((step) => step.effects.some((e) => e.op === 'fail')) &&
        c &&
        typeof c === 'object' &&
        'cmp' in c &&
        (c.cmp === 'ge' || c.cmp === 'gt') &&
        c.left &&
        typeof c.left === 'object' &&
        'counter' in c.left &&
        c.left.counter === 'intrigue'
      )
        threats.add(c.left.target);
    }
  if (!threats.size) return enumerateChoices(s);
  const blocks = new Set(
    s.cards
      .filter((c) => c.owner === s.pending!.actor && c.kind === 'block-intrigue')
      .map((c) => c.id),
  );
  const covered = new Set(
    s.placements
      .filter((p) => s.cards.find((c) => c.id === p.card)?.owner === 'mastermind')
      .map((p) => p.target),
  );
  const priority = (c: Choice) =>
    Number(
      c.kind === 'cards' &&
        c.placements.some(
          (p) => blocks.has(p.card) && threats.has(p.target) && covered.has(p.target),
        ),
    );
  return [...enumerateChoices(s)].sort((a, b) => priority(b) - priority(a));
}

/** An opponent's successful C answer wins alone. For an ordinary guess any
 * legal wrong answer ends the game for the mastermind. One such reply suffices
 * to refute a unilateral guarantee; it need not be predicted or likely. */
function opposingMoves(pack: RulePack, s: EngineState): Iterable<Choice> {
  if (s.pending?.kind !== 'guess') return enumerateChoices(s);
  if (s.flags['c-guess']) return [{ kind: 'guess-culprits', answers: culpritAnswer(s) }];
  const guessed = new Set<string>(JSON.parse(s.flags.guessed ?? '[]'));
  const c = Object.values(s.characters).find((c) => c.status !== 'absent' && !guessed.has(c.id));
  if (!c) return [];
  const wrong = Object.keys(pack.identities).find(
    (r) => !acceptedIdentities(pack, c.initialIdentity).includes(r),
  );
  return wrong ? [{ kind: 'guess', character: c.id, identity: wrong }] : [];
}

/** The cooperative protagonist side shares its information and controls all three
 * seats. The actual runtime winner settles every branch, including failed loops. */
export function findWinningPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  workLimit: number,
  frontierLimit = 512,
  seat?: Protagonist,
  proofCacheLimit = 1024,
): PolicyAdvice {
  if (!Number.isSafeInteger(workLimit) || workLimit < 0) throw Error('Invalid policy work limit');
  if (!Number.isSafeInteger(frontierLimit) || frontierLimit < 1)
    throw Error('Invalid policy frontier limit');
  if (!Number.isSafeInteger(proofCacheLimit) || proofCacheLimit < 0)
    throw Error('Invalid proof cache limit');
  if (seat !== undefined && !['p0', 'p1', 'p2'].includes(seat)) throw Error('Invalid seat');
  let question: string | undefined;
  for (const s of candidates.states) {
    if (
      s.ruleDigest !== pack.digest ||
      s.setup.module !== pack.module ||
      s.setup.anniversary !== pack.anniversary ||
      !s.pending ||
      s.pending.actor === 'mastermind' ||
      (seat !== undefined && s.pending.actor !== seat) ||
      s.winner
    )
      throw Error('Expected a protagonist decision for this rule pack');
    const view = publicQuestion(s, seat);
    if (question !== undefined && question !== view)
      throw Error('Different observed decision positions');
    question = view;
  }
  if (
    pack.module === 'LL' &&
    candidates.states.length &&
    (!seat || candidates.states.some((s) => !s.ll))
  )
    return { status: 'unknown', reason: 'unsupported', work: 0 };
  const rootVote = candidates.states[0]?.pending?.options.some(
    (c) => c.kind === 'vote-final-guess',
  );
  return searchPolicy(pack, candidates, workLimit, {
    frontierLimit,
    proofCacheLimit,
    seat,
    controls: (s) => (seat ? s.pending!.actor === seat : s.pending!.actor !== 'mastermind'),
    opponentChoices: (s) => opposingMoves(pack, s),
    outcome(s) {
      if (!s.winner) return;
      const won = seat ? s.winners?.includes(seat) : s.winner === 'protagonists';
      return won ? 'win' : 'lose';
    },
    choices(states, depth) {
      const s = states[0]!,
        d = s.pending!;
      if (d.kind === 'cards' && s.day === s.setup.days) return lastDayCards(pack, states);
      if (d.kind === 'guess') {
        const advice = solveFinalDecision(pack, { exhaustive: true, states });
        if (advice.status === 'unknown') return 'unsupported';
        // Successful ordinary answers reveal the same fact everywhere. If one slot
        // lacks a common answer, no ordering can win the final; otherwise any order works.
        return advice.status === 'guaranteed' ? [advice.plan[0]!] : 'lose';
      }
      if (s.phase === 'discussion') {
        if (seat) {
          // Either other seat can immediately veto the captain's own proposal
          // without disclosing a fact. Any guaranteed line must survive ordinary
          // play after that veto. At an existing vote, both answers remain legal.
          return d.options.filter((c) => c.kind !== 'request-final-guess');
        }
        if (d.kind === 'continue') {
          const final = d.options.filter((c) => c.kind === 'request-final-guess');
          const play = d.options.filter((c) => c.kind === 'continue');
          return rootVote && depth === 1 ? play : [...final, ...play];
        }
        // The side initiated this proposal collectively. Rejecting it goes back to
        // precisely the same discussion with no new information. At an externally
        // supplied vote, retain the alternative of immediately resuming play.
        if (d.options.some((c) => c.kind === 'vote-final-guess'))
          return d.options.filter((c) => c.kind === 'vote-final-guess' && (c.agree || depth === 0));
      }
      return enumerateChoices(s);
    },
  });
}
