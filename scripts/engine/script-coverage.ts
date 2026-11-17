import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { maximizeCoverage, verifyCoverage } from '../../packages/engine/src/decision/coverage.js';
import type { PolicyNode } from '../../packages/contracts/src/decision.js';
import { resolveObservedCandidates, type ObservedQuestion } from './observed-game.js';
import { resolveReplayQuestion, type ReplayQuestion } from './candidate-replays.js';
export function coverageQuestion(
  input: (ObservedQuestion | ReplayQuestion) & { evaluationLimit?: number },
  policy?: PolicyNode,
) {
  const limit = input.workLimit ?? 100000;
  const pool =
    'evidence' in input
      ? { ...resolveObservedCandidates(input), goal: input.goal ?? { kind: 'game' as const } }
      : resolveReplayQuestion(input);
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
    const [question, policyFile] = process.argv.slice(2);
    if (!question || process.argv.length > 4)
      throw Error('Usage: pnpm solve:coverage <question.json> [policy-or-result.json]');
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const blob = policyFile ? read(policyFile) : undefined;
    const policy = blob?.coverage?.policy ?? blob?.advice?.policy ?? blob?.policy ?? blob;
    if (policyFile && (!policy || !Array.isArray(policy.responses)))
      throw Error('Expected a policy to verify');
    console.log(JSON.stringify(coverageQuestion(read(question), policy), null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
