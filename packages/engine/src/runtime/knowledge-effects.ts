import { COUNTERS } from './model.js';
import type { Counter } from '../../../contracts/src/game.js';
import type { Ability, Condition, Effect, Selector, Step, Value } from './model.js';
export type Options = Selector | string[];
export type ChangeKind =
  | 'counter'
  | 'move'
  | 'kill'
  | 'revive'
  | 'remove'
  | 'failure'
  | 'protagonist-death';
export interface VisibleChange {
  kind: ChangeKind;
  target: string;
  counter?: Counter;
  sign?: number;
  destination?: string;
  before?: number;
  after?: number;
}
export interface EffectSource {
  ownerRange?: 'self' | 'self-board' | 'same-area';
  deathGuard?: boolean;
  selection?: { key: string; different: string[]; equal: string[] };
  counterSelection?: string;
  independentOfCulprit?: boolean;
  amount?: number;
  maxContribution?: number;
  invocationTiming?: Ability['timing'] | '*';
  invocation?: Extract<Effect, { op: 'invoke-goodwill' | 'invoke-incident' }>;
  entryStep?: boolean;
  kind?: ChangeKind;
  counter?: string;
  sign?: number;
  destination?: string;
  timing: Ability['timing'] | '*';
  target?: string;
  choices: Map<string, Options>;
  detached: boolean;
  ability?: Ability;
  conditions: Condition[];
  safeSnapshot: boolean;
  reports: number;
  delay?: { day?: Value; loop?: Value; origin: Ability['timing'] | '*'; conditions: Condition[] };
}
const reactive = new Set(['death', 'incident-completed', 'goodwill-completed']);
/** A scheduled or invoked result can outlive the death window that started it. */
export function directDeathEffect(source: EffectSource) {
  return source.ability?.timing === 'death' && !source.delay && !source.invocation;
}
function sameArea(condition: Condition | undefined): boolean {
  if (!condition || typeof condition !== 'object') return false;
  if ('all' in condition) return condition.all.some(sameArea);
  if ('any' in condition) return condition.any.length > 0 && condition.any.every(sameArea);
  if (!('cmp' in condition) || condition.cmp !== 'eq') return false;
  const field = (v: unknown, target: string) =>
    !!v &&
    typeof v === 'object' &&
    'field' in v &&
    v.field === 'area' &&
    'target' in v &&
    v.target === target;
  return (
    (field(condition.left, '$it') && field(condition.right, '$self')) ||
    (field(condition.right, '$it') && field(condition.left, '$self'))
  );
}

function ownerRange(
  target: string | undefined,
  bindings: Map<string, Options>,
  detached: boolean,
): EffectSource['ownerRange'] {
  if (detached || !target) return;
  if (target === '$self') return 'self';
  if (target === '$self.area') return 'self-board';
  const options = target.startsWith('$') && bindings.get(target.slice(1));
  if (options && !Array.isArray(options) && sameArea(options.where)) return 'same-area';
}

