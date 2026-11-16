import type { Area, Board, Counter, Observation } from '../../../contracts/src/game.js';
import {
  BOARDS,
  COUNTERS,
  clone,
  type CharacterState,
  type Effect,
  type EngineState,
  type Environment,
  type RulePack,
} from './model.js';
import { bind, immortal, ref, select, test, value, recompute } from './expressions.js';

export interface Intent {
  effect: Effect;
  env: Environment;
}
export interface Settlement {
  died: string[];
  invoked: { name: string; culprit: string; actor: string; parent: string; nested: boolean }[];
  goodwill?: { target: string; ability: string; actor: string; parent: string }[];
  followChoices?: { key: string; options: string[] }[];
}
export function announce(
  state: EngineState,
  type: Observation['type'],
  data: Record<string, unknown>,
  audience: 'public' | 'protagonists' | 'mastermind' = 'public',
): void {
  for (const recipient of audience === 'public'
    ? (['public', 'protagonists', 'mastermind'] as const)
    : [audience]) {
    const events = state.observations[recipient];
    events.push({
      sequence: events.length + 1,
      loop: state.loop,
      day: state.day,
      phase: state.phase,
      type,
      data: clone(data),
    });
  }
}
export function publishChanges(before: EngineState, after: EngineState): void {
  for (const board of BOARDS)
    if (before.boards[board] !== after.boards[board])
      announce(after, 'board', { board, intrigue: after.boards[board] });
  for (const c of Object.values(after.characters)) {
    const old = before.characters[c.id];
    if (
      !old ||
      JSON.stringify([old.area, old.status, old.counters]) !==
        JSON.stringify([c.area, c.status, c.counters])
    )
      announce(after, 'character', {
        character: c.id,
        area: c.area,
        status: c.status,
        counters: c.counters,
      });
  }
  if (before.ex !== after.ex) announce(after, 'board', { ex: after.ex });
  if (!before.protagonistDead && after.protagonistDead)
    announce(after, 'failure', { result: 'protagonist-death' });
  else if (!before.failed && after.failed)
    announce(after, 'failure', { result: 'protagonist-failure' });
}
export function grantCard(
  state: EngineState,
  owner: 'mastermind' | 'p0' | 'p1' | 'p2',
  kind: 'hope+1' | 'despair+1',
): void {
  const key = `grant:${state.loop}:${owner}:${kind}`;
  if (state.flags[key]) return;
  state.flags[key] = 'yes';
  const existing = state.cards.find((c) => c.owner === owner && c.kind === kind);
  if (existing) existing.status = 'hand';
  else state.cards.push({ id: `${owner}-${kind}`, owner, kind, once: true, status: 'hand' });
  announce(state, 'card-grant', { owner, kind });
}
function flatten(pack: RulePack, snapshot: EngineState, intents: Intent[]): Intent[] {
  const result: Intent[] = [];
  for (const intent of intents) {
    const { effect } = intent,
      env = bind(snapshot, intent.env);
    if (effect.op === 'when') {
      if (test(pack, snapshot, effect.condition, env))
        result.push(
          ...flatten(
            pack,
            snapshot,
            effect.effects.map((effect) => ({ effect, env })),
          ),
        );
    } else if (effect.op === 'each') {
      for (const id of select(pack, snapshot, effect.selector, env))
        result.push(
          ...flatten(
            pack,
            snapshot,
            effect.effects.map((effect) => ({ effect, env: { ...env, it: id } })),
          ),
        );
    } else result.push({ effect, env });
  }
  return result;
}
function canMove(c: CharacterState): boolean {
  return c.status === 'alive' && !c.flags.immobile;
}

function protects(pack: RulePack, guardian: CharacterState, target: CharacterState): boolean {
  const rule = pack.characters[guardian.character]?.protects;
  return (
    !!rule &&
    guardian.id !== target.id &&
    guardian.status === 'alive' &&
    (rule.characters.includes(target.character) ||
      guardian.flags[rule.selectedTargetFlag] === target.id)
  );
}

export function permitsMove(state: EngineState, id: string, area: Area): boolean {
  const c = state.characters[id];
  const locked = state.flags['lockdown-area'];
  const sealed =
    locked &&
    state.day < Number(state.flags['lockdown-day']) + 3 &&
    (area === locked || c?.area === locked);
  return (
    !!c &&
    canMove(c) &&
    [...BOARDS, 'far'].includes(area) &&
    (!!c.flags['free-movement'] || !c.forbidden.includes(area as Board)) &&
    !sealed
  );
}

