import type {
  DecisionAnalysis,
  DecisionGoal,
  PolicyNode,
} from '../../../../packages/contracts/src/decision.js';
import { solveGoal } from '../../../../packages/engine/src/decision/goal.js';
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

export interface AnalysisRequest {
  mode: 'inspect' | 'solve' | 'verify';
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
        historyReason: history.reason,
        generatedSetups: generation?.legal,
      },
    };
  }
  return { ...resolveReplayQuestion(input), metrics: {} };
}
export function analyze(request: AnalysisRequest): DecisionAnalysis {
  if (
    !request ||
    !['inspect', 'solve', 'verify'].includes(request.mode) ||
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
    out.sheet = { loops: sheet.loops, days: sheet.days, incidents: sheet.incidents };
  }
  if (request.mode === 'solve')
    out.advice = solveGoal(pack, candidates, goal, workLimit, input.frontierLimit);
  if (request.mode === 'verify') {
    if (!request.policy) throw Error('请选择待复核的策略');
    out.verification = verifyPolicy(pack, candidates, request.policy, goal, workLimit);
  }
  return out;
}
