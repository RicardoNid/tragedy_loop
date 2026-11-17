import type { Choice } from '../../../contracts/src/game.js';
import type { MastermindGoal } from '../../../contracts/src/decision.js';
import { culpritAnswer } from '../runtime/final-answers.js';
import type { EngineState, RulePack } from '../runtime/model.js';
import { enumerateChoices } from '../runtime/replay.js';
import { mastermindQuestion, type PolicyCandidates } from './position.js';
import { searchPolicy } from './policy-search.js';

/** For a universal claim, the antagonists may happen to name every correct
 * answer. Their one successful line settles the quantifier at a final guess.
 * An agreed proposal reaches exactly that prompt without a mastermind move. */
function protagonistReplies(s: EngineState): Iterable<Choice> {
  const d = s.pending!;
  if (s.phase === 'discussion') {
    const proposal = d.options.find(
      (c) => c.kind === 'request-final-guess' || (c.kind === 'vote-final-guess' && c.agree),
    );
    if (proposal) return [proposal];
  }
  if (d.kind !== 'guess') return enumerateChoices(s);
  if (s.flags['c-guess']) return [{ kind: 'guess-culprits', answers: culpritAnswer(s) }];
  const guessed = new Set<string>(JSON.parse(s.flags.guessed ?? '[]'));
  const character = Object.values(s.characters).find(
    (c) => c.status !== 'absent' && !guessed.has(c.id),
  );
  if (!character) return [];
  const reverseIdentity = s.setup.characters.find((c) => c.id === character.id)?.reverseIdentity;
  return [
    {
      kind: 'guess',
      character: character.id,
      identity: character.initialIdentity,
      reverseIdentity,
    },
  ];
}

export function findMastermindPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  goal: MastermindGoal,
  workLimit: number,
  frontierLimit = 512,
) {
  if (goal?.kind !== 'loop-failure' && goal?.kind !== 'mastermind-win')
    throw Error('Expected a mastermind goal');
  if (!Number.isSafeInteger(frontierLimit) || frontierLimit < 1)
    throw Error('Invalid policy frontier limit');
  let question: string | undefined;
  for (const s of candidates.states) {
    if (
      s.ruleDigest !== pack.digest ||
      s.setup.module !== pack.module ||
      s.setup.anniversary !== pack.anniversary
    )
      throw Error('Different rule pack');
    if (goal.kind === 'loop-failure' && (s.failed || s.protagonistDead))
      throw Error('Current loop failure has already occurred');
    const view = mastermindQuestion(s);
    if (question !== undefined && view !== question)
      throw Error('Different mastermind decision positions');
    question = view;
  }
  const loop = candidates.states[0]?.loop;
  return searchPolicy(pack, candidates, workLimit, {
    seat: 'mastermind',
    frontierLimit,
    controls: (s) => s.pending!.actor === 'mastermind',
    opponentChoices: protagonistReplies,
    outcome(s) {
      if (goal.kind === 'loop-failure') {
        if (s.loop === loop && (s.failed || s.protagonistDead)) return 'win';
        if (s.winner || s.loop !== loop || s.phase === 'final-guess') return 'lose';
      } else if (s.winner) return s.winner === 'mastermind' ? 'win' : 'lose';
    },
    choices(states) {
      const s = states[0]!;
      if (s.pending!.kind === 'ability') {
        const options = s.pending!.options;
        return [
          ...options.filter((c) => c.kind !== 'pass'),
          ...options.filter((c) => c.kind === 'pass'),
        ];
      }
      return enumerateChoices(s);
    },
  });
}
