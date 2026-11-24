import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { identities, ref, roleImmortal, test } from './expressions.js';
import { environment } from './engine.js';
import { canonical, clone, type Ability, type Frame } from './model.js';
import { flatten, settle, type Intent } from './settlement.js';
import type { PublicContext } from './knowledge-conditions.js';
import { possibleForms, type Profile } from './knowledge-domain.js';
import { installSettlementRows } from './knowledge-death-settlement.js';
import {
  publicEffect,
  publicOperands,
  publicPosition,
  settlementKey,
} from './knowledge-incident-settlement.js';

// The first nonempty mandatory batch must match in its entirety. If the batch
// can be silent, a delayed effect could supply the report and that case stays open.
export function projectDayEnd(
  ctx: PublicContext,
  opening: PlayerView,
  reports: Observation[],
  p: Profile,
  budget: { branches: number },
) {
  // World movement and curses can publish their own batches before day-end abilities.
  if (ctx.pack.module === 'AHR' || ctx.pack.module === 'HSA') return;
  const state = publicPosition(ctx, opening, p);
  if (!state) return;
  const entry = state;
  const participants = new Set<string>();
  const symbols = new Set(['self', 'it', 'day', 'loop']);
  function intents(owner: string, abilities: Ability[]) {
    const result: Intent[] = [];
    for (const a of abilities) {
      if (!a.mandatory || a.timing !== 'day-end') continue;
      const c = entry.characters[owner];
      if (c && (ctx.pack.characters[c.character]?.abilityArea || c.character === 'UP主')) return;
      const frame: Frame = {
        id: 'local',
        source: a.source,
        owner,
        actor: 'mastermind',
        kind: 'mandatory',
        ability: a,
        steps: a.steps,
        step: 0,
        choices: {},
        bound: {},
        cleanup: false,
      };
      const env = environment(entry, frame);
      if (!publicOperands(a.condition, symbols)) return;
      if (!test(ctx.pack, entry, a.condition, env)) continue;
      const step = a.steps[0];
      if (!step) continue;
      if (
        a.loopLimit !== undefined ||
        a.threshold !== undefined ||
        a.declarationArea ||
        (a.id === 'loss' && p.store.domains.has('alternateY')) ||
        !publicOperands(step.condition, symbols)
      )
        return;
      if (!test(ctx.pack, entry, step.condition, env)) continue;
      if (
        step.choices?.length ||
        step.moveOthersFromEffectiveArea ||
        !publicOperands(step, symbols) ||
        !step.effects.every((e) => publicEffect(e, true))
      )
        return;
      result.push(
        ...flatten(
          ctx.pack,
          entry,
          step.effects.map((effect) => ({ effect, env })),
        ),
      );
    }
    return result;
  }
  const fixed: Intent[] = [];
  for (const [owner, abilities] of [
    ...[p.y, ...p.x].map(
      (name) => ['plot:' + name, ctx.pack.plots[name]?.abilities ?? []] as const,
    ),
    ...ctx.pack.moduleAbilities.map(({ owner, ability }) => [owner, [ability]] as const),
  ]) {
    const group = intents(owner, [...abilities]);
    if (!group) return;
    fixed.push(...group);
  }
  const actors = [...ctx.characters.values()].filter((c) => c.status === 'alive');
  type Mode = { role: string; slots: Set<string>; effects: Intent[] | undefined };
  const choices = new Map<string, Mode[]>();
  const victims = new Set<string>();
  function collect(effects: Intent[]) {
    for (const { effect, env } of effects) {
      if (effect.op === 'kill') victims.add(ref(effect.target, env));
    }
  }
  collect(fixed);
  for (const c of actors) {
    const slots = p.store.domains.get('identity:' + c.id);
    if (!slots || ['临时工', '临时工？'].includes(c.character)) return;
    const card = intents(c.id, ctx.pack.characters[c.character]!.abilities);
    if (!card) return;
    if (card.length) {
      participants.add(c.id);
      fixed.push(...card);
      collect(card);
    }
    const forms = new Map<string, Set<string>>();
    for (const slot of slots)
      for (const form of possibleForms(p, slot, ctx.ex)) {
        if (!forms.has(form)) forms.set(form, new Set());
        forms.get(form)!.add(slot);
      }
    const modes: Mode[] = [];
    for (const [role, domain] of forms) {
      entry.characters[c.id]!.identity = role;
      const abilities = identities(entry, c.id).flatMap(
        (r) => ctx.pack.identities[r]?.abilities ?? [],
      );
      const effects = intents(c.id, abilities);
      if (effects) collect(effects);
      modes.push({ role, slots: domain, effects });
    }
    choices.set(c.id, modes);
  }
  if (
    victims.size &&
    (ctx.pack.module === 'LL' ||
      actors.some(
        (c) =>
          ctx.pack.characters[c.character]?.protects &&
          [...victims].some((v) => v !== c.id && ctx.characters.get(v)?.area === c.area),
      ))
  )
    return;
  for (const id of victims) if (ctx.characters.has(id)) participants.add(id);
  const factors: { id: string; modes: Mode[] }[] = [];
  let open = false;
  for (const [id, modes] of choices) {
    const equivalent = new Map<string, Mode>();
    for (const mode of modes) {
      const immune =
        victims.has(id) && roleImmortal(ctx.pack, mode.role, entry.characters[id]!.counters);
      const key = canonical([immune, mode.effects ?? null]);
      const prior = equivalent.get(key);
      if (prior) for (const value of mode.slots) prior.slots.add(value);
      else equivalent.set(key, { ...mode, slots: new Set(mode.slots) });
    }
    const options = [...equivalent.values()];
    if (options.length === 1) {
      const mode = options[0]!;
      if (!mode.effects) return;
      entry.characters[id]!.identity = mode.role;
      fixed.push(...mode.effects);
      if (mode.effects.length) participants.add(id);
    } else {
      const seen = new Set<string>();
      for (const option of options)
        for (const slot of option.slots) {
          if (seen.has(slot)) open = true;
          seen.add(slot);
        }
      participants.add(id);
      factors.push({ id, modes: options });
    }
  }
  if (!fixed.length && !factors.length) return;
  const observed = settlementKey(reports);
  const rows: Map<string, Set<string>>[] = [];
  const row = new Map<string, Set<string>>();
  function visit(i: number, effects: Intent[], store: Profile['store']) {
    if (--budget.branches < 0) return;
    const factor = factors[i];
    if (!factor) {
      const s = clone(entry);
      settle(ctx.pack, s, effects);
      const published = s.observations.public;
      if (!published.length) open = true;
      if (!published.length || settlementKey(published) === observed) rows.push(new Map(row));
      return;
    }
    const key = 'identity:' + factor.id;
    for (const mode of factor.modes) {
      const s = store.clone({ checks: 0, removed: 0, branches: 0 });
      s.narrow(key, mode.slots);
      if (!s.propagate()) continue;
      row.set(key, mode.slots);
      entry.characters[factor.id]!.identity = mode.role;
      if (mode.effects) visit(i + 1, effects.concat(mode.effects), s);
      else {
        rows.push(new Map(row));
        open = true;
      }
      row.delete(key);
      if (budget.branches < 0) return;
    }
  }
  visit(0, fixed, p.store);
  if (budget.branches < 0) return { open: true, participants };
  installSettlementRows(p, 'day-end-settlement:' + reports[0]!.sequence, rows);
  return { open, participants };
}
