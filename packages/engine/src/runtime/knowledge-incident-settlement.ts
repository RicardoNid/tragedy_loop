import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { environment, options } from './engine.js';
import { test } from './expressions.js';
import { canonical, clone, type Frame, type Step, type Effect } from './model.js';
import { initialState } from './setup.js';
import { settle } from './settlement.js';
import { possibleForms, type Profile } from './knowledge-domain.js';
import type { PublicContext } from './knowledge-conditions.js';
import { installSettlementRows } from './knowledge-death-settlement.js';

// This slice reads only public expressions. An unrecognized operand or opcode
// leaves its alternative open; in particular a hidden flag is never set to false.
export function publicOperands(node: unknown, bindings: Set<string>): boolean {
  if (typeof node === 'string' && node.startsWith('$')) {
    const [name, field] = node.slice(1).split('.');
    return bindings.has(name!) && (!field || field === 'area');
  }
  if (node === null || typeof node !== 'object') return true;
  if ('kind' in node && node.kind === 'cards') return false;
  if (
    'field' in node &&
    !['area', 'character', 'status', 'rawTotal', 'kinds'].includes(String(node.field))
  )
    return false;
  if (['gameFlag', 'flag', 'attribute', 'hasAbility', 'incidentOccurred'].some((k) => k in node))
    return false;
  return Object.values(node).every((value) => publicOperands(value, bindings));
}
export function publicEffect(e: Effect, allowDeaths = false): boolean {
  return e.op === 'when' || e.op === 'each'
    ? e.effects.every((child) => publicEffect(child, allowDeaths))
    : (allowDeaths && e.op === 'kill') ||
        ['counter', 'clear', 'replace', 'transfer', 'revive', 'ex'].includes(e.op);
}
function executable(step: Step) {
  const keys = new Set(['self', 'it', 'day', 'loop', ...(step.choices ?? []).map((c) => c.key)]);
  return (
    !step.moveOthersFromEffectiveArea &&
    step.effects.every((e) => publicEffect(e)) &&
    publicOperands(step, keys) &&
    (step.choices ?? []).every(
      (c) => !Array.isArray(c.options) || c.options.every((v) => !v.startsWith('$')),
    )
  );
}

export const settlementKey = (os: Observation[]) =>
  canonical(os.map((o) => canonical([o.type, o.data])).sort());
export function publicPosition(ctx: PublicContext, opening: PlayerView, p: Profile) {
  const state = initialState(ctx.pack, {
    module: ctx.pack.module,
    anniversary: ctx.pack.anniversary,
    y: p.y,
    x: p.x,
    loops: ctx.loops,
    days: ctx.days,
    captain: opening.captain,
    discussion: 'allowed',
    incidents: [],
    characters: [...ctx.characters.values()]
      .filter((c) => c.character !== '临时工？')
      .map((c) => ({ id: c.id, character: c.character, identity: '平民' })),
  });
  // The admitted operations never read LL seats or publish an LL marker.
  state.ll = undefined;
  for (const c of ctx.characters.values()) {
    const target = state.characters[c.id];
    if (!target) return;
    Object.assign(target, { area: c.area, status: c.status, counters: { ...c.counters } });
  }
  Object.assign(state, {
    loop: ctx.clock.loop,
    day: ctx.clock.day,
    phase: ctx.clock.phase,
    ex: ctx.ex ?? 0,
    boards: { ...ctx.boards },
  });
  return state;
}
/** Replay the first incident step against the complete unordered announcement. */
export function incidentStepProjection(
  ctx: PublicContext,
  opening: PlayerView,
  reports: Observation[],
  budget: { branches: number },
) {
  const clock = reports[0]!;
  const observed = settlementKey(reports);
  const cache = new Map<string, boolean | undefined>();
  function matches(name: string, id: string, step: Step, p: Profile) {
    const memo = canonical([name, id, p.y === '封印的终末']);
    if (cache.has(memo)) return cache.get(memo);
    if (budget.branches <= 0) return;
    const state = publicPosition(ctx, opening, p);
    if (!state) return;
    const entry = state;
    const frame: Frame = {
      id: 'projection',
      owner: id,
      actor: 'mastermind',
      source: name,
      kind: 'incident',
      incident: name,
      steps: [step],
      step: 0,
      choices: {},
      bound: {},
      cleanup: false,
    };
    let found = false,
      unknown = false;
    // processBatch checks the step condition before binding its choices.
    if (!test(ctx.pack, state, step.condition, environment(state, frame))) return;
    function visit(i: number) {
      if (--budget.branches < 0) {
        unknown = true;
        return;
      }
      const spec = step.choices?.[i];
      if (spec) {
        const menu = options(ctx.pack, entry, frame, spec);
        if (!menu.length) menu.push('');
        if (spec.optional) unknown = true; // A skipped step can leave a later source visible.
        for (const value of menu) {
          frame.choices[spec.key] = value;
          visit(i + 1);
          if (found || budget.branches < 0) break;
        }
        delete frame.choices[spec.key];
        return;
      }
      const candidate = clone(entry);
      const env = environment(candidate, frame);
      settle(
        ctx.pack,
        candidate,
        step.effects.map((effect) => ({ effect, env })),
      );
      const out = candidate.observations.public;
      if (out.length && settlementKey(out) === observed) found = true;
      // A subsequent source step or a repeat can be the first visible effect.
      if (
        !out.length &&
        (ctx.pack.incidents[name]!.steps.length > 1 ||
          ctx.pack.characters[entry.characters[id]?.character ?? '']?.incident?.execution ===
            'repeat')
      )
        unknown = true;
    }
    visit(0);
    const result = found ? true : unknown ? undefined : false;
    cache.set(memo, result);
    return result;
  }
  return (p: Profile) => {
    const event = 'event:' + clock.day,
      culprit = 'culprit:' + clock.day;
    const names = p.store.domains.get(event),
      owners = p.store.domains.get(culprit);
    if (!names || !owners) return;
    let used = false,
      open = false;
    const participants = new Set<string>();
    const rows: Map<string, Set<string>>[] = [];
    for (const name of names) {
      const def = ctx.pack.incidents[name]!,
        step = def.steps[0];
      const free = new Map([[event, new Set([name])]]);
      if (!step || def.afterIncidentSteps?.length || !executable(step)) {
        open = true;
        rows.push(free);
        continue;
      }
      const keep = new Set<string>();
      for (const id of owners) {
        const actor = ctx.characters.get(id);
        const trait = actor && ctx.pack.characters[actor.character];
        if (trait?.incident?.execution === 'cancel') {
          used = true;
          continue;
        }
        if (
          !actor ||
          (def.crowdThreshold !== undefined && actor.character === 'AI') ||
          trait?.incident?.execution === 'proxy' ||
          trait?.incidentAreaFromBase ||
          [...(p.store.domains.get('identity:' + id) ?? [])].some((slot) =>
            possibleForms(p, slot, ctx.ex).some(
              (role) => ctx.pack.identities[role]?.baseIncidentArea,
            ),
          )
        ) {
          open = true;
          keep.add(id);
          continue;
        }
        const ok = matches(name, id, step, p);
        participants.add(id);
        if (budget.branches < 0) return { open: true, participants };
        used = true;
        if (ok !== false) keep.add(id);
        if (ok === undefined) open = true;
      }
      if (keep.size) {
        if (keep.size !== owners.size) free.set(culprit, keep);
        rows.push(free);
      }
    }
    if (!used) return;
    installSettlementRows(p, 'incident-public-step:' + clock.sequence, rows);
    return { open, participants };
  };
}
