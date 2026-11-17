import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { canonical, COUNTERS, type Effect, type Step } from './model.js';
import { possibleForms, type Profile } from './knowledge-domain.js';
import { roleImmortal } from './expressions.js';
import { publicCondition, type PublicContext } from './knowledge-conditions.js';
import { quietTargets } from './knowledge-quiet.js';
import { resolveDeathRequests } from './settlement.js';

type Row = Map<string, Set<string>>;

/** The projected table is a disjunction. A missing column in a row is a wildcard. */
export function installSettlementRows(p: Profile, name: string, rows: Row[]) {
  for (const row of rows)
    for (const [key, allowed] of row) {
      if ([...p.store.values(key)].every((v) => allowed.has(v))) row.delete(key);
    }
  if (rows.some((r) => !r.size)) return;
  const reads = [...new Set(rows.flatMap((r) => [...r.keys()]))];
  p.store.add({
    name,
    reads,
    revise(store) {
      const viable = rows.filter((row) =>
        [...row].every(([k, allowed]) => [...allowed].some((v) => store.values(k).has(v))),
      );
      if (!viable.length) return store.invalidate();
      for (const k of reads) {
        if (viable.every((r) => r.has(k)))
          store.narrow(
            k,
            viable.flatMap((r) => [...r.get(k)!]),
          );
      }
    },
  });
  p.active = p.store.propagate();
}

function kills(e: Effect): boolean {
  if (e.op === 'kill') return true;
  return (e.op === 'when' || e.op === 'each') && e.effects.every(kills);
}
function canProtectProtagonists(ctx: PublicContext, p: Profile) {
  const protects = (e: Effect): boolean =>
    e.op === 'protect-protagonists' || ('effects' in e && e.effects.some(protects));
  const inSteps = (steps: Step[]) => steps.some((step) => step.effects.some(protects));
  const definitions = [
    ...[...ctx.characters.values()].map((c) => ctx.pack.characters[c.character]),
    ...[p.y, ...p.x].map((name) => ctx.pack.plots[name]),
    ...Object.values(ctx.pack.identities),
  ];
  return (
    definitions.some((d) => d?.abilities.some((a) => inSteps(a.steps))) ||
    ctx.pack.moduleAbilities.some(({ ability }) => inSteps(ability.steps)) ||
    Object.values(ctx.pack.incidents).some(
      (i) => inSteps(i.steps) || inSteps(i.afterIncidentSteps ?? []),
    )
  );
}

/** Match the first established incident step, before any completion/death reaction.
 * Only branch on traits affecting a requested victim or an eligible substitute. */
