import type { Protection } from './death.js';
import { gates } from './incident.js';
import { matchCounterSteps, type CounterReport } from './counter-incident.js';
import { effectiveRole } from './effective.js';
import { matchDeaths, withProtection } from './death.js';
import {
  incidentAreas,
  matchSequentialIncident,
  nestedChange,
  sequentialEvents,
} from './nested.js';
import type { Observation, PublicCharacter, Counters } from '../../../contracts/src/game.js';
import type { opening3 } from './opening.js';
type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;
interface Outcome {
  firstFire?: boolean;
  initialEx?: number;
  finalEx?: number;
  selections: string[];
  huntFirstKillChecked?: boolean;
  observedDeaths: Set<string>;
  observedCurses: Set<string>;
  previousCurses?: Set<string>;
  newCurses: Map<string, string>;
  nested?: NonNullable<ReturnType<typeof nestedChange>>[];
  loop: number;
  day: number;
  reports: CounterReport[];
  lastCounters: Map<string, Counters>;
  finalAreas: Map<string, string>;
  pieces: Map<string, Piece>;
  initial: Record<string, number>;
  currentBoards: Record<string, number>;
  moved: Set<string>;
  died: Set<string>;
  counters: Set<string>;
  attachments: Map<string, string>;
  boards: Set<string>;
  identities: Set<string>;
  noEffect: boolean;
  protagonistDeath: boolean;
  independentFailure: boolean;
}
export function startOutcome(
  o: Observation,
  pieces: Map<string, Piece>,
  boards: Record<string, number>,
  previousCurses?: Set<string>,
): Outcome {
  return {
    selections: [],
    observedDeaths: new Set(),
    observedCurses: new Set(),
    previousCurses,
    newCurses: new Map(),
    nested:
      sequentialEvents.has(String(o.data.name)) || o.data.name === '污秽溢出' ? [] : undefined,
    loop: o.loop,
    day: o.day,
    reports: [],
    lastCounters: new Map([...pieces].map(([n, p]) => [n, p.counters])),
    finalAreas: new Map([...pieces].map(([n, p]) => [n, p.area])),
    pieces: new Map(pieces),
    initial: { ...boards },
    currentBoards: { ...boards },
    moved: new Set(),
    died: new Set(),
    counters: new Set(),
    attachments: new Map(),
    boards: new Set(),
    identities: new Set(),
    noEffect: false,
    protagonistDeath: false,
    independentFailure: false,
  };
}
export function recordOutcome(w: Outcome, o: Observation, names: Map<string, string>) {
  const choice = o.data.choice as { kind?: string; value?: string } | undefined;
  if (
    o.type === 'own-choice' &&
    choice?.kind === 'select' &&
    choice.value &&
    names.has(choice.value)
  )
    w.selections.push(names.get(choice.value)!);
  if (w.nested) {
    const change = nestedChange(o, names);
    if (change) w.nested.push(change);
  }
  const d = o.data,
    name = names.get(String(d.character));
  if (w.previousCurses && o.type === 'board' && Array.isArray(d.curses)) {
    for (const card of d.curses)
      if (
        card &&
        typeof card.id === 'string' &&
        typeof card.target === 'string' &&
        !w.previousCurses.has(card.id)
      )
        w.newCurses.set(card.id, names.get(card.target) ?? card.target);
  }
  if (o.type === 'board' && typeof d.ex === 'number') w.finalEx = d.ex;
  const prior = name && w.pieces.get(name);
  if (o.type === 'character' && name && prior) {
    const old = w.lastCounters.get(name)!;
    if (
      d.counters &&
      Object.keys(old).some(
        (k) => old[k as keyof Counters] !== (d.counters as Counters)[k as keyof Counters],
      )
    ) {
      w.reports.push({ name, before: old, after: d.counters as Counters });
      w.lastCounters.set(name, d.counters as Counters);
    }
    if (prior.area !== d.area) w.moved.add(name);
    if (typeof d.area === 'string') w.finalAreas.set(name, d.area);
    if (prior.status === 'alive' && d.status === 'dead') w.died.add(name);
    if (
      d.counters &&
      Object.entries(prior.counters).some(
        ([k, v]) => (d.counters as Record<string, number>)[k] !== v,
      )
    )
      w.counters.add(name);
  }
  if (o.type === 'board' && typeof d.board === 'string' && typeof d.intrigue === 'number') {
    w.currentBoards[d.board] = d.intrigue;
    if (w.initial[d.board] !== d.intrigue) w.boards.add(d.board);
  }
  if (o.type === 'board' && typeof d.attachment === 'string')
    w.attachments.set(d.attachment, names.get(String(d.target)) ?? String(d.target));
  if (o.type === 'identity' && name) w.identities.add(name);
  if (o.type === 'failure' && d.result === 'protagonist-death') w.protagonistDeath = true;
  if (o.type === 'failure' && d.result === 'protagonist-failure') w.independentFailure = true;
  if (o.type === 'no-effect') w.noEffect = true;
}
/** A complete settlement can already rule out a source even with the incident window open. */
export function matchIncidentPublication(
  m: ReturnType<typeof opening3>,
  w: Outcome,
  seq: number,
  module: string,
  causal: Set<string>,
  protection: Protection,
) {
  const events = m.events.get(w.day),
    actors = m.culprits.get(w.day);
  if (!events || !actors) return;
  const label = '#' + seq + ' · 已送齐的事件结算';
  const omen = events['前兆'];
  if (module === 'MC' && omen && m.graph.truth(omen) !== false && w.reports.length) {
    const target = w.reports.at(-1)!;
    if (target.after.paranoia > target.before.paranoia)
      for (const [n, actor] of Object.entries(actors)) {
        const p = w.pieces.get(n),
          victim = w.pieces.get(target.name);
        if (!p || !victim || n === '临时工' || m.graph.truth(actor) === false) continue;
        const twins = effectiveRole(m, n, '双胞胎', p, causal, label) ?? false,
          gate = gates(m.graph, label);
        const opposite: Record<string, string> = {
          city: 'shrine',
          shrine: 'city',
          school: 'hospital',
          hospital: 'school',
        };
        const visible = (area: string) =>
          n === target.name || incidentAreas(n, area).includes(victim.area);
        const match =
          n === '黑猫'
            ? false
            : gate.any([
                gate.all([twins, visible(opposite[p.area] ?? p.area)]),
                gate.all([gate.not(twins), visible(p.area)]),
              ]);
        if (match !== true)
          m.graph.add(
            label + ' · 前兆加不安的来源与结算区域',
            [-omen, -actor, ...(typeof match === 'number' ? [match] : [])],
            1,
          );
      }
  }
  const hunt = events['猎奇杀人'];
  if (
    module === 'MC' &&
    hunt &&
    m.graph.truth(hunt) !== false &&
    !w.huntFirstKillChecked &&
    w.nested
  ) {
    const stepped = w.nested.findIndex(
      (c) => c.piece && c.piece.counters.paranoia > w.pieces.get(c.name)!.counters.paranoia,
    );
    const damage = w.nested.some(
      (c) =>
        c.piece &&
        (c.piece.status === 'dead' ||
          c.piece.counters.guard < w.pieces.get(c.name)!.counters.guard),
    );
    if (stepped >= 0 || damage) {
      w.huntFirstKillChecked = true;
      const before = stepped < 0 ? w.nested : w.nested.slice(0, stepped);
      for (const [n, lit] of Object.entries(actors)) {
        if (m.graph.truth(lit) === false || n === '临时工' || n === '教主') continue;
        const match =
          n === '黑猫'
            ? false
            : matchSequentialIncident(
                '连续杀人',
                m,
                n,
                { pieces: w.pieces, boards: w.initial },
                before,
                causal,
                protection,
                label + ' 猎奇杀人首步 ' + n,
              );
        if (match !== true && match !== undefined)
          m.graph.add(
            label + ' · 猎奇杀人开始加不安时前一步已完成',
            [-hunt, -lit, ...(typeof match === 'number' ? [match] : [])],
            1,
          );
      }
    }
  }
  if (module === 'HSA') {
    for (const [id, target] of w.newCurses) {
      if (w.observedCurses.has(id)) continue;
      w.observedCurses.add(id);
      for (const name of ['言灵诅咒', '诅咒活化']) {
        const event = events[name];
        if (!event || m.graph.truth(event) === false) continue;
        const lit = actors[target === '临时工？' ? '临时工' : target];
        m.graph.work.sources.push(name + ' → ' + target);
        m.graph.add(
          label + ' · 新诅咒 ' + id + ' 的配置当事人',
          [-event, ...(lit ? [lit] : [])],
          1,
        );
      }
    }
  }
  const suicide = events['自杀'];
  if (!['FS', 'BTX'].includes(module) || !suicide || m.graph.truth(suicide) === false) return;
  for (const n of w.died) {
    if (w.observedDeaths.has(n)) continue;
    w.observedDeaths.add(n);
    // The servant can also be the final recipient of another person's request.
    if (n === '从者') continue;
    const lit = actors[n === '临时工？' ? '临时工' : n];
    m.graph.work.sources.push('自杀 → ' + n);
    m.graph.add(label + ' · 自杀原目标已公开死亡', [-suicide, ...(lit ? [lit] : [])], 1);
  }
}
/** Positive signatures use only changes neither a character nor an identity can independently produce
 * in this window in the listed modules. Unbound proxy/area/replacement paths stay possible. */
