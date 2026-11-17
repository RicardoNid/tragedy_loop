import { setupSchema } from '../../packages/contracts/src/validation.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { DecisionGoal } from '../../packages/contracts/src/decision.js';
import type { InvestigationOptions } from '../../packages/contracts/src/investigation.js';
import type { Protagonist } from '../../packages/contracts/src/game.js';
import { replay, type ReplayRequest } from '../../packages/engine/src/runtime/replay.js';
import type { RulePack } from '../../packages/engine/src/runtime/model.js';
export type CandidateReplay = Pick<ReplayRequest, 'setup' | 'choices'>;
export interface ReplayQuestion {
  candidates: CandidateReplay[];
  exhaustive: boolean;
  seat?: Protagonist;
  target?: string;
  maxAbilities?: number;
  workLimit?: number;
  frontierLimit?: number;
  goal?: DecisionGoal;
  investigation?: InvestigationOptions;
}
export function resolveReplayQuestion(input: ReplayQuestion) {
  const pool = resolveReplayCandidates(input);
  const goal: DecisionGoal =
    input.goal ??
    (input.target !== undefined
      ? { kind: 'survival', target: input.target, maxAbilities: input.maxAbilities }
      : input.seat !== undefined
        ? { kind: 'seat-win', seat: input.seat }
        : { kind: 'game' });
  return { ...pool, goal };
}
export function resolveReplayCandidates(input: Pick<ReplayQuestion, 'candidates' | 'exhaustive'>) {
  if (!Array.isArray(input.candidates) || typeof input.exhaustive !== 'boolean')
    throw Error('Invalid replay question');
  const setup = input.candidates.length ? setupSchema.parse(input.candidates[0]?.setup) : undefined;
  const pack = compileOfficial(setup?.module ?? 'BTX', setup?.anniversary ?? false);
  return {
    pack,
    candidates: {
      exhaustive: input.exhaustive,
      states: [...replayCandidates(pack, input.candidates)],
    },
  };
}
export function* replayCandidates(pack: RulePack, candidates: readonly CandidateReplay[]) {
  for (const [index, candidate] of candidates.entries()) {
    const setup = setupSchema.parse(candidate?.setup);
    if (
      setup.module !== pack.module ||
      setup.anniversary !== pack.anniversary ||
      !Array.isArray(candidate.choices)
    )
      throw Error('Different rule pack or missing decisions in candidate ' + index);
    const r = replay(pack, { setup, choices: candidate.choices });
    if (r.status !== 'replayed')
      throw Error('Candidate ' + index + ' could not complete the replay: ' + r.status);
    yield r.state;
  }
}