export function projectIncidentDeaths(
  ctx: PublicContext,
  reports: Observation[],
  p: Profile,
  remaining: { branches: number },
) {
  const stepId = reports[0]!;
  const event = 'event:' + stepId.day,
    culprit = 'culprit:' + stepId.day;
  const events = p.store.domains.get(event),
    culprits = p.store.domains.get(culprit);
  if (!events || !culprits) return;
  const actors = [...ctx.characters.values()];
  const deaths = new Set<string>();
  const guards = new Map<string, number>();
  const changedActors = new Set<string>();
  const markers = new Set<string>();
  let invalidBatch = reports.filter((o) => o.type === 'failure').length > 1;
  const protagonist = reports.some(
    (o) => o.type === 'failure' && o.data.result === 'protagonist-death',
  );
  for (const o of reports) {
    if (o.type === 'character') {
      const id = String(o.data.character),
        old = ctx.characters.get(id);
      const counters = o.data.counters as PlayerView['characters'][number]['counters'] | undefined;
      if (
        !old ||
        old.status !== 'alive' ||
        old.area !== o.data.area ||
        !counters ||
        !['dead', 'alive'].includes(String(o.data.status)) ||
        COUNTERS.some((k) => k !== 'guard' && counters[k] !== old.counters[k]) ||
        counters.guard > old.counters.guard
      )
        return;
      if (o.data.status === 'dead') deaths.add(id);
      if (counters.guard !== old.counters.guard) guards.set(id, counters.guard);
      invalidBatch ||=
        changedActors.has(id) ||
        (o.data.status === 'alive' && counters.guard === old.counters.guard);
      changedActors.add(id);
    } else if (o.type === 'board' && typeof o.data.diedMarker === 'string') {
      invalidBatch ||= ctx.pack.module !== 'LL' || markers.has(o.data.diedMarker);
      markers.add(o.data.diedMarker);
    } else if (!(o.type === 'failure' && o.data.result === 'protagonist-death')) return;
  }
  if (!deaths.size && !guards.size) return;
  invalidBatch ||= [...markers].some((id) => !deaths.has(id));
  const rows: Row[] = [];
  const participants = new Set<string>();
  let modeled = false,
    open = ctx.pack.module === 'LL';
  let protectionPossible: boolean | undefined;
  for (const name of events) {
    const def = ctx.pack.incidents[name];
    const step = def?.steps[0];
    const rowsFor = (id?: string): Row =>
      new Map([[event, new Set([name])], ...(id ? [[culprit, new Set([id])] as const] : [])]);
    if (
      !step ||
      def.steps.length !== 1 ||
      def.afterIncidentSteps?.length ||
      step.moveOthersFromEffectiveArea ||
      p.y === '封印的终末'
    ) {
      rows.push(rowsFor());
      open = true;
      continue;
    }
    // Separate the protagonist outcome, which can be privately protected.
    const characterEffects = step.effects.filter(kills);
    const others = step.effects.filter((e) => !kills(e));
    if (
      !characterEffects.length ||
      !others.every(
        (e) =>
          e.op === 'protagonist-death' ||
          (e.op === 'when' && e.effects.length === 1 && e.effects[0]?.op === 'protagonist-death'),
      )
    ) {
      rows.push(rowsFor());
      open = true;
      continue;
    }
    const executions = new Map<string, { requests: string[][]; owners: Set<string> }>();
    for (const id of culprits) {
      const row = rowsFor(id);
      const owner = ctx.characters.get(id);
      const trait = owner && ctx.pack.characters[owner.character];
      // Special execution may have two different acting culprits in this step.
      if (
        !owner ||
        (def.crowdThreshold !== undefined && owner.character === 'AI') ||
        trait?.incident?.execution === 'proxy' ||
        trait?.incidentAreaFromBase ||
        [...(p.store.domains.get('identity:' + id) ?? [])].some((slot) =>
          possibleForms(p, slot, ctx.ex).some(
            (role) => ctx.pack.identities[role]?.baseIncidentArea,
          ),
        )
      ) {
        rows.push(row);
        open = true;
        continue;
      }
      const context = { ...ctx, owner: id };
      const requests = quietTargets([{ ...step, effects: characterEffects }], context);
      if (!requests) {
        rows.push(row);
        open = true;
        continue;
      }
      modeled = true;
      if (invalidBatch) continue;
      if (trait?.incident?.execution === 'cancel') continue;
      const hero = others.map((e) =>
        e.op === 'protagonist-death'
          ? true
          : e.op === 'when'
            ? publicCondition(e.condition, context)
            : false,
      );
      if (protagonist && hero.every((enabled) => enabled === false)) continue;
      if (!protagonist && hero.includes(true)) {
        protectionPossible ??= canProtectProtagonists(ctx, p);
        if (!protectionPossible) continue;
        open = true;
      }
      if (hero.includes(undefined)) open = true;
      const key = canonical(requests);
      if (!executions.has(key)) executions.set(key, { requests, owners: new Set() });
      executions.get(key)!.owners.add(id);
    }
    for (const { requests, owners } of executions.values()) {
      const row = rowsFor();
      if (owners.size < culprits.size) row.set(culprit, owners);
      for (const targets of requests) {
        const impacted = new Set(targets);
        const protectors = actors.filter(
          (c) =>
            c.status === 'alive' &&
            ctx.pack.characters[c.character]?.protects &&
            targets.some((t) => t !== c.id && ctx.characters.get(t)?.area === c.area),
        );
        if (protectors.length > 1) {
          rows.push(row);
          open = true;
          continue;
        }
        for (const c of protectors) impacted.add(c.id);
        if ([...deaths, ...guards.keys()].some((t) => !impacted.has(t))) continue;
        const ids = [...impacted];
        for (const t of ids) participants.add(t);
        const immune = new Set<string>();
        const extra = new Map<string, string | undefined>();
        const accept = () => {
          const branch = p.store.clone({ checks: 0, removed: 0, branches: 0 });
          for (const [key, allowed] of row) branch.narrow(key, allowed);
          if (!branch.propagate()) return;
          const out = resolveDeathRequests(
            targets,
            (t) => ctx.characters.get(t)!.counters.guard,
            (t) => immune.has(t),
            (t) =>
              protectors.find(
                (c) =>
                  c.id !== t &&
                  c.area === ctx.characters.get(t)!.area &&
                  (extra.get(c.id) === t ||
                    ctx.pack.characters[c.character]!.protects!.characters.includes(
                      ctx.characters.get(t)!.character,
                    )),
              )?.id,
          );
          if (
            out.dying.size === deaths.size &&
            [...out.dying].every((t) => deaths.has(t)) &&
            Object.keys(out.guards).length === guards.size &&
            [...guards].every(([t, n]) => out.guards[t] === n)
          )
            rows.push(new Map(row));
        };
        const visit = (i: number) => {
          if (--remaining.branches < 0) return;
          if (i === ids.length + protectors.length) return accept();
          if (i >= ids.length) {
            const c = protectors[i - ids.length]!;
            // Private activations may have bound one additional protection target.
            const choices = [
              undefined,
              ...new Set(
                targets.filter(
                  (t) =>
                    t !== c.id &&
                    ctx.characters.get(t)?.area === c.area &&
                    !ctx.pack.characters[c.character]!.protects!.characters.includes(
                      ctx.characters.get(t)!.character,
                    ),
                ),
              ),
            ];
            if (choices.length > 1) open = true;
            for (const target of choices) {
              extra.set(c.id, target);
              visit(i + 1);
              if (remaining.branches < 0) return;
            }
            return;
          }
          const t = ids[i]!,
            actor = ctx.characters.get(t)!;
          const key = 'identity:' + t;
          const slots = p.store.domains.get(key);
          // A temporary worker can use a replacement identity outside its initial slot.
          const independent = !slots || ['临时工', '临时工？'].includes(actor.character);
          if (independent) open = true;
          const options = new Map<boolean, Set<string>>();
          for (const slot of independent ? Object.keys(ctx.pack.identities) : slots)
            for (const role of independent ? [slot] : possibleForms(p, slot, ctx.ex)) {
              const flag = roleImmortal(ctx.pack, role, actor.counters);
              if (!options.has(flag)) options.set(flag, new Set());
              options.get(flag)!.add(slot);
            }
          if (options.size > 1 && [...options.get(true)!].some((v) => options.get(false)!.has(v)))
            open = true;
          for (const [flag, values] of options) {
            if (flag) immune.add(t);
            else immune.delete(t);
            if (!independent && values.size < slots.size) row.set(key, values);
            visit(i + 1);
            row.delete(key);
            if (remaining.branches < 0) return;
          }
        };
        visit(0);
        if (remaining.branches < 0) return { participants, open: true };
      }
    }
  }
  if (!modeled) return;
  installSettlementRows(p, 'incident-settlement:' + stepId.sequence, rows);
  return { participants, open };
}
