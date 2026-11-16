import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import { replay, type ReplayRequest } from '../../packages/engine/src/runtime/replay.js';
import { solveFinalDecision, type FinalAdvice } from '../../packages/engine/src/decision/final.js';

export function adviseReplays(input: {
  exhaustive: boolean;
  candidates: Pick<ReplayRequest, 'setup' | 'choices'>[];
  worldLimit?: number;
}): FinalAdvice {
  if (!input || typeof input.exhaustive !== 'boolean' || !Array.isArray(input.candidates))
    throw Error('Expected exhaustive and an array of candidate replays');
  const limit = input.worldLimit ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid world limit');
  if (!input.candidates.length)
    return {
      status: input.exhaustive ? 'no-candidates' : 'unknown',
      ...(!input.exhaustive && { reason: 'incomplete' }),
      checked: 0,
      safeChoices: [],
      plan: [],
    };
  const first = setupSchema.parse(input.candidates[0]?.setup);
  const pack = compileOfficial(first.module, first.anniversary);
  if (input.candidates.length > limit)
    return { status: 'unknown', reason: 'limit', checked: 0, safeChoices: [], plan: [] };
  function* states() {
    for (const [index, candidate] of input.candidates.entries()) {
      const setup = setupSchema.parse(candidate?.setup);
      if (
        setup.module !== first.module ||
        setup.anniversary !== first.anniversary ||
        !Array.isArray(candidate.choices)
      )
        throw Error('Different rule pack or missing decisions in candidate ' + index);
      const r = replay(pack, { setup, choices: candidate.choices });
      if (r.status !== 'replayed')
        throw Error('Candidate ' + index + ' could not reach the final question: ' + r.status);
      yield r.state;
    }
  }
  return solveFinalDecision(pack, { exhaustive: input.exhaustive, states: states() }, limit);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const file = process.argv[2];
    if (!file) throw Error('Usage: pnpm solve:final <candidate-replays.json>');
    console.log(JSON.stringify(adviseReplays(JSON.parse(readFileSync(file, 'utf8'))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