export function closeOutcome(
  m: ReturnType<typeof opening3>,
  w: Outcome,
  seq: number,
  module: string,
  complete: boolean,
  undecided: (reason: string) => void,
  homes: ReadonlyMap<string, string>,
  protectedProtagonists: boolean,
  causal: Set<string>,
  extraProtection: Protection,
  releasedMovement: ReadonlyMap<string, boolean>,
  invocation?: { event: string; actor: string; reason: string },
) {
  const g = m.graph;
  const label = invocation
    ? invocation.reason + ' · AI 调用' + invocation.event
    : '#' + seq + ' · 闭合第' + w.loop + '轮第' + w.day + '日事件效果';
  let cu = m.culprits.get(w.day),
    events = m.events.get(w.day);
  if (invocation) {
    const source = g.atom(label + ' 按公开名称调用');
    g.add(label, [source], 1);
    cu = { [invocation.actor]: source };
    events = { [invocation.event]: source };
  }
  if (!cu || !events) return false;
  const fullModule = ['FS', 'BTX', 'MZ', 'MC'].includes(module);
  if (complete && !w.independentFailure && !w.protagonistDeath)
    for (const name of w.died) {
      const key = effectiveRole(m, name, '关键人物', w.pieces.get(name), causal, label);
      if (key === undefined) {
        undecided(label + ' · 死亡时关键人物绑定');
        continue;
      }
      if (key !== false)
        g.add(label + ' · 关键人物死亡本应立即结束轮回', typeof key === 'number' ? [-key] : [], 1);
    }
  if (
    module === 'MC' &&
    events['猎奇杀人'] &&
    w.independentFailure &&
    !w.protagonistDeath &&
    w.died.size &&
    g.truth(events['猎奇杀人']) === true
  ) {
    const keys = [...w.died].map((n) =>
      effectiveRole(m, n, '关键人物', w.pieces.get(n), causal, label),
    );
    if (keys.every((k) => k !== undefined && k !== true))
      g.add(
        label + ' · 猎奇杀人中途死亡触发的独立失败',
        keys.filter((k): k is number => typeof k === 'number'),
        1,
        keys.length,
        undefined,
        true,
      );
  }
  const areaResults = new Map<string, number | boolean | undefined>();
  function areaResult(event: string, actor: string, effectiveArea: string) {
    const boards =
      event === '医院事故' ? ['hospital'] : event === '恐怖袭击' ? ['city'] : ['city', 'school'];
    const affected = new Set(boards.filter((b) => w.initial[b]! >= 1));
    const requests = new Map(
      [...w.pieces]
        .filter(
          ([n, p]) => p.status === 'alive' && affected.has(n === actor ? effectiveArea : p.area),
        )
        .map(([name]) => [name, 1]),
    );
    const key = JSON.stringify([...requests.keys()]);
    if (areaResults.has(key)) return areaResults.get(key);
    const match = matchDeaths(
      m,
      w.pieces,
      requests,
      w.died,
      w.lastCounters,
      causal,
      label + ' ' + event + ' ' + key,
      extraProtection,
    );
    areaResults.set(key, match);
    return match;
  }
  const valid = new Set<number>(),
    validEvents = new Set<number>();
  for (const [event, e] of Object.entries(events))
    for (const [n, a] of Object.entries(cu)) {
      if (g.truth(e) === false || g.truth(a) === false) continue;
      const token = event === '希望之光' ? 'hope' : event === '绝望之暗' ? 'despair' : undefined;
      const isolation = module === 'HSA' && event === '孤守';
      const cursePlacement = module === 'HSA' && (event === '言灵诅咒' || event === '诅咒活化');
      const apocalypse = module === 'HSA' && event === '死者默示录';
      const overflow = module === 'HSA' && event === '污秽溢出';
      const fire = module === 'WM' && event === '灭绝之火';
      const discovery = module === 'WM' && event === '发现';
      const fixedAreas = ['医院事故', '暴乱', '恐怖袭击'].includes(event);
      const delayedOnly =
        (module === 'WM' && event === '廷达罗斯之嗅') || (module === 'HSA' && event === '疯狂之夜');
      const shrinePollution = event === '邪气污染';
      const counterSteps = ['不安扩散', '散播'].includes(event) && module !== 'MC';
      if (
        !fullModule &&
        !token &&
        !isolation &&
        !cursePlacement &&
        !apocalypse &&
        !overflow &&
        !discovery &&
        !fixedAreas &&
        !delayedOnly &&
        !shrinePollution &&
        !counterSteps &&
        !fire &&
        !sequentialEvents.has(event)
      ) {
        undecided(label + ' · ' + module + '「' + event + '」的完整结算与连锁尚未匹配');
        valid.add(a);
        validEvents.add(e);
        continue;
      }
      g.work.combinations++;
      const piece = w.pieces.get(n);
      let ok = true;
      const positive = w.moved.size + w.died.size + w.counters.size + w.boards.size;
      if (module === 'MC' && event === '前兆' && n !== '临时工' && piece) {
        const gate = gates(g, label),
          increments = w.reports.filter((r) => r.after.paranoia > r.before.paranoia);
        const total = increments.reduce((sum, r) => sum + r.after.paranoia - r.before.paranoia, 0);
        const need = n === '黑猫' ? 0 : n === '教主' ? 2 : 1;
        const opposite: Record<string, string> = {
          city: 'shrine',
          shrine: 'city',
          school: 'hospital',
          hospital: 'school',
        };
        const matches = (area: string) =>
          increments.every(
            (r) => r.name === n || incidentAreas(n, area).includes(w.pieces.get(r.name)!.area),
          );
        const twin = effectiveRole(m, n, '双胞胎', piece, causal, label) ?? false;
        const where = gate.any([
          gate.all([gate.not(twin), matches(piece.area)]),
          gate.all([twin, matches(opposite[piece.area] ?? piece.area)]),
        ]);
        ok =
          !w.died.size &&
          !w.moved.size &&
          !w.boards.size &&
          total <= need &&
          (!complete || total === need);
        if (where === false) ok = false;
        else if (typeof where === 'number')
          g.add(label + ' · 前兆只选同一结算区域', [-e, -a, where], 1);
      } else if (module === 'MC' && event === '封锁') {
        const area = w.attachments.get('lockdown-area');
        if (invocation || n === '黑猫') ok = area === undefined;
        else if (area === undefined) ok = !complete;
        else if (n === '临时工') undecided(label + ' · 封锁所用的临时工卡');
        else if (piece) {
          const gate = gates(g, label),
            twin = effectiveRole(m, n, '双胞胎', piece, causal, label) ?? false;
          const opposite: Record<string, string> = {
            city: 'shrine',
            shrine: 'city',
            school: 'hospital',
            hospital: 'school',
          };
          const match = gate.any([
            gate.all([gate.not(twin), incidentAreas(n, piece.area).includes(area)]),
            gate.all([twin, incidentAreas(n, opposite[piece.area] ?? piece.area).includes(area)]),
          ]);
          if (match === false) ok = false;
          else if (typeof match === 'number')
            g.add(label + ' · 封锁在当事人有效区域', [-e, -a, match], 1);
        } else ok = false;
        ok &&= !w.moved.size && !w.died.size && !w.boards.size;
      } else if (discovery) {
        if (w.initialEx === undefined || n === '临时工')
          undecided(label + ' · 发现的 EX 基数或双临时工执行者未绑定');
        else {
          const gain = (w.finalEx ?? w.initialEx) - w.initialEx;
          const direct = n === '黑猫' ? 0 : n === '教主' ? 2 : 1;
          // A completed AI goodwill ability can reveal its wizard identity and raise EX once more.
          const extra = Boolean(invocation && w.identities.has(n));
          ok =
            (!complete || gain >= direct) &&
            gain <= direct + (extra ? 1 : 0) &&
            !w.died.size &&
            !w.moved.size &&
            !w.boards.size;
        }
      } else if (delayedOnly) {
        ok = !w.died.size && !w.moved.size && !w.boards.size && !w.counters.size;
      } else if (fire) {
        if (
          w.firstFire === undefined ||
          n === '临时工' ||
          (w.firstFire && n === '教主' && protectedProtagonists)
        ) {
          undecided(label + ' · 灭绝之火的首次发生或重复结算');
        } else if (n === '黑猫' || !w.firstFire) {
          ok =
            w.died.size === 0 &&
            [...w.pieces].every(
              ([name, p]) => p.counters.guard === w.lastCounters.get(name)?.guard,
            );
        } else if (complete || w.protagonistDeath || w.independentFailure) {
          const requests = new Map(
            [...w.pieces].filter(([, p]) => p.status === 'alive').map(([n]) => [n, 1]),
          );
          const match = matchDeaths(
            m,
            w.pieces,
            requests,
            w.died,
            w.lastCounters,
            causal,
            label + ' 灭绝之火',
            extraProtection,
          );
          if (match === undefined) undecided(label + ' · 灭绝之火的替死对象未绑定');
          else if (typeof match === 'boolean') ok = match;
          else g.add(label + ' · 首次灭绝之火同时请求所有角色死亡', [-e, -a, match], 1);
          if (!protectedProtagonists && !w.protagonistDeath) ok = false;
        }
      } else if (shrinePollution && n !== '临时工') {
        const before = w.initial.shrine!,
          after = w.currentBoards.shrine!;
        const required = n === '黑猫' ? 0 : n === '教主' ? 4 : 2;
        ok =
          [...w.boards].every((b) => b === 'shrine') &&
          (complete
            ? after === Math.min(3, before + required)
            : before <= after && after <= Math.min(3, before + required));
      } else if (cursePlacement) {
        const total = n === '黑猫' ? 0 : n === '教主' ? 2 : 1;
        const targets = [...w.newCurses.values()];
        ok =
          (!complete || targets.length === total) &&
          targets.length <= total &&
          targets.every((t) => t === n || (n === '临时工' && t === '临时工？'));
      } else if (overflow) {
        const live = [...w.pieces].some(([, p]) => p.status === 'alive');
        ok =
          w.reports.length <= 1 &&
          w.reports.every(
            (r) =>
              w.pieces.get(r.name)?.status === 'alive' &&
              Object.entries(r.before).every(
                ([key, prior]) =>
                  r.after[key as keyof Counters] === prior + (key === 'paranoia' ? 2 : 0),
              ),
          );
        if (complete) ok &&= Boolean(w.reports.length) === live;
        ok &&=
          !w.died.size &&
          !w.moved.size &&
          w.boards.size <= 1 &&
          [...w.boards].every((b) => w.currentBoards[b] === w.initial[b]! + 1 && w.initial[b]! < 3);
        if (complete && !w.boards.size && !Object.values(w.initial).some((i) => i >= 3)) ok = false;
        if (w.boards.size && live && w.nested) {
          const board = w.nested.find(
            (c) => w.boards.has(c.name) && c.intrigue !== w.initial[c.name],
          );
          const increase = w.nested.find(
            (c) => c.piece && c.piece.counters.paranoia !== w.pieces.get(c.name)?.counters.paranoia,
          );
          if (board && increase && board.group < increase.group) ok = false;
        }
      } else if (apocalypse && n in w.initial) {
        const requests = new Map(
          [...w.pieces]
            .filter(([, p]) => p.area === n && p.status === 'alive')
            .map(([target]) => [target, 1]),
        );
        const corpses =
          (w.initial[n] ?? 0) +
          [...w.pieces].filter(([t, p]) => p.area === n && (p.status === 'dead' || w.died.has(t)))
            .length;
        if (complete || w.protagonistDeath) {
          const hit = matchDeaths(
            m,
            w.pieces,
            requests,
            w.died,
            w.lastCounters,
            causal,
            label + ' ' + n + ' 死者默示录',
            extraProtection,
          );
          if (hit === undefined) undecided(label + ' · 从者追加替死对象');
          else if (typeof hit === 'number')
            g.add(label + ' · 群众所在区域的死亡批次', [-e, -a, hit], 1);
          else ok = hit;
          ok &&= w.protagonistDeath === (!protectedProtagonists && corpses >= 5);
        }
      } else if (isolation) {
        if (n === '黑猫') ok = w.moved.size === 0;
        else if (n !== '临时工' && piece) {
          const areas = incidentAreas(n, piece.area);
          const movement = (selected: string | undefined) =>
            areas.some((area) => {
              const servant = w.pieces.get('从者');
              const follow =
                servant?.status === 'alive' && servant.area === area
                  ? [...w.moved].filter(
                      (t) =>
                        w.pieces.get(t)?.area === area &&
                        (t === '大小姐' || t === '大人物' || t === selected),
                    )
                  : [];
              for (const [name, p] of w.pieces) {
                const moved = w.moved.has(name),
                  to = w.finalAreas.get(name)!;
                if (name === '从者' && selected === '未绑定') continue;
                if (name === '从者' && follow.length) {
                  if (complete && !follow.some((t) => w.finalAreas.get(t) === to)) return false;
                  continue;
                }
                if (p.status !== 'alive' || p.area !== area || name === n) {
                  if (moved) return false;
                  continue;
                }
                const blocked = m.data.forbidden.get(name) ?? [];
                if (moved) {
                  if (to === area || !['hospital', 'shrine', 'school', 'city'].includes(to))
                    return false;
                  if (blocked.includes(to) && !releasedMovement.has(name)) return false;
                } else if (
                  complete &&
                  (releasedMovement.get(name) || !blocked.some((b) => b !== area))
                )
                  return false;
              }
              return true;
            });
          const result =
            typeof extraProtection === 'object'
              ? withProtection(m, extraProtection, w.moved, label, movement)
              : movement(extraProtection);
          if (result === undefined) undecided(label + ' 孤守跟随对象');
          else if (typeof result === 'number')
            g.add(label + ' 孤守的跟随选择', [-e, -a, result], 1);
          else ok = result;
        }
      } else if (token && n !== '临时工') {
        const additions = w.reports.flatMap((report) => {
          const change = report.after[token] - report.before[token];
          return change ? [{ name: report.name, change }] : [];
        });
        const count = additions.reduce((sum, r) => sum + r.change, 0);
        const required = n === '黑猫' ? 0 : n === '教主' ? 2 : 1;
        ok =
          additions.every((r) => w.pieces.get(r.name)?.status === 'alive' && r.change > 0) &&
          (complete ? count === required : count <= required);
      } else if (n === '黑猫') {
        // MC still raises EX for an occurrence, and incident-completed abilities run after cancellation.
        ok = w.moved.size === 0 && w.died.size === 0 && w.boards.size === 0;
      } else if (n !== '临时工' && piece) {
        if (
          ['医院事故', '恐怖袭击', '暴乱'].includes(event) &&
          n !== '教主' &&
          (complete || w.protagonistDeath) &&
          ['FS', 'BTX', 'MZ', 'WM'].includes(module)
        ) {
          const matches = incidentAreas(n, piece.area).map((area) => areaResult(event, n, area));
          const match = matches.includes(true)
            ? true
            : matches.some((v) => v === undefined)
              ? undefined
              : gates(g, label).any(matches as (number | boolean)[]);
          if (match === undefined) undecided(label + ' · 从者额外保护对象');
          else if (match === false) ok = false;
          else if (typeof match === 'number')
            g.add(label + ' · 区域死亡与护卫消耗', [-e, -a, match], 1);
        }
        const servant = w.pieces.get('从者');
        if (event === '自杀' && !complete) ok = [...w.died].every((t) => t === n || t === '从者');
        if (
          ['谋杀', '连续杀人'].includes(event) &&
          servant?.status !== 'alive' &&
          n !== '仙人' &&
          !m.ids.get(n)?.['双胞胎']
        )
          ok = [...w.died].every((t) => t !== n && w.pieces.get(t)?.area === piece.area);
        if (event === '自白' && module === 'MZ' && w.identities.size) ok = w.identities.has(n);
        if (event === '伪造事件') {
          ok = positive === 0 && w.identities.size === 0 && !w.attachments.size;
          const home = homes.get(n);
          if (home && home in w.initial) {
            const expected = !protectedProtagonists && w.initial[home]! >= 2;
            if (complete || w.protagonistDeath) ok &&= expected === w.protagonistDeath;
          } else undecided(label + ' · 伪造事件当事人的本轮初始区域');
        }
        if (event === '伪装自杀' && w.attachments.has('no-protagonist-cards'))
          ok = w.attachments.get('no-protagonist-cards') === n;
        if (event === '蝴蝶效应' && n !== '仙人')
          ok = [...w.counters].every((t) => w.pieces.get(t)?.area === piece.area);
        if (event === '失踪' && !w.pieces.has('从者')) ok = [...w.moved].every((t) => t === n);
        if (sequentialEvents.has(event) && complete) {
          const result = matchSequentialIncident(
            event,
            m,
            n,
            { pieces: w.pieces, boards: w.initial },
            w.nested ?? [],
            causal,
            extraProtection,
            label + ' ' + n,
            w.selections,
            releasedMovement,
          );
          if (result === undefined) undecided(label + ' · ' + event + '的执行者或跟随对象未绑定');
          else if (typeof result === 'boolean') ok = result;
          else g.add(label + ' · ' + event + '的同一合法顺序', [-e, -a, result], 1);
        }
        if (event === '不安扩散' && w.noEffect && module !== 'MC') ok = false;
      }
      if (module === 'MC' && event === '银色子弹' && complete && n !== '黑猫') ok = false;
      if (ok && complete && counterSteps) {
        const compatible = matchCounterSteps(event, n, w.pieces, w.reports, g.work);
        if (compatible === undefined) undecided(label + ' · ' + n + ' 的执行者绑定或局部选择预算');
        else ok = compatible;
      }
      if (
        ok &&
        complete &&
        module === 'MC' &&
        !invocation &&
        n !== '临时工' &&
        piece?.status === 'alive' &&
        !w.died.has(n)
      ) {
        const last = w.lastCounters.get(n)!;
        const cleared = w.reports.some(
          (r) => r.name === n && r.before.paranoia > 0 && r.after.paranoia === 0,
        );
        if (last.paranoia > 0 || cleared) {
          const fool = effectiveRole(m, n, '愚者', piece, causal, label);
          if (fool !== undefined) {
            const match = last.paranoia > 0 ? gates(g, label).not(fool) : fool;
            if (match === false) ok = false;
            else if (typeof match === 'number')
              g.add(label + ' · 愚者在事件完成后清空自身不安', [-e, -a, match], 1);
          }
        }
      }
      if (!ok) g.add(label + ' · ' + event + ' / ' + n, [-e, -a], 1);
      else {
        valid.add(a);
        validEvents.add(e);
      }
    }
  for (const [set, terms] of [
    [valid, Object.values(cu)],
    [validEvents, Object.values(events)],
  ] as const) {
    if (terms.some((a) => g.truth(a) !== false && !set.has(a)))
      g.add(label, [...set], 1, set.size, undefined, true);
  }
  return true;
}
