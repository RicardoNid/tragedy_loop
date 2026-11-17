import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InvestigationOptions } from '../../packages/contracts/src/investigation.js';
import { solveInvestigation } from '../../packages/engine/src/decision/investigation.js';
import { resolveReplayQuestion, type ReplayQuestion } from './candidate-replays.js';
import { resolveObservedCandidates, type ObservedQuestion } from './observed-game.js';

export function investigate(
  input: (ObservedQuestion | ReplayQuestion) & { investigation: InvestigationOptions },
) {
  if (!input?.investigation) throw Error('Expected investigation.target and a decision question');
  const options = { ...input.investigation };
  if ('evidence' in input) {
    if (options.seat !== undefined && options.seat !== input.evidence.seat)
      throw Error('Mismatched investigation perspective');
    options.seat = input.evidence.seat;
    const { pack, candidates, ...stats } = resolveObservedCandidates(input);
    return {
      ...stats,
      investigation: solveInvestigation(
        pack,
        candidates,
        options,
        input.workLimit ?? 10000,
        input.frontierLimit,
      ),
    };
  }
  if (input.seat && options.seat && options.seat !== input.seat)
    throw Error('Mismatched investigation perspective');
  options.seat ??= input.seat;
  const { pack, candidates } = resolveReplayQuestion(input);
  return {
    investigation: solveInvestigation(
      pack,
      candidates,
      options,
      input.workLimit ?? 10000,
      input.frontierLimit,
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, kind, id, depth] = process.argv.slice(2);
    if (!file || (kind !== undefined && (!id || !['identity', 'culprit'].includes(kind))))
      throw Error(
        'Usage: pnpm investigate <question.json> [identity <character> | culprit <day>] [maxAbilities]',
      );
    const input = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (kind)
      input.investigation = {
        ...input.investigation,
        target: kind === 'culprit' ? { kind, day: Number(id) } : { kind, character: id },
        ...(depth && { maxAbilities: Number(depth) }),
      };
    console.log(JSON.stringify(investigate(input), null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
