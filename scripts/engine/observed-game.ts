import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import type { GameSetup, Protagonist } from '../../packages/contracts/src/game.js';
import { setupSchema } from '../../packages/contracts/src/validation.js';
import { setupDomainSchema, type SetupDomain } from '../../packages/contracts/src/setup-domain.js';
import { generateSetups } from '../../packages/engine/src/decision/setup-space.js';
import {
  inferObservedWorlds,
  type DecisionEvidence,
} from '../../packages/engine/src/decision/observed-worlds.js';
import { observeQuestion } from '../../packages/engine/src/decision/position.js';
import { solveGoal } from '../../packages/engine/src/decision/goal.js';
import type { DecisionGoal } from '../../packages/engine/src/decision/verify-policy.js';
import { replayCandidates, type CandidateReplay } from './candidate-replays.js';

export interface ObservedQuestion {
  setups?: GameSetup[];
  setupDomains?: SetupDomain[];
  generationWorkLimit?: number;
  exhaustiveSetups: boolean;
  evidence: DecisionEvidence;
  goal?: DecisionGoal;
  historyWorkLimit?: number;
  worldLimit?: number;
  workLimit?: number;
  frontierLimit?: number;
}
export function resolveObservedCandidates(input: ObservedQuestion) {
  if (
    !input ||
    Array.isArray(input.setups) === Array.isArray(input.setupDomains) ||
    (input.setups !== undefined && !Array.isArray(input.setups)) ||
    (input.setupDomains !== undefined && !Array.isArray(input.setupDomains)) ||
    typeof input.exhaustiveSetups !== 'boolean' ||
    !input.evidence?.sheet ||
    (input.goal &&
      input.goal.kind !== 'game' &&
      !(
        input.goal.kind === 'seat-win' &&
        ['p0', 'p1', 'p2'].includes(input.goal.seat) &&
        input.goal.seat === input.evidence.seat
      ) &&
      (input.goal.kind !== 'survival' || typeof input.goal.target !== 'string'))
  )
    throw Error('Invalid observed game question');
  const sheet = input.evidence.sheet;
  const pack = compileOfficial(sheet.module, sheet.anniversary);
  const generated =
    input.setupDomains &&
    generateSetups(
      pack,
      input.evidence,
      input.setupDomains.map((d) => setupDomainSchema.parse(d)),
      input.generationWorkLimit ?? 100000,
    );
  const pool = generated?.setups ?? input.setups!.map((s) => setupSchema.parse(s));
  const { states, ...progress } = inferObservedWorlds(
    pack,
    pool,
    input.exhaustiveSetups,
    input.evidence,
    input.historyWorkLimit ?? 50000,
    input.worldLimit ?? 512,
  );
  const exhaustive = progress.exhaustive && (!generated || generated.stats.complete);
  const candidates = { exhaustive, states };
  return {
    pack,
    candidates,
    ...(generated && { generation: generated.stats }),
    history: {
      ...progress,
      exhaustive,
      ...(!progress.reason && !exhaustive && { reason: 'setup-domain' }),
      worlds: states.length,
    },
  };
}

export function adviseObservedGame(input: ObservedQuestion) {
  const { pack, candidates, ...stats } = resolveObservedCandidates(input);
  const advice = solveGoal(
    pack,
    candidates,
    input.goal ?? { kind: 'game' },
    input.workLimit ?? 10000,
    input.frontierLimit,
  );
  return { ...stats, advice };
}

/** A trusted host can export the observation without exporting scripts, opponent
 * commands or their card faces. The setup pool is supplied separately to inference. */
export function exportObservation(candidate: CandidateReplay, seat?: Protagonist) {
  const setup = setupSchema.parse(candidate?.setup);
  const pack = compileOfficial(setup.module, setup.anniversary);
  return observeQuestion([...replayCandidates(pack, [candidate])][0]!, seat);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const exporting = process.argv[2] === '--export';
    const path = process.argv[exporting ? 3 : 2];
    if (!path)
      throw Error(
        'Usage: pnpm solve:observed <question.json> or pnpm observe:decision <replays.json>',
      );
    const input = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const result = exporting
      ? exportObservation(input.candidates?.[0], process.argv[4] as Protagonist | undefined)
      : adviseObservedGame(input);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