// Local choices and the iteration variable are the only dynamic references
// proven independent here. Inspect their selectors as well as the effect.
function dependsOnCulprit(value: unknown, bindings: ReadonlyMap<string, Options>): boolean {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1).split('.')[0]!;
    return key === 'self' || (key !== 'it' && !bindings.has(key));
  }
  return (
    !!value &&
    typeof value === 'object' &&
    Object.values(value).some((v) => dependsOnCulprit(v, bindings))
  );
}
// Upper bound on observed fields per activation, including compound changes.
function bound(e: Effect): number {
  if (e.op === 'when') return e.effects.reduce((n, e) => n + bound(e), 0);
  if (e.op === 'each')
    return e.selector.kind === 'boards'
      ? 4 * e.effects.reduce((n, e) => n + bound(e), 0)
      : Infinity;
  if (['invoke-goodwill', 'invoke-incident', 'schedule', 'move-corpse'].includes(e.op))
    return Infinity;
  if (e.op === 'clear') return e.counter ? 1 : COUNTERS.length;
  if (e.op === 'transfer' || e.op === 'replace') return 2;
  return 1;
}
function singleTarget(effects: Effect[]): boolean {
  return (
    effects.length === 1 &&
    (['counter', 'move', 'place', 'remove', 'kill', 'revive', 'clear', 'replace'].includes(
      effects[0]!.op,
    ) ||
      (effects[0]!.op === 'when' && singleTarget(effects[0]!.effects)))
  );
}
export function matchesChange(s: EffectSource, q: VisibleChange) {
  if (s.kind && s.kind !== q.kind) return false;
  if (q.kind !== 'counter') return true;
  if (s.sign !== undefined && s.sign !== q.sign) return false;
  if (s.counter && !s.counter.startsWith('$')) return s.counter === q.counter;
  const choices = s.counter && s.choices.get(s.counter.slice(1));
  return !Array.isArray(choices) || choices.some((v) => v.startsWith('$') || v === q.counter);
}
export function compileEffects(
  steps: Step[],
  timing: EffectSource['timing'],
  ability?: Ability,
): EffectSource[] {
  const result: EffectSource[] = [],
    choices = new Map<string, Options>();
  const keys = steps.flatMap((step) => (step.choices ?? []).map((c) => c.key));
  const unique = new Set(keys.filter((k) => keys.indexOf(k) === keys.lastIndexOf(k)));
  function relatedChoices(c: Condition | undefined, comparison: 'eq' | 'ne'): string[] {
    if (!c || typeof c !== 'object') return [];
    if ('all' in c) return c.all.flatMap((part) => relatedChoices(part, comparison));
    if (!('cmp' in c) || c.cmp !== comparison) return [];
    const ref = (v: Value) => (v && typeof v === 'object' && 'ref' in v ? v.ref : undefined);
    const left = ref(c.left),
      right = ref(c.right);
    const other = left === '$it' ? right : right === '$it' ? left : undefined;
    return other?.startsWith('$') && unique.has(other.slice(1)) ? [other.slice(1)] : [];
  }
  const reports = steps.some((s) => s.moveOthersFromEffectiveArea)
    ? Infinity
    : steps.reduce((n, s) => n + s.effects.reduce((n, e) => n + bound(e), 0), 0);
  // Mandatory abilities may settle simultaneously with other sources. Their public records
  // do not expose a settlement boundary, so mutable predicates cannot use a partial snapshot.
  const safeSnapshot =
    !ability?.mandatory &&
    steps.length === 1 &&
    !steps[0]!.moveOthersFromEffectiveArea &&
    singleTarget(steps[0]!.effects) &&
    !reactive.has(timing);
  function walk(
    effects: Effect[],
    at: EffectSource['timing'],
    bindings: Map<string, Options>,
    conditions: Condition[],
    detached = false,
    delay?: EffectSource['delay'],
  ) {
    let independentOfCulprit = false;
    const add = (
      target?: string,
      kind?: ChangeKind,
      counter?: string,
      sign?: number,
      destination?: string,
      amount?: number,
      deathGuard?: boolean,
    ) =>
      result.push({
        ownerRange: ownerRange(target, bindings, detached),
        deathGuard,
        selection:
          !detached && target?.startsWith('$') && unique.has(target.slice(1))
            ? {
                key: target.slice(1),
                different: relatedChoices(
                  (bindings.get(target.slice(1)) as Selector | undefined)?.where,
                  'ne',
                ),
                equal: relatedChoices(
                  (bindings.get(target.slice(1)) as Selector | undefined)?.where,
                  'eq',
                ),
              }
            : undefined,
        counterSelection:
          !detached && counter?.startsWith('$') && unique.has(counter.slice(1))
            ? counter.slice(1)
            : undefined,
        independentOfCulprit,
        timing: at,
        entryStep,
        target,
        kind,
        counter,
        sign,
        destination,
        amount,
        maxContribution:
          ability?.mandatory && amount !== undefined && !bindings.has('it') && !detached
            ? Math.abs(amount)
            : undefined,
        choices: new Map(bindings),
        detached,
        ability,
        conditions,
        safeSnapshot,
        reports,
        delay,
      });
    for (const e of effects) {
      independentOfCulprit =
        !ability &&
        at === 'incident' &&
        !detached &&
        !dependsOnCulprit([e, conditions, ...bindings.values()], bindings);
      switch (e.op) {
        case 'counter':
          add(
            e.target,
            'counter',
            e.counter,
            typeof e.amount === 'number' ? Math.sign(e.amount) : undefined,
            undefined,
            typeof e.amount === 'number' ? e.amount : undefined,
          );
          break;
        case 'when':
          walk(e.effects, at, bindings, [...conditions, e.condition], detached, delay);
          break;
        case 'each':
          walk(
            e.effects,
            at,
            new Map([...bindings, ['it', e.selector]]),
            conditions,
            detached,
            delay,
          );
          break;
        case 'schedule':
          walk(
            e.effects,
            e.timing,
            new Map(),
            [],
            true,
            delay
              ? { origin: '*', conditions: [] }
              : { day: e.day, loop: e.loop, origin: at, conditions },
          );
          break;
        case 'invoke-goodwill':
        case 'invoke-incident':
          result.push({
            ability,
            invocation: e,
            invocationTiming: at,
            timing: '*',
            choices: new Map(),
            detached: true,
            conditions: [],
            safeSnapshot: false,
            reports: Infinity,
          });
          break;
        case 'clear':
          add(e.target, 'counter', e.counter, -1);
          break;
        case 'transfer':
          add(e.from, 'counter', e.counter, -1);
          add(e.to, 'counter', e.counter, 1);
          break;
        case 'replace':
          add(e.target, 'counter', e.from, -1);
          add(e.target, 'counter', e.to, 1);
          break;
        case 'kill':
          add(e.target, 'kill');
          add(e.target, 'counter', 'guard', -1, undefined, -1, true);
          break;
        case 'revive':
          add(e.target, 'revive');
          break;
        case 'remove':
          add(e.target, 'remove');
          break;
        case 'move-corpse':
          add(e.target, 'move', undefined, undefined, e.area);
          add(undefined, 'counter', 'intrigue', -1, undefined, -1);
          add(undefined, 'counter', 'intrigue', 1, undefined, 1);
          break;
        case 'move':
        case 'place':
          add(e.target, 'move', undefined, undefined, e.area);
          break;
        case 'reveal-identity':
        case 'flag':
        case 'protect-protagonists':
          break;
        case 'protagonist-death':
          add(undefined, 'protagonist-death');
          break;
        case 'fail':
          add(undefined, 'failure');
          break;
        case 'end-loop':
        case 'world-move':
        case 'grant':
        case 'ex':
        case 'reveal-rule':
        case 'reveal-culprit':
        case 'recover-card':
        case 'curse':
        case 'same-identity':
          break;
        default:
          add();
      }
    }
  }
  let entryStep = true;
  for (const step of steps) {
    for (const c of step.choices ?? []) choices.set(c.key, c.options);
    const at = reactive.has(timing) ? '*' : timing;
    const conditions = [ability?.condition, step.condition].filter(
      (v): v is Condition => v !== undefined,
    );
    if (step.moveOthersFromEffectiveArea) {
      // The engine replaces this step's effects with moves once the effective area is known.
      result.push({
        kind: 'move',
        timing: at,
        entryStep,
        ability,
        choices: new Map(choices),
        conditions,
        detached: reactive.has(timing),
        safeSnapshot: false,
        reports,
      });
    } else walk(step.effects, at, choices, conditions, reactive.has(timing));
    entryStep = false;
  }
  // A bound belongs to an activation, not to one instruction. A second
  // matching counter instruction or a dynamic output can raise its contribution.
  for (const s of result) {
    if (s.maxContribution === undefined) continue;
    if (
      result.some(
        (other) =>
          other !== s &&
          (!other.kind || other.kind === 'counter') &&
          (!other.counter || other.counter.startsWith('$') || other.counter === s.counter) &&
          (other.sign === undefined || other.sign === s.sign),
      )
    )
      s.maxContribution = undefined;
  }
  return result;
}
