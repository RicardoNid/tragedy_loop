import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { Choice } from '../../packages/contracts/src/game.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import {
  findDaySurvival,
  solveDaySurvival,
} from '../../packages/engine/src/decision/day-survival.js';
import { replayCandidates, type CandidateReplay } from './candidate-replays.js';

export function adviseSurvival(input: {
  exhaustive: boolean;
  target: string;
  workPerPlan: number;
  plans?: Choice[][];
  maxPlans?: number;
  candidates: CandidateReplay[];
}) {
  if (
    !input ||
    typeof input.exhaustive !== 'boolean' ||
    typeof input.target !== 'string' ||
    (input.plans !== undefined && !Array.isArray(input.plans)) ||
    !Array.isArray(input.candidates)
  )
    throw Error('Invalid survival question');
  const setup = input.candidates.length ? setupSchema.parse(input.candidates[0]?.setup) : undefined;
  const pack = compileOfficial(setup?.module ?? 'BTX', setup?.anniversary ?? false);
  const candidates = {
    exhaustive: input.exhaustive,
    states: [...replayCandidates(pack, input.candidates)],
  };
  const plans = input.plans;
  if (!plans)
    return findDaySurvival(
      pack,
      candidates,
      input.target,
      input.workPerPlan,
      input.maxPlans ?? 100,
    );
  const results = solveDaySurvival(pack, candidates, input.target, plans, input.workPerPlan);
  return results.map((r, i) => ({ plan: plans[i], ...r }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: pnpm solve:survival <question.json>');
    console.log(
      JSON.stringify(adviseSurvival(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
