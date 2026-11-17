import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import { findDayPolicy } from '../../packages/engine/src/decision/day-policy.js';
import { replayCandidates, type CandidateReplay } from './candidate-replays.js';

export function adviseDayPolicy(input: {
  exhaustive: boolean;
  candidates: CandidateReplay[];
  target: string;
  maxAbilities?: number;
  workLimit?: number;
}) {
  if (
    !input ||
    typeof input.exhaustive !== 'boolean' ||
    typeof input.target !== 'string' ||
    !Array.isArray(input.candidates)
  )
    throw Error('Invalid policy question');
  const setup = input.candidates.length ? setupSchema.parse(input.candidates[0]?.setup) : undefined;
  const pack = compileOfficial(setup?.module ?? 'BTX', setup?.anniversary ?? false);
  const states = [...replayCandidates(pack, input.candidates)];
  return findDayPolicy(
    pack,
    { exhaustive: input.exhaustive, states },
    input.target,
    input.maxAbilities ?? 2,
    input.workLimit ?? 10000,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: pnpm solve:policy <question.json>');
    console.log(
      JSON.stringify(adviseDayPolicy(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
