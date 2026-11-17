import type {
  DecisionAnalysis,
  DecisionGoal,
  PolicyNode,
} from '../../../../packages/contracts/src/decision.js';
import { solveGoal } from '../../../../packages/engine/src/decision/goal.js';
import type { InvestigationOptions } from '../../../../packages/contracts/src/investigation.js';
import { solveInvestigation } from '../../../../packages/engine/src/decision/investigation.js';
import {
  observeQuestion,
  publicQuestion,
} from '../../../../packages/engine/src/decision/position.js';
import { verifyPolicy } from '../../../../packages/engine/src/decision/verify-policy.js';
import {
  resolveReplayQuestion,
  type ReplayQuestion,
} from '../../../../scripts/engine/candidate-replays.js';
import {
  resolveObservedCandidates,
  type ObservedQuestion,
} from '../../../../scripts/engine/observed-game.js';
import { loadScenario } from './scenarios.js';
import {
  maximizeCoverage,
  verifyCoverage,
} from '../../../../packages/engine/src/decision/coverage.js';
import { cardCount } from '../../../../packages/engine/src/runtime/engine.js';
import { readOpening } from '../../../../scripts/engine/evaluate-action.js';
import type { Choice } from '../../../../packages/contracts/src/game.js';

export interface AnalysisRequest {
  mode: 'inspect' | 'solve' | 'verify' | 'investigate' | 'action' | 'coverage' | 'verify-coverage';
  choice?: Choice;
  investigation?: InvestigationOptions;
  scenario?: string;
  question?: ObservedQuestion | ReplayQuestion;
  workLimit?: number;
  policy?: PolicyNode;
}
function resolveInput(input: ObservedQuestion | ReplayQuestion) {
  if ('evidence' in input) {
    const { pack, candidates, history, generation } = resolveObservedCandidates(input);
    const goal: DecisionGoal = input.goal ?? { kind: 'game' };
    return {
      pack,
      candidates,
      goal,
      metrics: {
        historyWork: history.work,
        dayEndPruning: history.dayEndPruning,
        historyReason: history.reason,
        generatedSetups: generation?.legal,
        ...(history.scriptEvidence?.length && {
          scriptPruning: {
            skippedSetups: history.prunedSetups ?? 0,
            skippedChoices: generation?.prunedChoices ?? 0,
            incidentExamples: history.incidentExamples,
            sources: history.scriptEvidence.map((f) => ({
              kind: f.kind,
              ...('report' in f && { report: f.report }),
              ...(f.kind === 'missing-loop-grant' && {
                character: f.character,
                grant: f.grant,
                endReport: f.endReport,
              }),
              ...(f.kind === 'incident-outcome' && { occurred: f.occurred }),
            })),
          },
        }),
      },
    };
  }
  return { ...resolveReplayQuestion(input), metrics: {} };
}
export function analyze(request: AnalysisRequest): DecisionAnalysis {
  if (
    !request ||
    ![
      'inspect',
      'solve',
      'verify',
      'investigate',
      'action',
      'coverage',
      'verify-coverage',
    ].includes(request.mode) ||
    (request.scenario !== undefined) === (request.question !== undefined)
  )
    throw Error('请选择一个示例或导入一份问题');
  const input = request.scenario !== undefined ? loadScenario(request.scenario) : request.question!;
  if (!input || typeof input !== 'object') throw Error('问题应为 JSON 对象');
  const workLimit =
    request.workLimit ?? input.workLimit ?? (request.mode === 'verify' ? 100000 : 10000);
  function limit(value: number | undefined, maximum: number, label: string) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > maximum))
      throw Error(label + '需要是 0 至 ' + maximum + ' 之间的整数');
  }
  limit(workLimit, 1000000, '正向预算');
  limit(input.frontierLimit, 4096, '分支上限');
  if ('evidence' in input) {
    limit(input.worldLimit, 4096, '世界上限');
    limit(input.historyWorkLimit, 1000000, '重建预算');
    limit(input.generationWorkLimit, 1000000, '剧本生成预算');
  }
  const { pack, candidates, goal, metrics } = resolveInput(input);
  if (
    !goal ||
    !['game', 'seat-win', 'survival'].includes(goal.kind) ||
    (goal.kind === 'seat-win' && !['p0', 'p1', 'p2'].includes(goal.seat)) ||
    (goal.kind === 'survival' && typeof goal.target !== 'string')
  )
    throw Error('无效的决策目标');
  const seat = goal.kind === 'seat-win' ? goal.seat : undefined;
  const first = candidates.states[0];
  if (request.mode === 'inspect' && first) {
    const key = publicQuestion(first, seat);
    if (candidates.states.some((s) => publicQuestion(s, seat) !== key))
      throw Error('候选重放停在不同的可见局面');
  }
  const out: DecisionAnalysis = {
    module: pack.module,
    goal,
    worlds: candidates.states.length,
    exhaustive: candidates.exhaustive,
    ...metrics,
  };
  if (first) {
    const { view, sheet } = observeQuestion(first, seat);
    out.view = view;
    if (view.menu.kind === 'cards')
      out.actionInput = { cardCount: cardCount(first, view.menu.actor) };
    if (view.answerKind === 'identities')
      out.actionInput = { identities: Object.keys(pack.identities).sort() };
    out.sheet = { loops: sheet.loops, days: sheet.days, incidents: sheet.incidents };
    const hint = input.investigation;
    const proposed = hint?.target;
    const maxAbilities = Number.isSafeInteger(hint?.maxAbilities) ? hint!.maxAbilities : 1;
    if (proposed?.kind === 'culprit' && sheet.incidents.some((i) => i.day === proposed.day))
      out.suggestedInvestigation = { target: { kind: 'culprit', day: proposed.day }, maxAbilities };
    if (proposed?.kind === 'identity' && view.characters.some((c) => c.id === proposed.character))
      out.suggestedInvestigation = {
        target: { kind: 'identity', character: proposed.character },
        maxAbilities,
      };
  }
  if (request.mode === 'solve')
    out.advice = solveGoal(pack, candidates, goal, workLimit, input.frontierLimit);
  if (request.mode === 'action') {
    out.opening = readOpening(request.choice);
    out.advice = solveGoal(pack, candidates, goal, workLimit, input.frontierLimit, out.opening);
  }
  if (request.mode === 'verify') {
    if (!request.policy) throw Error('请选择待复核的策略');
    out.verification = verifyPolicy(pack, candidates, request.policy, goal, workLimit);
  }
  if (request.mode === 'coverage')
    out.coverage = maximizeCoverage(pack, candidates, goal, workLimit, 256, input.frontierLimit);
  if (request.mode === 'verify-coverage') {
    if (!request.policy) throw Error('请选择待复核的策略');
    out.coverageCheck = verifyCoverage(pack, candidates, goal, request.policy, workLimit);
  }
  if (request.mode === 'investigate') {
    if (
      !request.investigation ||
      (request.investigation.seat !== undefined && request.investigation.seat !== seat)
    )
      throw Error('请选择当前视角下的调查目标');
    const selected = request.investigation.target;
    if (!selected || !['identity', 'culprit'].includes(selected.kind))
      throw Error('无效的调查对象');
    const options: InvestigationOptions = {
      target:
        selected.kind === 'identity'
          ? { kind: 'identity', character: selected.character }
          : { kind: 'culprit', day: selected.day },
      maxAbilities: request.investigation.maxAbilities ?? 1,
      seat,
    };
    out.investigation = {
      options,
      result: solveInvestigation(pack, candidates, options, workLimit, input.frontierLimit),
    };
  }
  return out;
}
