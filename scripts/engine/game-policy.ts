import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import { findWinningPolicy } from '../../packages/engine/src/decision/game-policy.js';
import { replayCandidates, type CandidateReplay } from './candidate-replays.js';

export function adviseWinningPolicy(input: {
  exhaustive: boolean;
  candidates: CandidateReplay[];
  workLimit?: number;
  frontierLimit?: number;
}) {
  if (!input || typeof input.exhaustive !== 'boolean' || !Array.isArray(input.candidates))
    throw Error('Invalid game question');
  const setup = input.candidates.length ? setupSchema.parse(input.candidates[0]?.setup) : undefined;
  const pack = compileOfficial(setup?.module ?? 'BTX', setup?.anniversary ?? false);
  return findWinningPolicy(
    pack,
    { exhaustive: input.exhaustive, states: [...replayCandidates(pack, input.candidates)] },
    input.workLimit ?? 10000,
    input.frontierLimit ?? 512,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: pnpm solve:game <question.json>');
    console.log(
      JSON.stringify(
        adviseWinningPolicy(JSON.parse(readFileSync(process.argv[2], 'utf8'))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
