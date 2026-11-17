import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PolicyNode } from '../../packages/engine/src/decision/policy-search.js';
import { verifyPolicy } from '../../packages/engine/src/decision/verify-policy.js';
import { resolveObservedCandidates, type ObservedQuestion } from './observed-game.js';
import { resolveReplayQuestion, type ReplayQuestion } from './candidate-replays.js';

export function verifyPolicyQuestion(
  input: ObservedQuestion | ReplayQuestion,
  policy: PolicyNode,
  includeHostWitness = false,
) {
  if (!input || typeof input !== 'object' || !policy) throw Error('Expected a question and policy');
  if ('evidence' in input) {
    const { pack, candidates, ...stats } = resolveObservedCandidates(input);
    return {
      ...stats,
      verification: verifyPolicy(
        pack,
        candidates,
        policy,
        input.goal ?? { kind: 'game' },
        input.workLimit ?? 100000,
        includeHostWitness,
      ),
    };
  }
  const { pack, goal, candidates } = resolveReplayQuestion(input);
  return {
    verification: verifyPolicy(
      pack,
      candidates,
      policy,
      goal,
      input.workLimit ?? 100000,
      includeHostWitness,
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [questionFile, policyFile, flag] = process.argv.slice(2);
    if (
      !questionFile ||
      !policyFile ||
      (flag && flag !== '--host-witness') ||
      process.argv.length > 5
    )
      throw Error(
        'Usage: pnpm verify:policy <question.json> <policy-or-advice.json> [--host-witness]',
      );
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const policy = read(policyFile);
    const result = verifyPolicyQuestion(
      read(questionFile),
      policy.advice?.policy ?? policy.policy ?? policy,
      flag === '--host-witness',
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
