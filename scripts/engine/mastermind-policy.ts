import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MastermindGoal } from '../../packages/contracts/src/decision.js';
import { findMastermindPolicy } from '../../packages/engine/src/decision/mastermind-policy.js';
import { resolveReplayCandidates, type ReplayQuestion } from './candidate-replays.js';

export interface MastermindQuestion
  extends Pick<ReplayQuestion, 'candidates' | 'exhaustive' | 'workLimit' | 'frontierLimit'> {
  perspective: 'mastermind';
  goal: MastermindGoal;
}
export function adviseMastermind(input: MastermindQuestion) {
  if (input?.perspective !== 'mastermind') throw Error('Expected a mastermind question');
  const { pack, candidates } = resolveReplayCandidates(input);
  return findMastermindPolicy(
    pack,
    candidates,
    input.goal,
    input.workLimit ?? 10000,
    input.frontierLimit,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw Error('Usage: pnpm solve:mastermind <question.json>');
    console.log(
      JSON.stringify(
        adviseMastermind(JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
