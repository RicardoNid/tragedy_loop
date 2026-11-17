import { enumerateChoices } from '../runtime/replay.js';
import type { RulePack } from '../runtime/model.js';
import { solveFinalDecision } from './final.js';
import { publicQuestion, type PolicyCandidates } from './position.js';
import { searchPolicy, type PolicyAdvice } from './policy-search.js';

/** The cooperative protagonist side shares its information and controls all three
 * seats. The actual runtime winner settles every branch, including failed loops. */
export function findWinningPolicy(
  pack: RulePack,
  candidates: PolicyCandidates,
  workLimit: number,
  frontierLimit = 512,
): PolicyAdvice {
  if (!Number.isSafeInteger(workLimit) || workLimit < 0) throw Error('Invalid policy work limit');
  if (!Number.isSafeInteger(frontierLimit) || frontierLimit < 1)
    throw Error('Invalid policy frontier limit');
  let question: string | undefined;
  for (const s of candidates.states) {
    if (
      s.ruleDigest !== pack.digest ||
      s.setup.module !== pack.module ||
      s.setup.anniversary !== pack.anniversary ||
      !s.pending ||
      s.pending.actor === 'mastermind' ||
      s.winner
    )
      throw Error('Expected a protagonist decision for this rule pack');
    const view = publicQuestion(s);
    if (question !== undefined && question !== view)
      throw Error('Different observed decision positions');
    question = view;
  }
  if (pack.module === 'LL' && candidates.states.length)
    return { status: 'unknown', reason: 'unsupported', work: 0 };
  const rootVote = candidates.states[0]?.pending?.options.some(
    (c) => c.kind === 'vote-final-guess',
  );
  return searchPolicy(pack, candidates, workLimit, {
    frontierLimit,
    controls: (s) => s.pending!.actor !== 'mastermind',
    outcome: (s) => (s.winner ? (s.winner === 'protagonists' ? 'win' : 'lose') : undefined),
    choices(states, depth) {
      const s = states[0]!,
        d = s.pending!;
      if (d.kind === 'guess') {
        const advice = solveFinalDecision(pack, { exhaustive: true, states });
        if (advice.status === 'unknown') return 'unsupported';
        // Successful ordinary answers reveal the same fact everywhere. If one slot
        // lacks a common answer, no ordering can win the final; otherwise any order works.
        return advice.status === 'guaranteed' ? [advice.plan[0]!] : 'lose';
      }
      if (s.phase === 'discussion') {
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
