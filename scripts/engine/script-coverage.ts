import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  maximizeCoverage,
  verifyCoverage,
  compareCoverage,
} from '../../packages/engine/src/decision/coverage.js';
import type { PolicyNode } from '../../packages/contracts/src/decision.js';
import { resolveObservedCandidates, type ObservedQuestion } from './observed-game.js';
import { resolveReplayQuestion, type ReplayQuestion } from './candidate-replays.js';
export function coverageQuestion(
  input: (ObservedQuestion | ReplayQuestion) & { evaluationLimit?: number },
  policy?: PolicyNode,
  other?: PolicyNode,
) {
  const limit = input.workLimit ?? 100000;
  const pool =
    'evidence' in input
      ? { ...resolveObservedCandidates(input), goal: input.goal ?? { kind: 'game' as const } }
      : resolveReplayQuestion(input);
  if (other) {
    if (!policy) throw Error('Expected two policies to compare');
    return {
      comparison: compareCoverage(pool.pack, pool.candidates, pool.goal, policy, other, limit),
    };
  }
  if (policy)
    return { verification: verifyCoverage(pool.pack, pool.candidates, pool.goal, policy, limit) };
  return {
    coverage: maximizeCoverage(
      pool.pack,
      pool.candidates,
      pool.goal,
      limit,
      input.evaluationLimit,
      input.frontierLimit,
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [question, policyFile, otherFile] = process.argv.slice(2);
    if (!question || process.argv.length > 5)
      throw Error(
        'Usage: pnpm solve:coverage <question.json> [policy-or-result.json] [second-policy.json]',
      );
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const readPolicy = (file?: string): PolicyNode | undefined => {
      if (!file) return;
      const blob = read(file);
      const policy = blob?.coverage?.policy ?? blob?.advice?.policy ?? blob?.policy ?? blob;
      if (!policy || !Array.isArray(policy.responses)) throw Error('Expected a policy to verify');
      return policy;
    };
    console.log(
      JSON.stringify(
        coverageQuestion(read(question), readPolicy(policyFile), readPolicy(otherFile)),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
