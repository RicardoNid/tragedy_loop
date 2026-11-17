import type { DecisionGoal, PolicyNode } from '../../../contracts/src/decision.js';
import type {
  CoverageResult,
  CoverageCheck,
  CoverageComparison,
  ScriptVerdict,
} from '../../../contracts/src/coverage.js';
import { canonical, type EngineState, type RulePack } from '../runtime/model.js';
import { ordinaryAnswerClass } from './final.js';
import { solveGoal } from './goal.js';
import { publicQuestion, rulesSupported, type PolicyCandidates } from './position.js';
import { verifyPolicy } from './verify-policy.js';
import { checkDayRoots } from './day-survival.js';

function groupScripts(pack: RulePack, candidates: PolicyCandidates, goal: DecisionGoal) {
  if (!goal || !['survival', 'game', 'seat-win'].includes(goal.kind))
    throw Error('Invalid coverage goal');
  if (goal.kind === 'survival') checkDayRoots(pack, candidates, goal.target);
  const map = new Map<string, EngineState[]>();
  let question: string | undefined;
  const seat = goal.kind === 'seat-win' ? goal.seat : undefined;
  for (const s of candidates.states) {
    if (
      s.ruleDigest !== pack.digest ||
      s.setup.module !== pack.module ||
      s.setup.anniversary !== pack.anniversary
    )
      throw Error('Different rule pack');
    const visible = publicQuestion(s, seat);
    if (question !== undefined && visible !== question)
      throw Error('Different observed decision positions');
    question = visible;
    const { privateRoles, characters, x, incidents, ...fixed } = s.setup;
    // Role shuffles, card deals and hidden command sequences stay inside the
    // same script. Equivalent roster and X ordering cannot increase its weight.
    const key = canonical({
      ...fixed,
      publicSpecialRules: fixed.publicSpecialRules ?? [],
      x: [...x].sort(),
      characters: characters
        .map((c) => ({
          ...c,
          enterLoop: c.enterLoop ?? 1,
          initialArea: c.initialArea ?? pack.characters[c.character]?.initial[0] ?? 'hospital',
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      incidents: incidents
        .map((i) => ({ ...i, publicName: i.publicName ?? i.name }))
        .sort((a, b) => a.day - b.day),
    });
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return [...map.keys()].sort().map((key) => map.get(key)!);
}

/** Lexicographic index combinations without recursion or materializing the powerset. */
function* subsets(ids: number[], size: number) {
  if (size < 1 || size > ids.length) return;
  const offsets = Array.from({ length: size }, (_, i) => i);
  for (;;) {
    yield offsets.map((i) => ids[i]!);
    let p = size - 1;
    while (p >= 0 && offsets[p] === ids.length - size + p) p--;
    if (p < 0) return;
    offsets[p] = offsets[p]! + 1;
    for (let i = p + 1; i < size; i++) offsets[i] = offsets[i - 1]! + 1;
  }
}

/** A script counts only if one shared, observation-dependent policy succeeds
 * against every opponent move in all of that script's compatible histories. */
export function maximizeCoverage(
  pack: RulePack,
  candidates: PolicyCandidates,
  goal: DecisionGoal,
  workLimit: number,
  evaluationLimit = 256,
  frontierLimit = 512,
): CoverageResult {
  if (![workLimit, evaluationLimit].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw Error('Invalid coverage limits');
  if (!Number.isSafeInteger(frontierLimit) || frontierLimit < 1)
    throw Error('Invalid coverage frontier limit');
  const groups = groupScripts(pack, candidates, goal),
    n = groups.length;
  let work = 0,
    evaluations = 0,
    lower = 0,
    policy: PolicyNode | undefined;
  const result = (
    status: CoverageResult['status'],
    upper?: number,
    reason?: CoverageResult['reason'],
  ): CoverageResult => ({
    status,
    scripts: n,
    lower,
    upper,
    work,
    evaluations,
    ...(reason && { reason }),
    ...(policy && { policy }),
  });
  if (!candidates.exhaustive) return result('unknown', undefined, 'incomplete');
  if (!n) return result('no-candidates', 0);
  if (
    candidates.states.some((s) => !rulesSupported(pack, s)) ||
    (pack.module === 'LL' && goal.kind === 'game')
  )
    return result('unknown', n, 'unsupported');
  const seen = new Map<string, 'yes' | 'no' | 'unknown'>();
  const probe = (ids: number[]) => {
    const key = ids.join(','),
      old = seen.get(key);
    if (old) return old;
    if (work >= workLimit || evaluations >= evaluationLimit) return 'limit';
    evaluations++;
    work++;
    const a = solveGoal(
      pack,
      { exhaustive: true, states: ids.flatMap((id) => groups[id]!) },
      goal,
      workLimit - work,
      frontierLimit,
    );
    work += a.work;
    const verdict =
      a.status === 'guaranteed' ? 'yes' : a.status === 'no-guaranteed-policy' ? 'no' : 'unknown';
    if (verdict === 'yes' && ids.length > lower) {
      lower = ids.length;
      policy = a.policy;
    }
    seen.set(key, verdict);
    return verdict;
  };
  const finish = (upper: number) =>
    lower === upper ? result('optimal', upper) : result('bounded', upper, 'limit');
  const all = groups.map((_, i) => i);
  // Outside LL an incorrect ordinary final answer immediately loses. Different
  // complete answer classes therefore cannot both be covered by one policy.
  if (
    goal.kind === 'game' &&
    pack.module !== 'LL' &&
    candidates.states.every(
      (s) => s.phase === 'final-guess' && s.pending?.kind === 'guess' && !s.flags['c-guess'],
    )
  ) {
    const classes = new Map<string, number[]>();
    for (const id of all) {
      const signatures = new Set(groups[id]!.map((s) => ordinaryAnswerClass(pack, s)));
      if (signatures.size !== 1) continue;
      const key = [...signatures][0]!,
        entry = classes.get(key) ?? [];
      entry.push(id);
      classes.set(key, entry);
    }
    const ranked = [...classes.values()].sort((a, b) => b.length - a.length);
    const upper = ranked[0]?.length ?? 0;
    // Every member accepts this class's full canonical answer. Only the
    // execution certificate may still exceed the supplied budget.
    for (const ids of ranked) {
      if (ids.length <= lower) break;
      const r = probe(ids);
      if (r === 'limit' || r === 'yes') break;
    }
    return finish(upper);
  }
  const full = probe(all);
  if (full === 'yes') return finish(n);
  let upper = full === 'no' ? n - 1 : n;
  if (!upper || full === 'limit') return finish(upper);
  const eligible: number[] = [];
  let individuallyLost = 0;
  for (const id of all) {
    const single = probe([id]);
    if (single === 'limit') return finish(upper);
    if (single === 'no') {
      individuallyLost++;
      upper = Math.min(upper, n - individuallyLost);
    } else eligible.push(id);
  }
  upper = Math.min(upper, eligible.length);
  let unresolved = 0;
  for (let size = upper; size > lower; size--) {
    for (const ids of subsets(eligible, size)) {
      const r = probe(ids);
      if (r === 'limit') return finish(Math.max(size, unresolved));
      if (r === 'unknown') unresolved = Math.max(unresolved, size);
      if (r === 'yes') return finish(Math.max(lower, unresolved));
    }
  }
  return finish(Math.max(lower, unresolved));
}

/** Independently check the submitted policy in every history of each script.
 * One counterexample refutes coverage of that entire script. */
export function verifyCoverage(
  pack: RulePack,
  candidates: PolicyCandidates,
  goal: DecisionGoal,
  policy: PolicyNode,
  limit: number,
): CoverageCheck {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid coverage verification limit');
  const groups = groupScripts(pack, candidates, goal);
  const out: CoverageCheck = {
    scripts: groups.length,
    verified: 0,
    refuted: 0,
    unresolved: 0,
    work: 0,
    exhaustive: candidates.exhaustive,
  };
  for (const states of groups) {
    const { verdict, work } = checkScript(
      pack,
      states,
      candidates.exhaustive,
      goal,
      policy,
      limit - out.work,
    );
    out.work += work;
    out[verdict]++;
  }
  return out;
}

function checkScript(
  pack: RulePack,
  states: EngineState[],
  exhaustive: boolean,
  goal: DecisionGoal,
  policy: PolicyNode,
  limit: number,
): { verdict: ScriptVerdict; work: number } {
  if (!limit) return { verdict: 'unresolved', work: 0 };
  const checked = verifyPolicy(pack, { exhaustive, states }, policy, goal, limit);
  const verdict =
    checked.status === 'verified'
      ? 'verified'
      : checked.status === 'counterexample'
        ? 'refuted'
        : 'unresolved';
  return { verdict, work: checked.work };
}

/** Compare the sets of scripts for which each submitted policy guarantees the
 * same goal. A proved directional difference survives uncertainty in other rows. */
export function compareCoverage(
  pack: RulePack,
  candidates: PolicyCandidates,
  goal: DecisionGoal,
  leftPolicy: PolicyNode,
  rightPolicy: PolicyNode,
  limit: number,
): CoverageComparison {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid comparison work limit');
  const groups = groupScripts(pack, candidates, goal);
  let leftBudget = Math.ceil(limit / 2),
    rightBudget = Math.floor(limit / 2);
  const scripts = groups.map((states, index) => {
    const left = checkScript(pack, states, candidates.exhaustive, goal, leftPolicy, leftBudget);
    const right = checkScript(pack, states, candidates.exhaustive, goal, rightPolicy, rightBudget);
    leftBudget -= left.work;
    rightBudget -= right.work;
    return { script: index + 1, left: left.verdict, right: right.verdict };
  });
  const difference = (a: 'left' | 'right', b: 'left' | 'right') => ({
    established: scripts.some((s) => s[a] === 'verified' && s[b] === 'refuted'),
    possible: scripts.some((s) => s[a] !== 'refuted' && s[b] !== 'verified'),
  });
  const leftOnly = difference('left', 'right'),
    rightOnly = difference('right', 'left');
  let relation: CoverageComparison['relation'] = 'unknown';
  if (candidates.exhaustive) {
    if (!scripts.length) relation = 'no-candidates';
    else if (leftOnly.established && rightOnly.established) relation = 'incomparable';
    else if (leftOnly.established && !rightOnly.possible) relation = 'left-superset';
    else if (rightOnly.established && !leftOnly.possible) relation = 'right-superset';
    else if (!leftOnly.possible && !rightOnly.possible) relation = 'equivalent';
  }
  return {
    relation,
    exhaustive: candidates.exhaustive,
    work: limit - leftBudget - rightBudget,
    scripts,
  };
}
