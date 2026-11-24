import type { PlayerView } from '../../../contracts/src/game.js';
import { catalog3 } from '../../../content/src/official/catalog3.js';
import { Relations } from './relations.js';

export type Table = '角色身份' | '规则' | '真实事件' | '事件当事人';
export interface Row {
  table: Table;
  name: string;
  owner?: string;
  cells: Record<string, number>;
}
const delayed = ['神灵', '转校生'];
const crowds = new Set(['疯狂之夜', '诅咒活化', '污秽溢出', '死者默示录']);
export const boards = ['hospital', 'shrine', 'city', 'school'];
const required = new Set(['强迫症', '愚者', '双胞胎', '祭品', '怪杰']);
const attributes = [
  ['和我签订契约吧！', '关键人物', '少女'],
  ['少女大危机', '关键人物', '少女'],
  ['男子汉的战争', '忍者', '男性'],
  ['爱丽丝梦游仙境', '爱丽丝', '少女'],
  ['叛逆的世界', '关键人物', '少女'],
  ['叛逆的世界', '因果残片', '少女'],
];
export function opening3(view: PlayerView) {
  if (view.module === 'AHR') throw Error('AHR 不在求解器 3 范围内');
  const data = catalog3(view.module, view.anniversary);
  const graph = new Relations();
  const rows: Row[] = [];
  const make = (table: Table, name: string, options: string[], owner?: string) => {
    const cells = Object.fromEntries(
      options.map((key) => [key, graph.atom(JSON.stringify([table, name, key]))]),
    );
    rows.push({ table, name, cells, owner });
    return cells;
  };
  const one = (reason: string, terms: number[]) => graph.add(reason, terms, 1, 1);
  const fixed = (reason: string, lit: number) => one(reason, [lit]);
  const implies = (reason: string, lit: number, alternatives: number[]) =>
    graph.add(reason, alternatives, 1, alternatives.length, lit);
  const names = new Map(
    [...view.characters, ...(view.roster ?? [])]
      .filter((c) => c.character !== '临时工？')
      .map((c) => [c.id, c.character]),
  );
  const cast = [...new Set([...names.values(), ...delayed])];
  const schedule = view.incidents;
  const roles = data.identities.map((i) => i.name);
  const plots = Object.fromEntries(data.plots.map((p) => [p.name, graph.atom('采用 ' + p.name)]));
  const y = data.plots.filter((p) => p.type === 'Y').map((p) => p.name);
  const x = data.plots.filter((p) => p.type === 'X').map((p) => p.name);
  const primary = make('规则', '主 Y', y);
  for (const key of y) plots[key] = primary[key]!;
  one('剧本指定一条主线', Object.values(primary));
  const slots = view.module === 'FS' ? 1 : 2;
  const x1 = make('规则', view.module === 'WM' ? 'X1' : '规则 X', x);
  const x2 = view.module === 'WM' ? make('规则', 'X2', x) : undefined;
  graph.add('副线名额', Object.values(x1), x2 ? 1 : slots, x2 ? 1 : slots);
  if (x2) one('第二副线名额', Object.values(x2));
  for (const key of x) {
    const options = x2 ? [x1[key]!, x2[key]!] : [x1[key]!];
    if (x2) one('副线顺位与采用关系', [...options, -plots[key]!]);
    else plots[key] = x1[key]!;
  }
  const alt = view.module === 'WM' ? make('规则', '疯狂的真相 · 预设失败条件来源 Y', y) : {};
  if (plots['疯狂的真相']) {
    one('疯狂的真相指定另一条主线的失败条件', [...Object.values(alt), -plots['疯狂的真相']]);
    for (const key of y) graph.add('主线与预设来源不同', [alt[key]!, primary[key]!], 0, 1);
    if (!cast.includes('情报商')) fixed('疯狂的真相要求情报商', -plots['疯狂的真相']);
  }
  const seats = new Map<string, Record<string, number>>();
  if (view.module === 'LL') {
    for (const s of ['p0', 'p1', 'p2']) {
      const cards = Object.fromEntries(
        ['A', 'B', 'C'].map((card) => [card, graph.atom(s + ' 持有 EX ' + card)]),
      );
      seats.set(s, cards);
      one('每席一张私人 EX 牌', Object.values(cards));
    }
    for (const card of ['A', 'B', 'C'])
      one(
        '私人 EX 牌只发给一席',
        [...seats.values()].map((v) => v[card]!),
      );
  }
  const ids = new Map<string, Record<string, number>>();
  const arrival = new Map<string, number[]>();
  const absent = new Map<string, number>();
  for (const name of cast) {
    const cells = make('角色身份', name, roles, name);
    ids.set(name, cells);
    const terms = Object.values(cells);
    if (delayed.includes(name)) {
      const missing = graph.atom(name + ' 未配置');
      absent.set(name, missing);
      terms.push(missing);
      const times = Array.from({ length: name === '神灵' ? view.loops : view.days }, (_, i) =>
        graph.atom(name + ' 指定登场 ' + (i + 1)),
      );
      arrival.set(name, times);
      one('登场参数与存在性', [missing, ...times]);
    }
    one('每位配置角色恰有一个剧本身份', terms);
    for (const identity of data.identities) {
      const lit = cells[identity.name]!;
      if (
        (name === 'AI' && identity.name === '平民') ||
        (name === '妹妹' && identity.ignore) ||
        (name === '局外人' && ['平民', '因果残片'].includes(identity.name))
      )
        fixed('角色制作限制 ' + name, -lit);
      if (name !== '局外人') continue;
      for (const p of data.plots.filter((p) => p.identities[identity.name]))
        graph.add('局外人必须取名额外身份', [lit, plots[p.name]!], 0, 1);
    }
    for (const [plot, role, tag] of attributes)
      if (
        name !== '局外人' &&
        plots[plot!] &&
        cells[role!] &&
        !data.attributes.get(name)?.includes(tag!)
      )
        graph.add('制作属性 ' + plot, [plots[plot!]!, cells[role!]!], 0, 1);
  }
  if (plots['高贵的血族']) {
    const tags = (name: string) => data.attributes.get(name) ?? [];
    const male = (n: string) => tags(n).some((t) => t === '男性' || t === '少年');
    const female = (n: string) => tags(n).some((t) => t === '女性' || t === '少女');
    for (const a of cast.filter((n) => n !== '局外人'))
      for (const b of cast.filter((n) => n !== '局外人' && n !== a)) {
        if (!((male(a) && female(b)) || (female(a) && male(b))))
          graph.add(
            '高贵的血族要求互为异性',
            [plots['高贵的血族'], ids.get(a)!['关键人物']!, ids.get(b)!['吸血鬼']!],
            0,
            2,
          );
      }
  }
  const addition: Record<string, number> = {};
  if (plots['捏造的秘密']) {
    const keyHolders = cast.map((c) => ids.get(c)!['密钥']!);
    for (const role of ['主谋', '杀手', '因果残片']) {
      const a = graph.atom('捏造的秘密追加 ' + role);
      addition[role] = a;
      implies('追加须采用捏造的秘密', a, [plots['捏造的秘密']]);
      graph.add('剧本中已有密钥时不能追加', keyHolders, 0, 0, a);
      for (const p of data.plots.filter((p) => p.identities[role]))
        graph.add('只追加规则中没有的身份', [a, plots[p.name]!], 0, 1);
    }
    graph.add('只追加一种身份', Object.values(addition), 0, 1);
    implies('密钥存在或指定追加身份', plots['捏造的秘密'], [
      ...keyHolders,
      ...Object.values(addition),
    ]);
  }
  const fragments = new Map<string, number>();
  if (view.anniversary) {
    for (const name of cast) {
      const a = graph.atom('周年指定 ' + name);
      fragments.set(name, a);
      implies('周年追加的因果残片取自配置平民', a, [ids.get(name)!['平民']!]);
    }
    graph.add('周年至多转换一名原平民', [...fragments.values()], 0, 1);
    for (const row of ids.values())
      implies('有配置平民时必须进行周年转换', row['平民']!, [...fragments.values()]);
  }
  for (const { name: role, max } of data.identities) {
    if (ids.has('模仿犯'))
      implies(
        '模仿犯在周年指定前复制另一名角色的原身份',
        ids.get('模仿犯')![role]!,
        cast
          .filter((n) => n !== '模仿犯')
          .map((n) => ids.get(n)![role]!),
      );
    if (role === '平民') continue;
    const allocated = cast
      .filter((n) => n !== '模仿犯' && n !== '局外人')
      .map((n) => ids.get(n)![role]!);
    const supply = data.plots.flatMap((p) =>
      Array<number>(p.identities[role] ?? 0).fill(plots[p.name]!),
    );
    if (addition[role]) supply.push(addition[role]!);
    const cap = Math.min(max ?? Infinity, supply.length);
    graph.add('身份人数上限 ' + role, allocated, 0, cap);
    for (let k = 1; k <= cap; k++) {
      const threshold = graph.atom(role + ' 名额至少 ' + k);
      graph.add('规则提供身份名额 ' + role, supply, k, supply.length, threshold);
      graph.add('规则提供身份名额 ' + role, supply, 0, k - 1, -threshold);
      graph.add('分配不超过名额 ' + role, allocated, 0, k - 1, -threshold);
      if (role !== '暴徒')
        graph.add('分配全部名额 ' + role, allocated, k, allocated.length, threshold);
    }
  }
  const baseCivilian = new Map([...ids].map(([n, r]) => [n, r['平民']!]));
  // The designated civilian changes only after ordinary quotas and copycat are resolved.
  for (const [name, designation] of fragments) {
    const row = rows.find((r) => r.owner === name)!;
    const base = ids.get(name)!;
    const civilian = graph.atom(name + ' 周年分配后为平民');
    const fragment = graph.atom(name + ' 周年分配后为因果残片');
    graph.add('周年分配后保留平民', [base['平民']!, -designation], 2, 2, civilian);
    graph.add('周年分配后保留平民', [base['平民']!, -designation], 0, 1, -civilian);
    graph.add('周年分配后因果残片来源', [base['因果残片']!, designation], 1, 2, fragment);
    graph.add('周年分配后因果残片来源', [base['因果残片']!, designation], 0, 0, -fragment);
    row.cells = { ...base, 平民: civilian, 因果残片: fragment };
    ids.set(name, row.cells);
  }
  // Project only the mutually dependent plot choices and their minimum staffing.
  // No character assignment or scheduled culprit is enumerated here.
  const tuples: { lit: number; selected: Set<string>; quota: Record<string, number> }[] = [];
  const regular = cast.filter((n) => !['局外人', '模仿犯'].includes(n));
  const sides =
    slots === 1 ? x.map((n) => [n]) : x.flatMap((n, i) => x.slice(i + 1).map((b) => [n, b]));
  for (const main of y)
    for (const side of sides) {
      graph.work.combinations++;
      const selected = new Set([main, ...side]);
      const quota: Record<string, number> = {};
      for (const p of data.plots.filter((p) => selected.has(p.name)))
        for (const [role, count] of Object.entries(p.identities)) {
          quota[role] = Math.min(
            data.identities.find((i) => i.name === role)?.max ?? Infinity,
            (quota[role] ?? 0) + count,
          );
        }
      const requiresAddition = selected.has('捏造的秘密') && !quota['密钥'] && !ids.has('局外人');
      const minimum = Object.entries(quota).reduce(
        (n, [role, count]) => n + (role === '暴徒' ? 0 : count),
        Number(requiresAddition),
      );
      if (minimum > regular.length) continue;
      const lit = graph.atom('主副线组合 ' + [...selected].join('、'));
      tuples.push({ lit, selected, quota });
      graph.add(
        '主副线组合共同成立',
        [...selected].map((n) => plots[n]!),
        selected.size,
        selected.size,
        lit,
      );
      const remainder = [...absent.values(), ...regular.map((n) => baseCivilian.get(n)!)];
      const maxSpecial =
        Object.values(quota).reduce((a, b) => a + b, 0) + (selected.has('捏造的秘密') ? 1 : 0);
      graph.add(
        '普通席位由平民、规则身份或未配置角色占据',
        remainder,
        Math.max(0, regular.length - maxSpecial),
        regular.length - minimum,
        lit,
      );
      graph.add(
        '身份名额要求足够的配置角色',
        [...absent.values()],
        0,
        regular.length - minimum,
        lit,
      );
    }
  one(
    '剧本采用一个合法主副线组合',
    tuples.map((t) => t.lit),
  );
  // Optional thugs compete for seats with mandatory roles and absent delayed characters.
  // A role's nominal quota alone is insufficient when every supplying plot fills the cast.
  const optionalThugs = regular.flatMap((n) => ids.get(n)!['暴徒'] ?? []);
  const maxThugs = Math.max(0, ...tuples.map((t) => t.quota['暴徒'] ?? 0));
  for (let count = 1; count <= maxThugs; count++) {
    const support: number[] = [];
    const enoughSeats = new Map<number, number>();
    for (const t of tuples) {
      if ((t.quota['暴徒'] ?? 0) < count) continue;
      const mandatory = Object.entries(t.quota).reduce(
        (sum, [role, k]) => sum + (role === '暴徒' ? 0 : k),
        0,
      );
      const maxAbsent = regular.length - mandatory - count;
      if (maxAbsent < 0) continue;
      if (maxAbsent >= absent.size) {
        support.push(t.lit);
        continue;
      }
      let enough = enoughSeats.get(maxAbsent);
      if (!enough) {
        enough = graph.atom('可配置 ' + count + ' 名暴徒时未配置角色至多 ' + maxAbsent);
        graph.add('有空余配置席位', [...absent.values()], 0, maxAbsent, enough);
        graph.add('空余配置席位不足', [...absent.values()], maxAbsent + 1, absent.size, -enough);
        enoughSeats.set(maxAbsent, enough);
      }
      const branch = graph.atom('暴徒空位 ' + count + ' ' + t.lit);
      graph.add('供给暴徒且仍有空余配置席位', [t.lit, enough], 2, 2, branch);
      support.push(branch);
    }
    const possible = graph.atom('可分配至少 ' + count + ' 名暴徒');
    implies('暴徒人数必须有同时满足名额及席位的来源', possible, support);
    graph.add('缺少席位时限制暴徒人数', optionalThugs, 0, count - 1, -possible);
  }
  for (const [name, lit] of Object.entries(plots)) {
    graph.add(
      '已采用的规则排除所有不含该规则的主副线组合',
      tuples.filter((t) => !t.selected.has(name)).map((t) => t.lit),
      0,
      0,
      lit,
    );
    implies(
      '采用规则须有相容的主副线组合',
      lit,
      tuples.filter((t) => t.selected.has(name)).map((t) => t.lit),
    );
  }
  for (const role of roles.filter((n) => n !== '平民')) {
    const counts = [...new Set(tuples.map((t) => t.quota[role] ?? 0))];
    for (const count of counts) {
      const level = graph.atom(role + ' 普通规则名额 ' + count);
      const allowed = tuples.filter((t) => (t.quota[role] ?? 0) === count).map((t) => t.lit);
      graph.add('主副线组合决定身份名额', allowed, 1, allowed.length, level);
      graph.add('主副线组合决定身份名额', allowed, 0, 0, -level);
      if (!addition[role] && !(view.anniversary && role === '因果残片')) {
        const assigned = regular.map((n) => ids.get(n)![role]!);
        graph.add('普通规则身份名额 ' + role, assigned, role === '暴徒' ? 0 : count, count, level);
      }
    }
    one(
      '普通规则名额必取一个合法数量',
      counts.map((n) => graph.atom(role + ' 普通规则名额 ' + n)),
    );
  }
  const events = new Map<number, Record<string, number>>();
  const culprits = new Map<number, Record<string, number>>();
  const targets = data.events.some((e) => crowds.has(e)) ? [...cast, ...boards] : cast;
  for (const { day, name } of schedule) {
    if (events.has(day) || day < 1 || day > view.days || !Number.isInteger(day))
      one('事件预定日重复或越界', []);
    const label = '第 ' + day + ' 日 · ' + name;
    const ev = make('真实事件', label, data.events);
    const cu = make('事件当事人', label, targets);
    one('每个预定日一个真实事件', Object.values(ev));
    one('每个预定日一位当事人', Object.values(cu));
    events.set(day, ev);
    culprits.set(day, cu);
    for (const e of data.events) {
      if (name !== e && e !== '伪造事件') fixed('公开日程 ' + name, -ev[e]!);
      else {
        const valid = targets.filter((t) => crowds.has(e) === boards.includes(t));
        implies(
          '真实事件指定合法当事人',
          ev[e]!,
          valid.map((t) => cu[t]!),
        );
        const excluded = targets.filter((t) => !valid.includes(t)).map((t) => cu[t]!);
        if (excluded.length) graph.add('群众事件与普通事件当事人类型互斥', excluded, 0, 0, ev[e]!);
      }
    }
    const matching = data.events.filter((e) => e === name || e === '伪造事件').map((e) => ev[e]!);
    graph.add('公开名称对应的真实事件', matching, 1, 1, undefined, matching.length > 1);
    for (const [n, missing] of absent) implies('当事人必须配置', cu[n]!, [-missing]);
  }
  for (const name of cast) {
    const days = [...culprits.keys()];
    const terms = days.map((day) => culprits.get(day)![name]!);
    for (const role of roles) {
      if (required.has(role)) implies('身份必须为当事人 ' + role, ids.get(name)![role]!, terms);
      if (days.length === 1 && required.has(role) && data.plots.some((p) => p.identities[role])) {
        const supplied = graph.atom(role + ' 名额至少 1');
        graph.add(
          '唯一预定日的当事人须承接已分配的 ' + role,
          [-supplied, -terms[0]!, ids.get(name)![role]!],
          1,
        );
      }
      if (role === '侦探') graph.add('侦探不能为当事人', terms, 0, 0, ids.get(name)![role]!);
    }
    for (const day of days) {
      const others = days.filter((d) => d !== day).map((d) => culprits.get(d)![name]!);
      if (!others.length) continue;
      const serial = events.get(day)!['连续杀人'];
      for (const other of others)
        graph.add(
          '跨日重复的当事人必须均为连续杀人',
          [-culprits.get(day)![name]!, -other, ...(serial ? [serial] : [])],
          1,
        );
    }
  }
  if (plots['灭亡讴歌'])
    implies(
      '灭亡讴歌要求至少一个真实自杀',
      plots['灭亡讴歌'],
      [...events.values()].flatMap((v) => (v['自杀'] ? [v['自杀']] : [])),
    );
  graph.propagate();
  const plotCases = tuples.map((t) => t.lit);
  const setupCells = [...ids.values(), plots].flatMap((r) => Object.values(r));
  function projectQuotas(reason: string, refuteCells = false) {
    graph.resolveCauses(reason, plotCases, setupCells);
    if (refuteCells) graph.refute(reason, setupCells);
  }
  // An integer with no public upper bound only needs cuts at thresholds actually read.
  const hermitCuts = new Map<number, number>();
  function hermitAtMost(upper: number) {
    if (upper < 0) return false as const;
    const existing = hermitCuts.get(upper);
    if (existing !== undefined) return existing;
    const cut = graph.atom('仙人制作参数 X ≤ ' + upper);
    let lower = -Infinity,
      higher = Infinity;
    for (const limit of hermitCuts.keys()) {
      if (limit < upper) lower = Math.max(lower, limit);
      if (limit > upper) higher = Math.min(higher, limit);
    }
    if (hermitCuts.has(lower))
      graph.add('同局仙人 X 的整数顺序', [-hermitCuts.get(lower)!, cut], 1);
    if (hermitCuts.has(higher))
      graph.add('同局仙人 X 的整数顺序', [-cut, hermitCuts.get(higher)!], 1);
    hermitCuts.set(upper, cut);
    return cut;
  }
  return {
    hermitAtMost,
    projectQuotas,
    graph,
    rows,
    data,
    seats,
    ids,
    plots,
    x1,
    x2,
    primary,
    alt,
    arrival,
    absent,
    events,
    culprits,
    names,
    fragments,
  };
}
