import { admits } from './solution3-offline-sat.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import { SolutionSpace3 } from '../../packages/engine/src/solution3/space.js';
import { choose, generator } from '../comprehensive/random-choices.js';

const records = JSON.parse(
  readFileSync(new URL('../../products/engine/tutorials/histories.json', import.meta.url), 'utf8'),
) as { setup: GameSetup; scenario: string }[];
const start = Number(process.argv[2] ?? 1),
  count = Number(process.argv[3] ?? 1);
assert(Number.isSafeInteger(start) && Number.isSafeInteger(count) && count > 0);
const cases = new Map(
  records.filter((r) => r.setup.module !== 'AHR').map((r) => [r.scenario, r.setup]),
);
for (const [name, setup] of [...cases]) {
  if (setup.module === 'LL') continue;
  const characters = setup.characters.slice();
  let civilian = characters.find(
    (c) => c.identity === '平民' && !['局外人', '模仿犯', '临时工'].includes(c.character),
  );
  if (!civilian) {
    const character = [
      '男学生',
      '女学生',
      '职员',
      '刑警',
      '偶像',
      '媒体人',
      '教师',
      '医生',
      '护士',
    ].find((n) => !characters.some((c) => c.character === n));
    assert(character);
    civilian = { id: 'extra-civilian', character, identity: '平民' };
    characters.push(civilian);
  }
  cases.set(name + ' 周年', {
    ...setup,
    characters,
    anniversary: true,
    anniversaryFragment: civilian.id,
  });
}
function mixedCast(base: GameSetup, seed: number, pack: ReturnType<typeof compileOfficial>) {
  const options = [
    '仙人',
    '教主',
    '从者',
    '大小姐',
    '大人物',
    'UP主',
    '刑警',
    '医生',
    '转校生',
    '神灵',
    '黑猫',
    '鉴别员',
    '异界人',
    '妹妹',
    '偶像',
    '军人',
    '情报商',
    '幻想',
    '手下',
    '护士',
    '学者',
  ];
  const draw = generator(Math.imul(seed, 7919));
  let current = base;
  for (let trial = 0; trial < 3; trial++) {
    const character = options[draw(options.length)]!,
      slot = draw(current.characters.length);
    if (current.characters.some((c) => c.character === character)) continue;
    const candidate = structuredClone(current),
      original = candidate.characters[slot]!;
    const person: GameSetup['characters'][number] = {
      id: original.id,
      identity: original.identity,
      character,
    };
    if (character === '仙人') {
      person.initialArea = draw(2) ? 'hospital' : 'shrine';
      person.x = draw(7);
    }
    if (character === '大人物') person.territory = draw(2) ? 'hospital' : 'school';
    if (character === '手下' || character === '幻想') person.initialArea = 'city';
    if (character === '转校生') person.enterDay = 1 + draw(candidate.days);
    if (character === '神灵') person.enterLoop = 1 + draw(candidate.loops);
    candidate.characters[slot] = person;
    if (initializeDiscussion(pack, candidate).state) current = candidate;
  }
  return current;
}
// This offline generator deliberately changes the production table as well as the public choices.
function variedScript(base: GameSetup, seed: number, pack: ReturnType<typeof compileOfficial>) {
  const draw = generator(Math.imul(seed, 10007));
  const pick = <T>(xs: T[]) => xs[draw(xs.length)]!;
  const plots = Object.values(pack.plots).filter((p) => p.supported);
  const sides = plots.filter((p) => p.type === 'X'),
    mains = plots.filter((p) => p.type === 'Y');
  const incidents = Object.values(pack.incidents).filter((i) => i.supported);
  const cast = mixedCast(base, seed, pack);
  for (let trial = 0; trial < 300; trial++) {
    const y = pick(mains),
      selected = [pick(sides)];
    if (pack.setupRules.xSlots === 2) selected.push(pick(sides.filter((p) => p !== selected[0])));
    const roles = [y, ...selected].flatMap((p) =>
      Object.entries(p.identities).flatMap(([r, total]) => Array<string>(total).fill(r)),
    );
    if (roles.length > cast.characters.length) continue;
    while (roles.length < cast.characters.length) roles.push('平民');
    const setup = structuredClone(cast);
    setup.y = y.name;
    setup.x = selected.map((p) => p.name);
    if (setup.x.includes('疯狂的真相')) setup.alternateY = pick(mains.filter((p) => p !== y)).name;
    else delete setup.alternateY;
    for (const c of setup.characters) c.identity = roles.splice(draw(roles.length), 1)[0]!;
    if (setup.anniversary) {
      const civilians = setup.characters.filter((c) => c.identity === '平民');
      if (!civilians.length) continue;
      setup.anniversaryFragment = pick(civilians).id;
    }
    setup.incidents = setup.incidents.map((i) => {
      const incident = pick(incidents);
      return {
        day: i.day,
        name: incident.name,
        culprit:
          incident.crowdThreshold === undefined
            ? pick(setup.characters).id
            : pick(['school', 'hospital', 'shrine', 'city']),
        ...(incident.name === '伪造事件' ? { publicName: '临时通知' } : {}),
      };
    });
    if (initializeDiscussion(pack, setup).state) return setup;
  }
  throw Error('生成合法测试配置失败 ' + base.module + ' ' + seed);
}
for (let seed = start; seed < start + count; seed++)
  for (const [scenario, initial] of cases) {
    if (process.argv[4] && process.argv[4] !== initial.module) continue;
    if (process.argv[5] === 'overlay' && !initial.anniversary) continue;
    if (process.argv[5] === 'base' && initial.anniversary) continue;
    const draw = generator(seed),
      pack = compileOfficial(initial.module, initial.anniversary),
      setup =
        process.argv[5] === 'varied'
          ? variedScript(initial, seed, pack)
          : process.argv[5] === 'mixed'
            ? mixedCast(initial, seed, pack)
            : initial;
    const substitutions = setup.characters.flatMap((c, i) =>
      c.character === initial.characters[i]!.character
        ? []
        : [initial.characters[i]!.character + '→' + c.character],
    );
    if (setup.x.includes('超越世界线') && !setup.characters.some((c) => c.identity === '传谣人')) {
      console.log(
        JSON.stringify({
          scenario,
          seed,
          steps: 0,
          through: 0,
          status: 'forward-divergence',
          knownDivergence: { record: 0, kind: 'missing-anniversary-rumormonger' },
          substitutions,
          plots: [setup.y, ...setup.x],
          events: setup.incidents.map((i) => i.name),
        }),
      );
      continue;
    }
    let state = initializeDiscussion(pack, setup).state!;
    const solver = new SolutionSpace3(initialPlacementView(state)),
      m = solver.model;
    const facts = [...setup.x, setup.y].map((n) => m.plots[n]!);
    for (const [n, absent] of m.absent) {
      const c = setup.characters.find((c) => c.character === n);
      facts.push(c ? -absent : absent);
      const arrival = c && (n === '神灵' ? c.enterLoop : c.enterDay);
      if (arrival) facts.push(m.arrival.get(n)![arrival - 1]!);
    }
    if (m.x2) facts.push(m.x1[setup.x[0]!]!, m.x2[setup.x[1]!]!);
    if (setup.alternateY) facts.push(m.alt[setup.alternateY]!);
    for (const c of setup.characters)
      facts.push(
        m.ids.get(c.character)![setup.anniversaryFragment === c.id ? '因果残片' : c.identity]!,
      );
    for (const i of setup.incidents)
      facts.push(
        m.events.get(i.day)![i.name]!,
        m.culprits.get(i.day)![
          setup.characters.find((c) => c.id === i.culprit)?.character ?? i.culprit
        ]!,
      );
    let steps = 0,
      knownDivergence:
        | { record: number; ability: unknown; selected: number; current: number }
        | { record: number; kind: 'curse-without-board'; target: 'far' }
        | {
            record: number;
            kind: 'inactive-alternate-loss';
            alternate: string;
            ex: number;
            shrine: number;
          }
        | { record: number; kind: 'cat-isolation-movement'; moved: string }
        | { record: number; kind: 'stale-incident-area'; physical: string; board: string }
        | undefined;
    while (state.pending && state.phase !== 'finished') {
      const d = state.pending,
        choice = choose(state, draw);
      const previous = state;
      const result = advance(pack, state, d.actor, {
        id: 'campaign-' + steps,
        expectedRevision: state.revision,
        decisionId: d.id,
        choice,
      });
      assert.notEqual(
        result.status,
        'rejected',
        JSON.stringify({ scenario, seed, steps, choice, status: result.status }),
      );
      state = result.state;
      const v = project(state, 'protagonists'),
        suffix = v.observations.slice(solver.through);
      const beforeAudit =
        process.argv[6] === 'audit'
          ? { rules: m.graph.rules.length, values: new Map(m.graph.values) }
          : undefined;
      solver.append(suffix, v.characters);
      const failed = suffix.find(
        (o) =>
          o.phase === 'loop-end' && o.type === 'failure' && o.data.result === 'protagonist-failure',
      );
      const alternate = setup.alternateY;
      if (
        failed &&
        alternate &&
        previous.flags['alternate-y'] === alternate &&
        !suffix.some(
          (o) => o.sequence < failed.sequence && ['character', 'board'].includes(o.type),
        ) &&
        state.audit.slice(previous.audit.length).some((entry) => {
          const data = entry.data as { source?: string; ability?: string };
          return (
            entry.kind === 'source-completed' &&
            data.ability === 'loss' &&
            data.source === pack.plots[alternate]?.source
          );
        })
      ) {
        const cards = Object.values(previous.characters),
          alive = cards.filter((c) => c.status === 'alive');
        const conditions: Record<string, boolean | undefined> = {
          达贡的福音书: previous.boards.shrine >= previous.ex,
          染血的仪式: cards.filter((c) => c.status === 'dead').length >= previous.ex,
          黄衣之王: Boolean(previous.flags['ex-increased']),
          外神合唱曲:
            alive.filter((c) => c.counters.intrigue + c.counters.despair - c.counters.hope >= 1)
              .length >= 5,
        };
        if (conditions[alternate] === false) {
          knownDivergence = {
            record: failed.sequence,
            kind: 'inactive-alternate-loss',
            alternate,
            ex: previous.ex,
            shrine: previous.boards.shrine,
          };
          break;
        }
      }
      if (process.argv[6] === 'audit' && !solver.conflict && !admits(m.graph, facts)) {
        if (!admits(m.graph, facts, beforeAudit)) {
          beforeAudit!.rules = 0;
          beforeAudit!.values.clear();
        }
        let lo = beforeAudit!.rules,
          hi = m.graph.rules.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (admits(m.graph, facts, { rules: mid + 1, values: beforeAudit!.values })) lo = mid + 1;
          else hi = mid;
        }
        const r = m.graph.rules[lo];
        throw Error(
          JSON.stringify({
            scenario,
            seed,
            steps,
            through: solver.through,
            setup,
            firstImpossible: r && {
              reason: r.reason,
              terms: r.terms.map((t) => [t, m.graph.names[Math.abs(t)]]),
              guard: r.guard && m.graph.names[Math.abs(r.guard)],
              bound: [r.min, r.max],
            },
            reports: suffix,
            added: m.graph.rules
              .filter(
                (r) =>
                  r.reason.startsWith('#') &&
                  Number(/^#(\d+)/.exec(r.reason)?.[1]) >= (suffix[0]?.sequence ?? 0),
              )
              .map((r) => r.reason)
              .filter((v, i, a) => a.indexOf(v) === i),
          }),
        );
      }
      const denied = facts.find((a) => m.graph.truth(a) === false);
      if (!denied && setup.module === 'HSA' && solver.conflict?.includes('本牌一个放置来源')) {
        const record = suffix.find(
          (o) =>
            o.sequence === solver.through &&
            o.phase === 'loop-start' &&
            o.type === 'board' &&
            Array.isArray(o.data.curses) &&
            o.data.curses.some((c) => c.target === 'far'),
        );
        if (record) {
          knownDivergence = { record: record.sequence, kind: 'curse-without-board', target: 'far' };
          break;
        }
      }
      if (setup.module === 'HSA' && solver.conflict?.includes('日事件效果')) {
        const end = v.observations.find((o) => o.sequence === solver.through);
        const incident = setup.incidents.find((i) => i.day === end?.day && i.name === '孤守');
        if (
          incident &&
          setup.characters.find((c) => c.id === incident.culprit)?.character === '黑猫'
        ) {
          const record = v.observations.find(
            (o) =>
              o.phase === 'incident' &&
              o.loop === end?.loop &&
              o.day === end.day &&
              o.type === 'character' &&
              o.sequence < solver.through &&
              typeof o.data.area === 'string' &&
              o.data.area !==
                (v.observations
                  .slice(0, o.sequence - 1)
                  .reverse()
                  .find((p) => p.type === 'character' && p.data.character === o.data.character)
                  ?.data.area ??
                  solver.opening.characters.find((c) => c.id === o.data.character)?.area ??
                  o.data.area),
          );
          if (record) {
            knownDivergence = {
              record: record.sequence,
              kind: 'cat-isolation-movement',
              moved: String(record.data.character),
            };
            break;
          }
        }
      }
      if (solver.conflict?.includes('日事件效果')) {
        const record = v.observations.find((o) => o.sequence === solver.through);
        const incident = setup.incidents.find(
          (i) => i.day === record?.day && ['失踪', '阴谋活动'].includes(i.name),
        );
        const card = setup.characters.find((c) => c.character === '仙人');
        const sameWindow = v.observations.filter(
          (o) =>
            o.loop === record?.loop &&
            o.day === record?.day &&
            o.phase === 'incident' &&
            o.sequence < solver.through,
        );
        const moved = sameWindow.filter(
          (o) => o.type === 'character' && o.data.character === card?.id,
        );
        const additions = sameWindow.filter(
          (o) => o.type === 'board' && typeof o.data.intrigue === 'number',
        );
        const physical = String(moved[0]?.data.area),
          board = String(additions[0]?.data.board);
        const clockwise: Record<string, string> = {
          hospital: 'shrine',
          shrine: 'school',
          school: 'city',
          city: 'hospital',
        };
        const prior = v.observations
          .filter(
            (o) =>
              o.sequence < (moved[0]?.sequence ?? 0) &&
              o.type === 'character' &&
              o.data.character === card?.id &&
              typeof o.data.area === 'string',
          )
          .at(-1);
        const origin = String(prior?.data.area ?? card?.initialArea);
        if (
          card &&
          (board === origin || board === clockwise[origin]) &&
          incident?.culprit === card.id &&
          moved.length === 1 &&
          additions.length === 1 &&
          additions[0]!.sequence > moved[0]!.sequence &&
          board !== physical &&
          board !== clockwise[physical]
        ) {
          knownDivergence = {
            record: additions[0]!.sequence,
            kind: 'stale-incident-area',
            physical,
            board,
          };
          break;
        }
      }
      if (!denied && solver.conflict?.includes('缺少公开结果')) {
        const prior = v.observations.slice(0, solver.through - 1);
        const declaration = prior
          .slice()
          .reverse()
          .find((o) => o.type === 'declaration');
        const selected = Number((declaration?.data.choices as Record<string, unknown>)?.day);
        if (
          declaration &&
          ['detective-incident', 'divinity-incident'].includes(String(declaration.data.ability)) &&
          solver.conflict.includes(String(declaration.data.ability)) &&
          selected !== declaration.day &&
          setup.incidents.some((i) => i.day === selected) &&
          !prior.some(
            (o) =>
              o.sequence > declaration.sequence && o.type === 'culprit' && o.data.day === selected,
          )
        ) {
          knownDivergence = {
            record: solver.through,
            ability: declaration.data.ability,
            selected,
            current: declaration.day,
          };
          break;
        }
      }
      assert(
        !denied && !solver.conflict,
        JSON.stringify({
          scenario,
          seed,
          steps,
          through: solver.through,
          conflict: solver.conflict,
          denied: denied && m.graph.names[denied],
          why: denied && m.graph.reasons(denied),
          substitutions,
          setup,
          loopEnd: solver.conflict?.includes('loop-end')
            ? {
                ex: previous.ex,
                boards: previous.boards,
                flags: previous.flags,
                actions: state.audit.slice(previous.audit.length),
                exChanges: v.observations
                  .filter((o) => o.type === 'board' && typeof o.data.ex === 'number')
                  .map((o) => [o.sequence, o.loop, o.day, o.data.ex]),
                previousLoop: previous.previousLoop?.ex,
                pieces: Object.values(previous.characters).map((c) => [
                  c.character,
                  c.identity,
                  c.status,
                  c.area,
                ]),
              }
            : undefined,
          recent: v.observations.slice(-20),
          suffix,
        }),
      );
      assert(++steps <= 3000, '未能完成 ' + scenario + ' seed ' + seed);
    }
    console.log(
      JSON.stringify({
        scenario,
        seed,
        steps,
        through: solver.through,
        ...(process.argv[6] === 'audit' && { jointAudited: true }),
        ...(process.argv[5] === 'mixed' && { substitutions }),
        ...(process.argv[5] === 'varied' && {
          substitutions,
          plots: [setup.y, ...setup.x],
          events: setup.incidents.map((i) => i.name),
        }),
        status: knownDivergence ? 'forward-divergence' : state.phase,
        knownDivergence,
      }),
    );
  }
