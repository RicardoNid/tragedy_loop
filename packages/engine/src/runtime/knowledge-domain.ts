import { lifecycle } from './shared-lifecycle.js';
import {
  initialRoleViolation,
  requiredAttribute,
  culpritRequirement,
  oppositeSexAttributes,
} from './setup-rules.js';
import type { GameSetup, Observation, PlayerView } from '../../../contracts/src/game.js';
import { BOARDS, zeroCounters, type Effect, type RulePack, type Step } from './model.js';
import { validateSetup } from './setup.js';
import {
  allocation,
  assignments,
  ConstraintStore,
  exactlyOne,
  atLeastOne,
  relation,
  type Domains,
  type PropagationStats,
} from './knowledge-constraints.js';

export interface Profile {
  id: string;
  y: string;
  x: string[];
  identityCounts: Readonly<Record<string, number>>;
  store: ConstraintStore;
  secretAddition?: GameSetup['secretAddition'];
  active: boolean;
}
export const fragment = '@anniversary-fragment';
// A paired slot occupies one quota. Keep both faces bound until setup materialization.
const slotIdentity = (v: string) => (v === fragment ? '平民' : v);
export const baseIdentity = (v: string) => slotIdentity(v).split('/')[0]!;
const reverseFace = (v: string) => v.split('/')[1];
export const shownIdentity = (v: string) => (v === fragment ? '因果残片' : baseIdentity(v));
// A partial translation cannot establish that the omitted candidates have no witnesses.
// Incidents can also be invoked by another program outside their scheduled window.
export function incompleteContent(pack: RulePack, opening: PlayerView): string[] {
  const reasons: string[] = [];
  const roster = new Set(
    [...(opening.roster ?? []), ...opening.characters].map((c) => c.character),
  );
  if (roster.has('临时工')) roster.add('临时工？');
  for (const name of roster)
    if (!pack.characters[name]?.supported) reasons.push(`未支持的登场角色：${name}。`);
  const identities = new Set([
    '平民',
    ...Object.keys(pack.identities),
    ...Object.values(pack.plots).flatMap((p) => Object.keys(p.identities)),
  ]);
  if (opening.anniversary) identities.add('因果残片');
  for (const name of identities)
    if (!pack.identities[name]?.supported) reasons.push(`未支持的身份：${name}。`);
  if (Object.values(pack.incidents).some((event) => !event.supported)) {
    const scheduled = opening.incidents.map((event) => event.name);
    const reachable = new Set(scheduled);
    if (scheduled.length && pack.incidents[lifecycle.incident.disguised])
      reachable.add(lifecycle.incident.disguised);
    function collect(step: Step, effects: Effect[]) {
      for (const effect of effects) {
        if ('effects' in effect) collect(step, effect.effects);
        if (effect.op !== 'invoke-incident') continue;
        if (!effect.name.startsWith('$')) {
          reachable.add(effect.name);
          continue;
        }
        const options = step.choices?.find((c) => '$' + c.key === effect.name)?.options;
        if (
          Array.isArray(options) &&
          options.every((o) => o === '$public-incidents' || !o.startsWith('$'))
        ) {
          for (const name of options) if (name !== '$public-incidents') reachable.add(name);
        } else {
          // An earlier step or a runtime selector may bind any incident.
          for (const name of Object.keys(pack.incidents)) reachable.add(name);
        }
      }
    }
    for (const definition of [
      ...Object.values(pack.plots),
      ...Object.values(pack.identities),
      ...[...roster].map((name) => pack.characters[name]),
    ])
      for (const ability of definition?.abilities ?? [])
        for (const step of ability.steps) collect(step, step.effects);
    // Set iteration visits newly reached incidents and terminates on cycles.
    for (const name of reachable) {
      const event = pack.incidents[name];
      if (event && !event.supported) reasons.push(`未支持的事件：${name}。`);
      for (const step of event?.steps ?? []) collect(step, step.effects);
    }
  }
  for (const { name } of opening.incidents)
    if (!pack.incidents[name] && !pack.incidents[lifecycle.incident.disguised])
      reasons.push(`缺少公开事件的规则：${name}。`);
  return reasons;
}
/** Extend first-discussion information only with characters that have publicly appeared. */
export function observedRoster(
  opening: PlayerView,
  view: PlayerView,
): NonNullable<PlayerView['roster']> {
  const seen = new Map<string, string>();
  for (const { id, character } of [...(opening.roster ?? opening.characters), ...view.characters]) {
    if (character !== '临时工？') seen.set(id, character);
  }
  return Array.from(seen, ([id, character]) => ({ id, character }));
}
export function publicRoster(pack: RulePack, opening: PlayerView) {
  return (opening.roster ?? opening.characters)
    .map(
      (entry) =>
        opening.characters.find((c) => c.id === entry.id) ?? {
          ...entry,
          status: 'absent' as const,
          area: pack.characters[entry.character]?.initial[0] ?? 'hospital',
          counters: zeroCounters(),
        },
    )
    .filter((c) => c.character !== '临时工？');
}
export interface Target {
  key: string;
  value: string;
}
export const targetId = (t: Target) => JSON.stringify([t.key, t.value]);
export function targetValues(key: string, values: Iterable<string>) {
  return new Set([...values].map(key.startsWith('identity:') ? shownIdentity : (v) => v));
}

