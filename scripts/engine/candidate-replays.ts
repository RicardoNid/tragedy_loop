import { setupSchema } from '../../packages/contracts/src/validation.js';
import { replay, type ReplayRequest } from '../../packages/engine/src/runtime/replay.js';
import type { RulePack } from '../../packages/engine/src/runtime/model.js';
export type CandidateReplay = Pick<ReplayRequest, 'setup' | 'choices'>;
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
