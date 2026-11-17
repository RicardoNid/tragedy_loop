import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commandSchema } from '../../packages/contracts/src/validation.js';
import { solveGoal } from '../../packages/engine/src/decision/goal.js';
import { findMastermindPolicy } from '../../packages/engine/src/decision/mastermind-policy.js';
import { resolveObservedCandidates, type ObservedQuestion } from './observed-game.js';
import {
  resolveReplayCandidates,
  resolveReplayQuestion,
  type ReplayQuestion,
} from './candidate-replays.js';
import type { MastermindQuestion } from './mastermind-policy.js';

export function readOpening(value: unknown) {
  const parsed = commandSchema.safeParse({
    id: 'opening',
    decisionId: 'opening',
    expectedRevision: 0,
    choice: value,
  });
  if (!parsed.success) throw Error('请选择格式有效的行动');
  return parsed.data.choice;
}
export function evaluateActionQuestion(
  input: ObservedQuestion | ReplayQuestion | MastermindQuestion,
  value: unknown,
) {
  const opening = readOpening(value);
  const limit = input.workLimit ?? 10000;
  if ('perspective' in input) {
    if (input.perspective !== 'mastermind') throw Error('Invalid perspective');
    const { pack, candidates } = resolveReplayCandidates(input);
    return {
      opening,
      advice: findMastermindPolicy(
        pack,
        candidates,
        input.goal,
        limit,
        input.frontierLimit,
        opening,
      ),
    };
  }
  if ('evidence' in input) {
    const { pack, candidates, ...metrics } = resolveObservedCandidates(input);
    return {
      opening,
      ...metrics,
      advice: solveGoal(
        pack,
        candidates,
        input.goal ?? { kind: 'game' },
        limit,
        input.frontierLimit,
        opening,
      ),
    };
  }
  const { pack, candidates, goal } = resolveReplayQuestion(input);
  return {
    opening,
    advice: solveGoal(pack, candidates, goal, limit, input.frontierLimit, opening),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [question, choice] = process.argv.slice(2);
    if (!question || !choice || process.argv.length !== 4)
      throw Error('Usage: pnpm solve:action <question.json> <choice.json>');
    const read = (file: string) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    console.log(JSON.stringify(evaluateActionQuestion(read(question), read(choice)), null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