/** Rule combinations are small disjoint constraint profiles, not full character/incident assignments. */
export function buildProfiles(
  pack: RulePack,
  opening: PlayerView,
  stats: PropagationStats,
): Profile[] {
  const roster = publicRoster(pack, opening);
  const ordinary = roster.filter((c) => !['模仿犯', '局外人'].includes(c.character));
  const ys = Object.values(pack.plots).filter((p) => p.type === 'Y');
  const xs = Object.values(pack.plots).filter((p) => p.type === 'X');
  const xSets =
    pack.setupRules.xSlots === 1
      ? xs.map((x) => [x])
      : xs.flatMap((x, i) => xs.slice(i + 1).map((z) => [x, z]));
  const profiles: Profile[] = [];
  for (const y of ys)
    for (const xSet of xSets) {
      const pool: Record<string, number> = {};
      for (const p of [y, ...xSet])
        for (const [name, count] of Object.entries(p.identities))
          pool[name] = Math.min((pool[name] ?? 0) + count, pack.identities[name]?.max ?? Infinity);
      const pairs = [y, ...xSet].flatMap((p) => (p.pair ? [p.pair.join('/')] : []));
      const inherent = { ...pool };
      for (const pair of pairs) pool[pair] = (pool[pair] ?? 0) + 1;
      const additions: GameSetup['secretAddition'][] = xSet.some((p) => p.name === '捏造的秘密')
        ? [undefined, '杀手', '主谋', '因果残片']
        : [undefined];
      for (const secretAddition of additions) {
        if (secretAddition && (pool[secretAddition] || !pack.identities[secretAddition])) continue;
        for (let mobs = 0; mobs <= (pool[pack.setupRules.optionalQuota] ?? 0); mobs++) {
          const counts: Record<string, number> = {
            ...pool,
            ...(secretAddition && { [secretAddition]: 1 }),
            [pack.setupRules.optionalQuota]: mobs,
          };
          const required = Object.values(counts).reduce((sum, n) => sum + n, 0);
          if (required > ordinary.length) continue;
          counts['平民'] = (counts['平民'] ?? 0) + ordinary.length - required;
          const slots = Object.entries(counts).flatMap(([name, n]) => Array<string>(n).fill(name));
          const domains: Domains = new Map();
          const allRoles = Object.keys(pack.identities).filter(
            (id) => pack.identities[id]!.supported,
          );
          const selectedX = xSet.map((p) => p.name);
          const eligible = (character: string, identity: string) => {
            const attr = requiredAttribute(y.name, selectedX, character, baseIdentity(identity));
            return (
              (!attr || pack.characters[character]?.attributes.includes(attr)) &&
              !initialRoleViolation(
                pack,
                y.name,
                character,
                baseIdentity(identity),
                reverseFace(identity),
              )
            );
          };
          for (const c of roster) {
            if (!opening.characters.some((visible) => visible.id === c.id))
              domains.set(`area:${c.id}`, new Set(pack.characters[c.character]?.initial ?? []));
            let roles =
              c.character === '局外人'
                ? allRoles.filter(
                    (r) =>
                      r !== '平民' &&
                      r !== '因果残片' &&
                      !inherent[r] &&
                      !pairs.some((p) => p.split('/').includes(r)),
                  )
                : c.character === '模仿犯'
                  ? [...allRoles, ...pairs]
                  : [...new Set(slots)];
            if (opening.anniversary && roles.includes('平民')) roles = [...roles, fragment];
            domains.set(`identity:${c.id}`, new Set(roles.filter((r) => eligible(c.character, r))));
            if (c.character === '模仿犯')
              domains.set(
                `copy:${c.id}`,
                new Set(roster.filter((t) => t.id !== c.id).map((t) => t.id)),
              );
            if (c.character === '转校生')
              domains.set(
                `enterDay:${c.id}`,
                new Set(
                  c.status === 'absent'
                    ? Array.from({ length: opening.days }, (_, i) => String(i + 1))
                    : [],
                ),
              );
            else if (c.character === '神灵')
              domains.set(
                `enterLoop:${c.id}`,
                new Set(
                  Array.from({ length: opening.loops }, (_, i) => i + 1)
                    .filter((n) => c.status === (n > 1 ? 'absent' : 'alive'))
                    .map(String),
                ),
              );
            else if (c.status !== 'alive') domains.set(`invalid:${c.id}`, new Set());
            if (pack.characters[c.character]?.abilityArea?.publicMarker === 'territory')
              domains.set(
                `territory:${c.id}`,
                new Set(opening.territory ? [opening.territory] : BOARDS),
              );
          }
          if (xSet.some((p) => p.name === '疯狂的真相')) {
            if (!roster.some((c) => c.character === '情报商')) continue;
            domains.set('alternateY', new Set(ys.filter((p) => p !== y).map((p) => p.name)));
          }
          if (secretAddition) domains.set('secretAddition', new Set([secretAddition]));
          if (pack.module === 'WM') domains.set('firstX', new Set(selectedX));
          if (pack.module === 'LL')
            domains.set('privateRoles', new Set(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA']));
          for (const e of opening.incidents) {
            const types = [
              e.name,
              ...(pack.incidents[lifecycle.incident.disguised] &&
              e.name !== lifecycle.incident.disguised
                ? [lifecycle.incident.disguised]
                : []),
            ].filter((name) => pack.incidents[name]?.supported);
            domains.set(`event:${e.day}`, new Set(types));
            domains.set(
              `culprit:${e.day}`,
              new Set(
                types.flatMap((name) =>
                  pack.incidents[name]?.crowdThreshold !== undefined
                    ? BOARDS
                    : roster.map((c) => c.id),
                ),
              ),
            );
          }
          const store = new ConstraintStore(domains, stats);
          store.add(
            allocation(
              ordinary.map((c) => `identity:${c.id}`),
              slots,
              slotIdentity,
            ),
          );
          if (pairs.length) {
            for (const c of roster) {
              const key = 'identity:' + c.id,
                reverse = 'reverse:' + c.id;
              store.domains.set(
                reverse,
                new Set([...store.values(key)].map((v) => reverseFace(v) ?? '无')),
              );
              store.add(
                relation(
                  'paired-slot',
                  key,
                  reverse,
                  (v, side) => (reverseFace(v) ?? '无') === side,
                ),
              );
            }
          }
          if (opening.anniversary)
            store.add(
              exactlyOne(
                roster.map((c) => `identity:${c.id}`),
                fragment,
              ),
            );
          for (const c of roster.filter((c) => c.character === '模仿犯')) {
            const role = `identity:${c.id}`,
              copy = `copy:${c.id}`;
            store.add({
              name: 'copycat',
              reads: [copy, ...roster.map((c) => `identity:${c.id}`)],
              revise(s) {
                s.narrow(
                  copy,
                  [...s.values(copy)].filter((id) =>
                    [...s.values(`identity:${id}`)].some((r) =>
                      [...s.values(role)].some((v) => slotIdentity(r) === slotIdentity(v)),
                    ),
                  ),
                );
                s.narrow(
                  role,
                  [...s.values(role)].filter((v) =>
                    [...s.values(copy)].some((id) =>
                      [...s.values(`identity:${id}`)].some(
                        (r) => slotIdentity(v) === slotIdentity(r),
                      ),
                    ),
                  ),
                );
                if (s.values(copy).size === 1) {
                  const key = `identity:${[...s.values(copy)][0]}`;
                  s.narrow(
                    key,
                    [...s.values(key)].filter((r) =>
                      [...s.values(role)].some((v) => slotIdentity(r) === slotIdentity(v)),
                    ),
                  );
                }
              },
            });
          }
          for (const e of opening.incidents)
            store.add(
              relation('incident-kind', `event:${e.day}`, `culprit:${e.day}`, (type, culprit) =>
                pack.incidents[type]?.crowdThreshold !== undefined
                  ? BOARDS.includes(culprit as (typeof BOARDS)[number])
                  : roster.some((c) => c.id === culprit),
              ),
            );
          if (
            opening.incidents.every((e) =>
              [...store.values(`event:${e.day}`)].every(
                (name) =>
                  name !== lifecycle.incident.repeatCulprit &&
                  pack.incidents[name]?.crowdThreshold === undefined,
              ),
            )
          )
            store.add(
              allocation(
                opening.incidents.map((e) => `culprit:${e.day}`),
                roster.map((c) => c.id),
                (v) => v,
                false,
              ),
            );
          for (let i = 0; i < opening.incidents.length; i++)
            for (const b of opening.incidents.slice(i + 1)) {
              const a = opening.incidents[i]!;
              const keys = [
                `event:${a.day}`,
                `culprit:${a.day}`,
                `event:${b.day}`,
                `culprit:${b.day}`,
              ];
              store.add({
                name: 'culprit-reuse',
                reads: keys,
                revise(s) {
                  const supports = keys.map(() => new Set<string>());
                  for (const at of s.values(keys[0]!))
                    for (const ac of s.values(keys[1]!))
                      for (const bt of s.values(keys[2]!))
                        for (const bc of s.values(keys[3]!)) {
                          if (
                            ac === bc &&
                            !BOARDS.includes(ac as (typeof BOARDS)[number]) &&
                            (at !== lifecycle.incident.repeatCulprit ||
                              bt !== lifecycle.incident.repeatCulprit)
                          )
                            continue;
                          [at, ac, bt, bc].forEach((v, i) => supports[i]!.add(v));
                        }
                  keys.forEach((key, i) => s.narrow(key, supports[i]!));
                },
              });
            }
          if (selectedX.includes('灭亡讴歌'))
            store.add(
              atLeastOne(
                opening.incidents.map((e) => 'event:' + e.day),
                '自杀',
              ),
            );
          if (selectedX.includes('捏造的秘密')) {
            const keys = roster.map((c) => 'identity:' + c.id);
            if (!secretAddition) store.add(atLeastOne(keys, '密钥'));
            else
              for (const key of keys)
                store.narrow(
                  key,
                  [...store.values(key)].filter((v) => v !== '密钥'),
                );
          }
          if (y.name === '高贵的血族') {
            const actors = roster.filter((c) => c.character !== '局外人');
            for (const [i, first] of actors.entries())
              for (const second of actors.slice(i + 1)) {
                if (oppositeSexAttributes(pack, first.character, second.character)) continue;
                store.add(
                  relation(
                    'bloodline',
                    'identity:' + first.id,
                    'identity:' + second.id,
                    (a, b) =>
                      !(a === '关键人物' && b === '吸血鬼') &&
                      !(a === '吸血鬼' && b === '关键人物'),
                  ),
                );
              }
          }
          const days = opening.incidents.map((e) => 'culprit:' + e.day);
          for (const c of roster) {
            const key = 'identity:' + c.id;
            const requirement = (v: string) => culpritRequirement(baseIdentity(v), reverseFace(v));
            if (![...store.values(key)].some(requirement)) continue;
            store.add({
              name: 'scheduled-culprit',
              reads: [key, ...days],
              revise(s) {
                const possible = days.filter((d) => s.values(d).has(c.id));
                const fixed = possible.some((d) => s.values(d).size === 1);
                s.narrow(
                  key,
                  [...s.values(key)].filter((v) => {
                    const mode = requirement(v);
                    return mode === 'required'
                      ? possible.length > 0
                      : mode !== 'forbidden' || !fixed;
                  }),
                );
                const modes = new Set([...s.values(key)].map(requirement));
                if (modes.size === 1 && modes.has('required') && possible.length === 1)
                  s.narrow(possible[0]!, [c.id]);
                if (modes.size === 1 && modes.has('forbidden'))
                  for (const d of possible)
                    s.narrow(
                      d,
                      [...s.values(d)].filter((id) => id !== c.id),
                    );
              },
            });
          }
          store.finishSetup();
          if (store.propagate())
            profiles.push({
              id: `${y.name}|${xSet.map((x) => x.name).join('|')}|${mobs}|${secretAddition ?? ''}`,
              secretAddition,
              y: y.name,
              x: xSet.map((x) => x.name),
              identityCounts: counts,
              store,
              active: true,
            });
        }
      }
    }
  return profiles;
}

// Public evidence need not fix Ex parity, transformation flags or the revelation choice.
export function possibleForms(profile: Profile, slot: string, ex?: number) {
  const reverse = reverseFace(slot);
  const forms = new Set([
    reverse && ex !== undefined && ex % 2 === 1 ? reverse : shownIdentity(slot),
  ]);
  if (reverse && ex === undefined) forms.add(reverse);
  if (profile.y === '因果之绊') forms.add('关键人物');
  if (
    ((ex === undefined || ex % 2 === 1) &&
      profile.x.includes('空想扩大病毒') &&
      (forms.has('平民') || forms.has('因果残片'))) ||
    (profile.x.includes(lifecycle.transformation.plot) &&
      forms.has(lifecycle.transformation.initial))
  )
    forms.add(lifecycle.transformation.effective);
  if (profile.y === '古墓活尸' && ['平民', '胆小鬼', '纸老虎'].some((r) => forms.has(r)))
    forms.add('丧尸');
  return [...forms];
}

export function applyDisclosure(
  profile: Profile,
  opening: PlayerView,
  o: Observation,
  ex?: number,
) {
  const d = o.data;
  if (o.type === 'rule' && typeof d.rule === 'string')
    return [profile.y, ...profile.x].includes(d.rule);
  if (o.type === 'culprit' && typeof d.culprit === 'string') {
    const key = `culprit:${d.day}`;
    if (profile.store.domains.has(key)) profile.store.narrow(key, [d.culprit]);
  }
  if (o.type === 'identity' && typeof d.identity === 'string' && typeof d.character === 'string') {
    const c = (opening.roster ?? opening.characters).find((c) => c.id === d.character);
    const key = `identity:${d.character}`;
    // Temporary-worker replacement and temporal virus identity are never equated with initial identity.
    if (c && !['临时工', '临时工？'].includes(c.character) && profile.store.domains.has(key))
      profile.store.narrow(
        key,
        [...profile.store.values(key)].filter((r) =>
          possibleForms(profile, r, ex).some(
            (form) =>
              form === d.identity ||
              (form === '忍者' &&
                d.identity !== '平民' &&
                [...profile.store.domains].some(
                  ([k, domain]) =>
                    k.startsWith('identity:') &&
                    [...domain].some((v) => baseIdentity(v) === d.identity),
                )),
          ),
        ),
      );
  }
  return profile.store.consistent;
}

export function combinationKey(p: Pick<GameSetup, 'y' | 'x'>) {
  return JSON.stringify([p.y, ...p.x.slice().sort()]);
}
export function supports(profile: Profile, target: Target) {
  if (!profile.active) return false;
  if (target.key === 'rule') return [profile.y, ...profile.x].includes(target.value);
  if (target.key === 'combination') return combinationKey(profile) === target.value;
  const values = profile.store.domains.get(target.key);
  return !!values && targetValues(target.key, values).has(target.value);
}
export function* configurations(
  pack: RulePack,
  opening: PlayerView,
  profiles: Profile[],
  target?: Target,
): Generator<GameSetup | null> {
  for (const profile of profiles) {
    if (!profile.active || (target && !supports(profile, target))) continue;
    const store = profile.store.clone();
    if (target && store.domains.has(target.key))
      store.narrow(
        target.key,
        [...store.values(target.key)].filter(
          (v) => (target.key.startsWith('identity:') ? shownIdentity(v) : v) === target.value,
        ),
      );
    for (const domain of assignments(store, () =>
      profile.active ? profile.store.domains : undefined,
    )) {
      if (!domain) {
        yield null;
        continue;
      }
      const value = (key: string) => [...domain.get(key)!][0]!;
      const characters = publicRoster(pack, opening).map((c) => ({
        id: c.id,
        character: c.character,
        initialArea: domain.has(`area:${c.id}`) ? (value(`area:${c.id}`) as typeof c.area) : c.area,
        identity: baseIdentity(value(`identity:${c.id}`)),
        ...(reverseFace(value(`identity:${c.id}`)) && {
          reverseIdentity: reverseFace(value(`identity:${c.id}`)),
        }),
        ...(c.character === '模仿犯' ? { copiedFrom: value(`copy:${c.id}`) } : {}),
        ...(c.character === '转校生' ? { enterDay: Number(value(`enterDay:${c.id}`)) } : {}),
        ...(c.character === '神灵' ? { enterLoop: Number(value(`enterLoop:${c.id}`)) } : {}),
        ...(domain.has(`territory:${c.id}`)
          ? { territory: value(`territory:${c.id}`) as (typeof BOARDS)[number] }
          : {}),
      }));
      const setup: GameSetup = {
        module: opening.module,
        anniversary: opening.anniversary,
        loops: opening.loops,
        days: opening.days,
        captain: opening.captain,
        discussion: 'allowed',
        y: profile.y,
        x: domain.has('firstX')
          ? [value('firstX'), ...profile.x.filter((x) => x !== value('firstX'))]
          : profile.x,
        characters,
        ...(profile.secretAddition && { secretAddition: profile.secretAddition }),
        ...(domain.has('alternateY') && { alternateY: value('alternateY') }),
        ...(domain.has('privateRoles') && { privateRoles: privateSeats(value('privateRoles')) }),
        incidents: opening.incidents.map((e) => ({
          day: e.day,
          publicName: e.name,
          name: value(`event:${e.day}`),
          culprit: value(`culprit:${e.day}`),
        })),
        ...(opening.anniversary
          ? {
              anniversaryFragment: characters.find((c) => value(`identity:${c.id}`) === fragment)
                ?.id,
            }
          : {}),
      };
      yield validateSetup(pack, setup).length ? null : setup;
    }
  }
}

function privateSeats(permutation: string): NonNullable<GameSetup['privateRoles']> {
  const [p0, p1, p2] = permutation.split('') as ('A' | 'B' | 'C')[];
  return { p0: p0!, p1: p1!, p2: p2! };
}

export function configuredAddition(setup: GameSetup) {
  return setup.x.includes('捏造的秘密') && !setup.characters.some((c) => c.identity === '密钥')
    ? setup.secretAddition
    : undefined;
}

export function setupValues(setup: GameSetup): Map<string, string> {
  const values = new Map<string, string>();
  for (const c of setup.characters) {
    values.set(`identity:${c.id}`, setup.anniversaryFragment === c.id ? '因果残片' : c.identity);
    if (c.reverseIdentity) values.set('reverse:' + c.id, c.reverseIdentity);
    if (c.copiedFrom) values.set(`copy:${c.id}`, c.copiedFrom);
    if (c.enterDay) values.set(`enterDay:${c.id}`, String(c.enterDay));
    if (c.enterLoop) values.set(`enterLoop:${c.id}`, String(c.enterLoop));
    if (c.territory) values.set(`territory:${c.id}`, c.territory);
  }
  for (const e of setup.incidents) {
    values.set(`event:${e.day}`, e.name);
    values.set(`culprit:${e.day}`, e.culprit);
  }
  if (setup.module === 'WM') values.set('firstX', setup.x[0]!);
  const addition = configuredAddition(setup);
  if (addition) values.set('secretAddition', addition);
  if (setup.alternateY) values.set('alternateY', setup.alternateY);
  if (setup.privateRoles)
    values.set(
      'privateRoles',
      setup.privateRoles.p0 + setup.privateRoles.p1 + setup.privateRoles.p2,
    );
  return values;
}
