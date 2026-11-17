import { publicQuestion, rulesSupported, submitChoice, type PolicyCandidates } from './position.js';
import type { Choice } from '../../../contracts/src/game.js';
import { drive } from '../runtime/engine.js';
import { canonical, clone, type EngineState, type RulePack } from '../runtime/model.js';

export interface SurvivalResult {
  status: 'guaranteed' | 'counterexample' | 'unknown' | 'no-candidates';
  work: number;
  at?: Pick<EngineState, 'loop' | 'day' | 'phase'>;
  reason?: 'death' | 'left-play' | 'unavailable' | 'limit' | 'incomplete' | 'unsupported';
}

export function checkDayRoots(pack: RulePack, candidates: PolicyCandidates, target: string) {
  let question: string | undefined;
  for (const s of candidates.states) {
    if (
      s.ruleDigest !== pack.digest ||
      s.setup.module !== pack.module ||
      s.setup.anniversary !== pack.anniversary ||
      s.phase !== 'protagonist-abilities' ||
      s.pending?.kind !== 'ability' ||
      s.pending.actor !== s.captain ||
      s.winner ||
      s.characters[target]?.status !== 'alive'
    )
      throw Error('Expected a living target at the protagonist ability menu');
    const signature = publicQuestion(s);
    if (question !== undefined && question !== signature)
      throw Error('Different observed decision positions');
    question = signature;
  }
}

function prepare(
  pack: RulePack,
  candidates: PolicyCandidates,
  target: string,
  workPerPlan: number,
) {
  if (!Number.isSafeInteger(workPerPlan) || workPerPlan < 0)
    throw Error('Invalid per-plan work limit');
  checkDayRoots(pack, candidates, target);
  const worlds = candidates.states.map((s) => ({ s, supported: rulesSupported(pack, s) }));
  return function evaluate(
    plan: readonly Choice[],
    refine?: (choices: Choice[]) => void,
  ): SurvivalResult {
    if (
      !plan.length ||
      plan.some(
        (c) =>
          c.kind !== 'select' &&
          c.kind !== 'pass' &&
          (c.kind !== 'ability' || c.choices !== undefined),
      )
    )
      throw Error('Use menu commands, with target selections as separate choices');
    let work = 0;
    let doubt: SurvivalResult['reason'] = candidates.exhaustive ? undefined : 'incomplete';
    const result = (
      status: SurvivalResult['status'],
      reason?: SurvivalResult['reason'],
      state?: EngineState,
    ): SurvivalResult => ({
      status,
      work,
      ...(reason && { reason }),
      ...(state && { at: { loop: state.loop, day: state.day, phase: state.phase } }),
    });
    for (const { s: root, supported: known } of worlds) {
      if (!known) {
        doubt = 'unsupported';
        continue;
      }
      const start = clone(root);
      start.traceOutcomes = true;
      type Branch = { s: EngineState; step: number; audit: number; firstOpen?: Choice[] };
      const stack: Iterator<Branch>[] = [
        [{ s: start, step: 0, audit: start.audit.length }][Symbol.iterator](),
      ];
      function* children(
        b: Branch,
        choices: readonly Choice[],
        nextStep: number,
      ): Generator<Branch> {
        for (const choice of choices) {
          if (work >= workPerPlan) {
            doubt = 'limit';
            return;
          }
          work++;
          const r = submitChoice(pack, b.s, choice);
          if (r.status === 'rejected') {
            doubt = 'unsupported';
            continue;
          }
          yield { s: r.state, step: nextStep, audit: b.audit, firstOpen: b.firstOpen };
        }
      }
      while (stack.length) {
        const next = stack.at(-1)!.next();
        if (next.done) {
          stack.pop();
          continue;
        }
        const b = next.value;
        for (;;) {
          const s = b.s;
          for (; b.audit < s.audit.length; b.audit++)
            if (s.audit[b.audit]!.kind === 'character-died' && s.audit[b.audit]!.data === target) {
              refine?.(b.firstOpen ?? []);
              return result('counterexample', 'death', s);
            }
          if (s.diagnostic) {
            doubt = 'unsupported';
            break;
          }
          if (s.characters[target]!.status !== 'alive') {
            refine?.(b.firstOpen ?? []);
            return result('counterexample', 'left-play', s);
          }
          if (s.winner || s.day !== root.day || s.loop !== root.loop || s.phase === 'loop-end')
            break;
          if (work >= workPerPlan) return result('unknown', 'limit');
          if (!s.pending) {
            work++;
            drive(pack, s, 1);
            continue;
          }
          const d = s.pending;
          if (!d.options.length) {
            doubt = 'unsupported';
            break;
          }
          const own = s.phase === 'protagonist-abilities' && d.actor === root.captain;
          const command = own ? plan[b.step] : undefined;
          const forced =
            command ?? (own && d.kind === 'ability' ? { kind: 'pass' as const } : undefined);
          if (forced && !d.options.some((c) => canonical(c) === canonical(forced)))
            return result('counterexample', 'unavailable', s);
          if (refine && own && !forced && !b.firstOpen)
            b.firstOpen = d.options.filter((c) => c.kind === 'select');
          stack.push(children(b, forced ? [forced] : d.options, b.step + Number(!!command)));
          break;
        }
      }
    }
    if (doubt) return result('unknown', doubt);
    return result(worlds.length ? 'guaranteed' : 'no-candidates');
  };
}

/** Compare precommitted protagonist plans at one public ability menu. A plan consumes
 * its commands at that captain's prompts in the ability phase. Afterwards pass further
 * optional abilities. Every other legal choice is quantified universally. */
export function solveDaySurvival(
  pack: RulePack,
  candidates: PolicyCandidates,
  target: string,
  plans: readonly (readonly Choice[])[],
  workPerPlan: number,
) {
  const evaluate = prepare(pack, candidates, target, workPerPlan);
  return plans.map((p) => evaluate(p));
}

/** Search for one guaranteed opening followed only by selections. If an unspecified
 * selection leads to a loss, any safe refinement must choose from the first such menu
 * on that branch. A loss before any such menu rules out the entire prefix. */
export function findDaySurvival(
  pack: RulePack,
  candidates: PolicyCandidates,
  target: string,
  workPerPlan: number,
  maxPlans: number,
) {
  if (!Number.isSafeInteger(maxPlans) || maxPlans < 0) throw Error('Invalid plan limit');
  const evaluate = prepare(pack, candidates, target, workPerPlan);
  const pending: Choice[][] = (candidates.states[0]?.pending?.options ?? []).map((c) => [c]);
  let checked = 0,
    work = 0,
    unknown = !candidates.exhaustive;
  for (let i = 0; i < pending.length; i++) {
    if (checked === maxPlans) {
      unknown = true;
      break;
    }
    const plan = pending[i]!;
    const r = evaluate(plan, (choices) => {
      for (const c of choices) {
        if (pending.length >= maxPlans) {
          unknown = true;
          break;
        }
        pending.push([...plan, c]);
      }
    });
    checked++;
    work += r.work;
    if (r.status === 'guaranteed') return { status: 'guaranteed' as const, plan, checked, work };
    if (r.status === 'unknown') unknown = true;
  }
  const status = unknown
    ? 'unknown'
    : candidates.states.length
      ? 'no-guaranteed-plan'
      : 'no-candidates';
  return { status, plan: [], checked, work };
}