/** One established batch. All eligibility, amounts and targets read its entry snapshot. */
export function settle(
  pack: RulePack,
  state: EngineState,
  input: Intent[],
  choices: Environment = {},
): Settlement {
  const before = clone(state);
  const intents = flatten(pack, before, input);
  const moves: Record<string, Area> = {};
  const moveOrigins: Record<string, Area> = {};
  for (const { effect, env } of intents)
    if (effect.op === 'move') {
      const id = ref(effect.target, env),
        c = before.characters[id],
        area = ref(effect.area, env) as Area;
      if (c && permitsMove(before, id, area)) {
        moves[id] = area;
        moveOrigins[id] = (
          id === env.self && env.effectiveArea ? env.effectiveArea : c.area
        ) as Area;
      }
    }
  const followChoices: { key: string; options: string[] }[] = [];
  for (const c of Object.values(before.characters).filter(
    (c) => pack.characters[c.character]?.protects && canMove(c),
  )) {
    const leaders = Object.values(before.characters).filter(
      (t) =>
        protects(pack, c, t) &&
        t.status === 'alive' &&
        (moveOrigins[t.id] ?? t.area) === c.area &&
        moves[t.id] &&
        moves[t.id] !== (moveOrigins[t.id] ?? t.area),
    );
    if (leaders.length > 0) {
      const key = `follow:${c.id}`;
      const selected = leaders.length === 1 ? leaders[0]?.id : choices[key];
      if (!selected || !leaders.some((l) => l.id === selected))
        followChoices.push({ key, options: leaders.map((l) => l.id) });
      else moves[c.id] = moves[selected]!;
    }
  }
  if (followChoices.length) return { died: [], invoked: [], followChoices };
  for (const { effect, env } of intents)
    if (effect.op === 'reveal-identity') {
      const id = ref(effect.target, env),
        c = before.characters[id];
      if (c?.identity === '忍者' && c.status === 'alive' && !choices[`reveal:${id}`])
        followChoices.push({
          key: `reveal:${id}`,
          options: [
            ...new Set(state.setup.characters.map((c) => c.identity).filter((i) => i !== '平民')),
          ],
        });
    }
  if (followChoices.length) return { died: [], invoked: [], followChoices };
  const deltas: Record<string, Partial<Record<Counter, number>>> = {};
  const add = (id: string, counter: Counter, amount: number) => {
    if (!Number.isSafeInteger(amount)) throw new Error('non-integral counter change');
    (deltas[id] ??= {})[counter] = (deltas[id]?.[counter] ?? 0) + amount;
  };
  const deaths: { target: string; origin: string; replacement: boolean }[] = [];
  const revivals = new Set<string>();
  const removals = new Set<string>();
  const invoked: Settlement['invoked'] = [];
  const goodwill: NonNullable<Settlement['goodwill']> = [];
  for (const { effect, env } of intents) {
    const target = 'target' in effect && effect.target ? ref(effect.target, env) : '';
    switch (effect.op) {
      case 'counter': {
        const counter = effect.counter === '$counter' ? (env.counter as Counter) : effect.counter;
        if (!COUNTERS.includes(counter)) throw new Error('unknown counter');
        add(target, counter, Number(value(pack, before, effect.amount, env)));
        break;
      }
      case 'clear':
        for (const k of effect.counter ? [effect.counter] : COUNTERS)
          add(
            target,
            k,
            -(
              before.characters[target]?.counters[k] ??
              (k === 'intrigue' ? (before.boards[target as Board] ?? 0) : 0)
            ),
          );
        break;
      case 'transfer': {
        const from = ref(effect.from, env),
          to = ref(effect.to, env),
          counter = ref(effect.counter, env) as Counter;
        if (!COUNTERS.includes(counter)) throw new Error('unknown counter');
        if ((before.characters[from]?.counters[counter] ?? 0) > 0 && before.characters[to]) {
          add(from, counter, -1);
          add(to, counter, 1);
        } else if (
          env.forensicTransfer &&
          (before.characters[to]?.counters[counter] ?? 0) > 0 &&
          before.characters[from]
        ) {
          add(to, counter, -1);
          add(from, counter, 1);
        }
        break;
      }
      case 'replace':
        if ((before.characters[target]?.counters[effect.from] ?? 0) > 0) {
          add(target, effect.from, -1);
          add(target, effect.to, 1);
        }
        break;
      case 'kill':
        if (before.characters[target]?.status === 'alive')
          deaths.push({ target, origin: env.self ?? '', replacement: false });
        break;
      case 'revive':
        if (before.characters[target]?.status === 'dead') revivals.add(target);
        else if (target.startsWith('victim:')) add(target.split(':')[1]!, 'intrigue', -1);
        break;
      case 'remove':
        if (before.characters[target]?.status === 'alive') removals.add(target);
        break;
      case 'move':
        break;
      case 'move-corpse': {
        const area = ref(effect.area, env) as Board;
        if (!BOARDS.includes(area)) break;
        if (target.startsWith('victim:')) {
          add(target.split(':')[1]!, 'intrigue', -1);
          add(area, 'intrigue', 1);
        } else if (before.characters[target]?.status === 'dead') moves[target] = area;
        break;
      }
      case 'curse': {
        const curses = (state.curses ??= []);
        const existing = effect.id && curses.find((c) => c.id === effect.id);
        if (existing) existing.target = target;
        else curses.push({ id: `curse-${++state.serial}`, target });
        announce(state, 'board', { curses });
        break;
      }
      case 'place': {
        const c = state.characters[target],
          area = ref(effect.area, env) as Area;
        if (c && BOARDS.includes(area as Board)) c.area = c.initialArea = area;
        break;
      }
      case 'same-identity': {
        const c = before.characters[target];
        if (c)
          announce(state, 'identity', {
            sameIdentityAs: target,
            characters: Object.values(before.characters)
              .filter((t) => t.id !== target && t.status === 'alive' && t.identity === c.identity)
              .map((t) => t.id),
          });
        break;
      }
      case 'invoke-goodwill':
        goodwill.push({
          target,
          ability: ref(effect.ability, env),
          actor: env.actor ?? state.captain,
          parent: env.sourceId ?? '',
        });
        break;
      case 'flag':
        if (effect.key === 'no-protagonist-cards') state.flags['ex-cards-restricted'] = 'yes';
        if (effect.key === 'cultist' && state.characters[target])
          state.characters[target]!.flags['cultist-area'] =
            env.effectiveArea ?? state.characters[target]!.area;
        if (target && state.characters[target])
          state.characters[target]!.flags[effect.key] = ref(effect.value ?? 'yes', env);
        else if (!target) state.flags[effect.key] = ref(effect.value ?? 'yes', env);
        if (
          ['streamer-target', 'no-protagonist-cards', 'causal-ex', 'lockdown-area'].includes(
            effect.key,
          )
        )
          announce(state, 'board', {
            attachment: effect.key,
            target: target || ref(effect.value ?? '', env),
          });
        break;
      case 'protect-protagonists':
        state.protected = true;
        break;
      case 'world-move':
        state.flags['world-moved'] = 'yes';
        break;
      case 'grant':
        for (const actor of effect.side === 'mastermind'
          ? (['mastermind'] as const)
          : (['p0', 'p1', 'p2'] as const))
          grantCard(state, actor, effect.card);
        break;
      case 'schedule': {
        if (
          effect.onlyIfMoved &&
          (!moves[ref(effect.onlyIfMoved, env)] ||
            moves[ref(effect.onlyIfMoved, env)] ===
              before.characters[ref(effect.onlyIfMoved, env)]?.area)
        )
          break;
        (state.delayed ??= []).push({
          loop:
            effect.loop === undefined ? state.loop : Number(value(pack, before, effect.loop, env)),
          day: Number(value(pack, before, effect.day, env)),
          timing: effect.timing,
          effects: clone(effect.effects),
          env: clone(env),
        });
        break;
      }
      case 'protagonist-death':
        if (!before.protected) {
          state.protagonistDead = true;
          state.failed = true;
          state.endRequested = true;
        }
        break;
      case 'fail':
        state.failed = true;
        state.endRequested = true;
        break;
      case 'end-loop':
        state.endRequested = true;
        break;
      case 'ex':
        state.ex += Number(value(pack, before, effect.amount, env));
        break;
      case 'reveal-identity': {
        const c = before.characters[target];
        if (c) {
          const identity = choices[`reveal:${target}`] ?? c.identity;
          state.characters[target]!.revealed = true;
          state.revealedIdentities.push({ character: target, identity, loop: state.loop });
          announce(state, 'identity', { character: target, identity });
          if (c.identity === '密钥' && state.loop <= 2) {
            state.flags[`mastermind-cards:${state.day + 1}`] = '1';
            (state.delayed ??= []).push({
              loop: state.loop,
              day: Math.min(state.day + 1, state.setup.days),
              timing: 'day-end',
              effects: [{ op: 'protagonist-death' }],
              env: {},
            });
          }
        } else if (target.startsWith('victim:'))
          announce(state, 'identity', {
            character: target,
            identity: state.setup.y === '古墓活尸' ? '丧尸' : '平民',
          });
        break;
      }
      case 'reveal-rule':
        announce(state, 'rule', { rule: ref(effect.rule, env) });
        break;
      case 'reveal-culprit': {
        const day = Number(ref(effect.day, env));
        const incident = state.setup.incidents.find((i) => i.day === day);
        if (incident) announce(state, 'culprit', { day, culprit: incident.culprit });
        break;
      }
      case 'recover-card': {
        const card = state.cards.find((c) => c.id === ref(effect.card, env));
        if (
          card?.status === 'used' &&
          card.once &&
          card.owner === (env.actor === 'mastermind' ? 'mastermind' : state.captain)
        )
          card.status = 'hand';
        break;
      }
      case 'invoke-incident':
        invoked.push({
          name: ref(effect.name, env),
          culprit: ref(effect.culprit, env),
          actor: env.actor ?? 'mastermind',
          parent: env.sourceId ?? '',
          nested: env.sourceKind === 'incident',
        });
        break;
      case 'when':
      case 'each':
        throw new Error('unexpanded batch');
    }
  }
  // Guard consumption is per request, not per final corpse. Substitutes use entry eligibility.
  const guards = Object.fromEntries(
    Object.values(before.characters).map((c) => [c.id, c.counters.guard]),
  );
  const dying = new Set<string>();
  for (const request of deaths) {
    let target = request.target;
    if (immortal(pack, before, target)) continue;
    if ((guards[target] ?? 0) > 0) {
      guards[target]!--;
      continue;
    }
    const original = before.characters[target]!;
    const substitute = Object.values(before.characters).find(
      (c) => c.area === original.area && protects(pack, c, original),
    );
    if (substitute) {
      target = substitute.id;
      state.audit.push({ kind: 'replacement-request', data: { from: request.target, to: target } });
      if (immortal(pack, before, target)) continue;
      if ((guards[target] ?? 0) > 0) {
        guards[target]!--;
        continue;
      }
    }
    dying.add(target);
  }
  state.audit.push({ kind: 'death-requests', data: clone(deaths) });
  for (const [id, n] of Object.entries(guards))
    add(id, 'guard', n - before.characters[id]!.counters.guard);
  for (const [id, changes] of Object.entries(deltas))
    for (const counter of COUNTERS) {
      const delta = changes[counter] ?? 0;
      if (BOARDS.includes(id as Board)) {
        if (counter === 'intrigue')
          state.boards[id as Board] = Math.min(3, Math.max(0, before.boards[id as Board] + delta));
      } else if (state.characters[id])
        state.characters[id]!.counters[counter] = Math.max(
          0,
          before.characters[id]!.counters[counter] + delta,
        );
    }
  for (const [id, area] of Object.entries(moves)) state.characters[id]!.area = area;
  for (const id of revivals) state.characters[id]!.status = 'alive';
  for (const id of dying) {
    if (state.traceOutcomes) state.audit.push({ kind: 'character-died', data: id });
    if (state.ll && !state.ll.died.includes(id)) {
      state.ll.died.push(id);
      announce(state, 'board', { diedMarker: id });
    }
    state.characters[id]!.status = 'dead';
  }
  for (const id of removals) state.characters[id]!.status = 'removed';
  if (removals.size) state.curses = state.curses?.filter((c) => !removals.has(c.target));
  state.ex = Math.max(0, state.ex);
  recompute(state);
  publishChanges(before, state);
  if (state.ex > before.ex) state.flags['ex-increased'] = 'yes';
  for (const key of Object.keys(state.flags).filter(
    (k) => k.startsWith('follow:') || k.startsWith('reveal:'),
  ))
    delete state.flags[key];
  return { died: [...dying], invoked, goodwill };
}
