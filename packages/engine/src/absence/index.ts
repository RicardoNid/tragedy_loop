import { absenceProgramIndex } from './programs.js';
import type { PlayerView, PublicCharacter } from '../../../contracts/src/game.js';
import { roleImmortal } from '../runtime/expressions.js';
import { publicCondition, type PublicContext } from '../runtime/knowledge-conditions.js';
import type { Condition, Effect, RulePack } from '../runtime/model.js';

/** Position at the start of the mandatory batch, after any earlier effects.
 * Domains describe effective identities at this instant, not initial script slots. */
type Position = Pick<
  PlayerView,
  | 'loop'
  | 'day'
  | 'phase'
  | 'module'
  | 'anniversary'
  | 'days'
  | 'loops'
  | 'characters'
  | 'boards'
  | 'ex'
  | 'publicSpecialRules'
>;
type Phenomenon = 'death' | 'identity-reveal';
export interface AbsenceWindow {
  entry: Position;
  timing:
    | { kind: PlayerView['phase'] }
    | { kind: 'death' | 'goodwill-completed' | 'incident-completed'; owner: string };
  /** "complete" certifies full roster, actual settlement and observation of the specified outcomes. */
  coverage: 'complete' | 'partial' | 'interrupted';
  /** Only supply a limit when usage left at this timing is established publicly. */
  availableLimitedAbilities?: readonly { owner: string; ability: string }[];
  absent: readonly { phenomenon: Phenomenon; character: string }[];
}
export interface AbsenceConstraint {
  source: string;
  ability: string;
  owner: string;
  identity: string;
  phenomenon: Phenomenon;
  target: string;
  /** This owner role together with any listed target role contradicts the observation. */
  targetIdentities: string[];
}
export interface AbsenceSpace {
  domains: Record<string, string[]>;
  constraints: AbsenceConstraint[];
  /** No assignment may satisfy every term of one clause. */
  choiceConflicts?: { source: string; ability: string; terms: Record<string, string[]> }[];
}

/** Ground deterministic public consequences of the official mandatory programs. */
export function buildAbsenceSpace(
  pack: RulePack,
  window: AbsenceWindow,
  candidates: Readonly<Record<string, readonly string[]>> = {},
): AbsenceSpace {
  const { entry, timing } = window;
  if (entry.module !== pack.module || entry.anniversary !== pack.anniversary)
    throw Error('Observation and rule pack differ');
  const characters = new Map(entry.characters.map((c) => [c.id, c]));
  if (
    characters.size !== entry.characters.length ||
    Object.keys(candidates).some((id) => !characters.has(id)) ||
    window.absent.some((a) => !characters.has(a.character)) ||
    ('owner' in timing && !characters.has(timing.owner))
  )
    throw Error('Invalid observation roster');
  const domains = Object.fromEntries(
    entry.characters.map((c) => [
      c.id,
      [
        ...new Set(
          Object.hasOwn(candidates, c.id) ? candidates[c.id]! : Object.keys(pack.identities),
        ),
      ],
    ]),
  );
  const constraints: AbsenceConstraint[] = [];
  const choiceConflicts: NonNullable<AbsenceSpace['choiceConflicts']> = [];
  const space = { domains, constraints, choiceConflicts };
  if (
    window.coverage !== 'complete' ||
    entry.publicSpecialRules?.length ||
    (!('owner' in timing) && entry.phase !== timing.kind)
  )
    return space;

  const index = absenceProgramIndex(pack);
  function vulnerable(target: PublicCharacter) {
    if (
      target.status !== 'alive' ||
      target.counters.guard !== 0 ||
      entry.characters.some(
        (c) =>
          c.id !== target.id &&
          c.area === target.area &&
          c.status === 'alive' &&
          (!pack.characters[c.character]?.supported || pack.characters[c.character]?.protects),
      )
    )
      return [];
    return domains[target.id]!.filter(
      (r) =>
        Object.hasOwn(pack.identities, r) &&
        pack.identities[r]!.supported &&
        !roleImmortal(pack, r, target.counters),
    );
  }
  function enabled(condition: Condition | undefined, ctx: PublicContext) {
    if (
      entry.ex !== undefined &&
      condition &&
      typeof condition === 'object' &&
      'cmp' in condition
    ) {
      const read = (v: typeof condition.left) =>
        v && typeof v === 'object' && 'game' in v && v.game === 'ex' ? entry.ex! : v;
      return publicCondition(
        { ...condition, left: read(condition.left), right: read(condition.right) },
        ctx,
      );
    }
    return publicCondition(condition, ctx);
  }
  for (const owner of entry.characters) {
    if ('owner' in timing && timing.owner !== owner.id) continue;
    if (
      !['loop-end', 'death', 'incident-completed'].includes(timing.kind) &&
      owner.status !== 'alive'
    )
      continue;
    if (timing.kind === 'death' && owner.status !== 'dead') continue;
    const card = pack.characters[owner.character];
    if (!card?.supported || card.abilityArea || owner.character === 'UP主') continue;
    const ctx: PublicContext = { ...entry, clock: entry, characters, pack, owner: owner.id };
    for (const identity of domains[owner.id]!) {
      const def = Object.hasOwn(pack.identities, identity) && pack.identities[identity];
      if (!def || !def.supported) continue;
      const named = (kind: string, name: string) =>
        index.byOwner.get(JSON.stringify([timing.kind, kind, name])) ?? [];
      for (const { ability: a } of [
        ...named('identity', identity),
        ...named('character', owner.character),
      ]) {
        const step = a.steps[0];
        if (
          !a.mandatory ||
          a.timing !== timing.kind ||
          (a.loopLimit !== undefined &&
            !window.availableLimitedAbilities?.some(
              (v) => v.owner === owner.id && v.ability === a.id,
            )) ||
          a.threshold !== undefined ||
          a.declarationArea ||
          !step ||
          step.moveOthersFromEffectiveArea ||
          enabled(a.condition, ctx) !== true ||
          publicCondition(step.condition, ctx) !== true
        )
          continue;
        if (step.choices?.length) {
          const [choice] = step.choices;
          const [effect] = step.effects;
          if (
            step.choices.length !== 1 ||
            !choice ||
            choice.optional ||
            choice.allowEmpty ||
            Array.isArray(choice.options) ||
            choice.options.kind !== 'alive' ||
            step.effects.length !== 1 ||
            effect?.op !== 'kill' ||
            effect.target !== '$' + choice.key
          )
            continue;
          const terms = new Map<string, string[]>([[owner.id, [identity]]]);
          let targets = 0,
            open = false;
          for (const c of entry.characters.filter((c) => c.status === 'alive')) {
            const eligible = publicCondition(choice.options.where, {
              ...ctx,
              bindings: { it: c.id },
            });
            if (eligible === false) continue;
            if (
              eligible === undefined ||
              !window.absent.some((e) => e.phenomenon === 'death' && e.character === c.id)
            ) {
              open = true;
              break;
            }
            const roles = vulnerable(c).filter((r) => owner.id !== c.id || r === identity);
            if (!roles.length) {
              open = true;
              break;
            }
            terms.set(c.id, roles);
            targets++;
          }
          if (!open && targets)
            choiceConflicts.push({
              source: a.source,
              ability: a.id,
              terms: Object.fromEntries(terms),
            });
          continue;
        }
        function visit(effect: Effect, bound?: PublicCharacter) {
          const local = { ...ctx, bindings: bound && { it: bound.id } };
          if (effect.op === 'when') {
            if (publicCondition(effect.condition, local) === true)
              for (const child of effect.effects) visit(child, bound);
            return;
          }
          if (effect.op === 'each' && effect.selector.kind === 'alive') {
            for (const actor of entry.characters) {
              if (
                actor.status !== 'alive' ||
                publicCondition(effect.selector.where, { ...ctx, bindings: { it: actor.id } }) !==
                  true
              )
                continue;
              for (const child of effect.effects) visit(child, actor);
            }
            return;
          }
          if (effect.op !== 'kill' && effect.op !== 'reveal-identity') return;
          const target =
            effect.target === '$self' ? owner : effect.target === '$it' ? bound : undefined;
          if (!target) return;
          const phenomenon = effect.op === 'kill' ? 'death' : 'identity-reveal';
          if (!window.absent.some((e) => e.character === target.id && e.phenomenon === phenomenon))
            return;
          let roles = domains[target.id]!;
          if (phenomenon === 'death') roles = vulnerable(target);
          if (owner.id === target.id) roles = roles.filter((r) => r === identity);
          if (roles.length)
            constraints.push({
              source: a.source,
              ability: a.id,
              owner: owner.id,
              identity,
              phenomenon,
              target: target.id,
              targetIdentities: [...roles],
            });
        }
        for (const effect of step.effects) visit(effect);
      }
    }
  }
  return space;
}

export { propagateSolutions as absenceSolutions } from './propagation.js';
