import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import type { Module, Phase, CardKind, Area } from '../../packages/contracts/src/game.js';
import { solveAbsence } from '../../packages/engine/src/absence/solve.js';
import {
  verifyAbsenceHistory,
  type PhaseEvidence,
  type OutcomeRule,
} from '../../packages/engine/src/absence/phase-search.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { lab, character, type Lab } from '../comprehensive/harness.js';

let matrices = 0,
  assignments = 0;
after(() => console.log(`independentMatrices=${matrices} candidateComparisons=${assignments}`));
const civilian = '平民',
  killer = '杀人狂',
  traveler = '时间旅者';
const roles = [civilian, killer, traveler];
function position(module: Module, phase: Phase) {
  const l = lab(module);
  Object.assign(l.state, { phase, phaseEntered: false, pending: null });
  return l;
}
const clock = (phase: Phase, day = 1, loop = 1) => ({ phase, day, loop });
function stage(
  start: PhaseEvidence['start'],
  end: PhaseEvidence['end'],
  ...rules: OutcomeRule[]
): PhaseEvidence {
  return { start, end, rules, absent: [], coverage: 'complete' };
}
const figure = (character: string, status: 'dead' | 'alive', guard: number): OutcomeRule => ({
  kind: 'character',
  character,
  status,
  counters: { guard },
});
const report = (
  type: Extract<OutcomeRule, { kind: 'report' }>['type'],
  count: number,
  fields?: Record<string, unknown>,
): OutcomeRule => ({ kind: 'report', type, min: count, max: count, fields });
const incident = (name: string, occurred: boolean): OutcomeRule => ({
  kind: 'incident',
  name,
  occurred,
});
const completed = (
  character: string,
  ability: string,
  choices?: Record<string, string>,
): OutcomeRule => ({ kind: 'ability-completed', character, ability, choices });

// The oracle has no access to a RulePack, interpreter, replay or solver. Compare the entire
// cartesian candidate set, including rows removed before worlds() and spurious survivors.
function compare(
  l: Lab,
  aRoles: string[],
  bRoles: string[],
  stages: PhaseEvidence[],
  expect: (a: string, b: string) => boolean,
  note: string,
  absence: ('a' | 'b')[] = [],
) {
  matrices++;
  assignments += aRoles.length * bRoles.length;
  const domains = Object.fromEntries(
    Object.values(l.state.characters).map((c) => [c.id, [c.identity]]),
  );
  domains.a = aRoles;
  domains.b = bRoles;
  const entry = { ...l.state, ...l.state.setup, characters: Object.values(l.state.characters) };
  const rows = [
    ...solveAbsence(
      l.pack,
      {
        entry,
        timing: { kind: l.state.phase },
        coverage: 'complete',
        absent: absence.map((character) => ({ phenomenon: 'death', character })),
      },
      domains,
      {
        evidence: stages[0]!,
        following: stages.slice(1),
        workPerRow: 2000,
        worlds(ids) {
          const s = clone(l.state);
          for (const [id, role] of Object.entries(ids)) {
            s.characters[id]!.identity = s.characters[id]!.initialIdentity = role;
            s.setup.characters.find((c) => c.id === id)!.identity = role;
          }
          return { exhaustive: true, states: [s] };
        },
      },
    ),
  ];
  assert.ok(
    rows.every((r) => r.status !== 'unknown'),
    note + ' budget or unsupported rule',
  );
  const expected = aRoles
    .flatMap((a) => bRoles.filter((b) => expect(a, b)).map((b) => a + '/' + b))
    .sort();
  const actual = rows
    .filter((r) => r.status === 'possible')
    .map((r) => r.identities.a + '/' + r.identities.b)
    .sort();
  assert.deepEqual(actual, expected, note);
}

test('同时杀人狂、从者代死、不死和逐次消费守护：每个终盘的全部身份解', () => {
  for (const servant of [false, true])
    for (const ga of [0, 1, 2])
      for (const gb of [0, 1, 2]) {
        const l = position('BTX', 'day-end');
        character(l, 'a', servant ? '从者' : '男学生', civilian, 'school').counters.guard = ga;
        character(l, 'b', servant ? '大小姐' : '女学生', civilian, 'school').counters.guard = gb;
        // Each killer makes one request simultaneously. An immortal recipient discards its
        // request; an unguarded lady redirects her surviving request onto the servant.
        function outcome(a: string, b: string) {
          const bHits = Number(a === killer && b !== traveler);
          const aHits =
            a === traveler ? 0 : Number(b === killer) + (servant ? Math.max(0, bHits - gb) : 0);
          return {
            aliveA: aHits <= ga,
            guardA: Math.max(0, ga - aHits),
            aliveB: servant || bHits <= gb,
            guardB: Math.max(0, gb - bHits),
          };
        }
        const signatures = new Set(
          roles.flatMap((a) => roles.map((b) => JSON.stringify(outcome(a, b)))),
        );
        for (const signature of signatures) {
          const o = JSON.parse(signature) as ReturnType<typeof outcome>;
          const absent: ('a' | 'b')[] = [];
          if (o.aliveA) absent.push('a');
          if (o.aliveB) absent.push('b');
          compare(
            l,
            roles,
            roles,
            [
              stage(
                clock('day-end'),
                clock('day-start', 2),
                figure('a', o.aliveA ? 'alive' : 'dead', o.guardA),
                figure('b', o.aliveB ? 'alive' : 'dead', o.guardB),
              ),
            ],
            (a, b) => JSON.stringify(outcome(a, b)) === signature,
            [servant, ga, gb, signature].join('/'),
            absent,
          );
        }
      }
});

test('事件门槛、手下、同区预言家与初始版图密谋：无事件、无现象和主人公死亡', () => {
  for (const same of [false, true])
    for (const high of [false, true])
      for (const disabled of [false, true])
        for (const intrigue of [0, 1, 2, 3]) {
          const l = position('MZ', 'incident');
          const a = character(l, 'a', '手下', civilian, 'school');
          character(l, 'b', '女学生', civilian, same ? 'school' : 'city');
          a.counters.paranoia = high ? a.paranoiaLimit : 0;
          if (disabled) a.flags['no-incidents'] = 'yes';
          l.state.setup.incidents = [
            { day: 1, name: '伪造事件', publicName: '来信', culprit: 'a' },
          ];
          l.state.boards.school = intrigue;
          for (const [occurs, dies] of [
            [false, false],
            [true, false],
            [true, true],
          ] as const) {
            compare(
              l,
              [civilian, '强迫症'],
              [civilian, '预言家'],
              [
                stage(
                  clock('incident'),
                  clock(dies ? 'loop-end' : 'captain-change'),
                  incident('来信', occurs),
                  report('failure', +dies),
                  report('no-effect', Number(occurs && !dies)),
                ),
              ],
              (a, b) => {
                const trigger = !disabled && !(same && b === '预言家') && (high || a === '强迫症');
                return trigger === occurs && (trigger && intrigue >= 2) === dies;
              },
              [same, high, disabled, intrigue, occurs, dies].join('/'),
            );
          }
        }
});

test('异界人已正常结算：免死保留守护，普通目标消耗守护，未达到门槛或拒绝不能充当完成', () => {
  for (const goodwill of [3, 4])
    for (const guard of [0, 1, 2])
      for (const despair of [0, 1]) {
        const l = position('BTX', 'protagonist-abilities');
        const a = character(l, 'a', '异界人', civilian, 'school');
        a.counters.goodwill = goodwill;
        a.counters.despair = despair;
        character(l, 'b', '女学生', civilian, 'school').counters.guard = guard;
        const e = stage(
          clock('protagonist-abilities'),
          clock('incident'),
          completed('a', 'alien-kill', { target: 'b' }),
          figure('b', 'alive', guard),
        );
        // A recorded command avoids the legal ability refusal/retry cycle in the negative cases.
        e.decisions = [
          {
            actor: 'p0',
            choice: {
              kind: 'ability',
              owner: 'a',
              ability: 'alien-kill',
              choices: { target: 'b' },
            },
          },
        ];
        compare(
          l,
          [civilian],
          roles,
          [e],
          (_, b) => goodwill >= 4 && despair === 0 && b === traveler,
          'alien/' + [goodwill, guard, despair],
        );
      }
});

test('巫女移除版图密谋，职员公开身份，鉴别员在两名空目标间转移', () => {
  for (const before of [0, 1, 2, 3])
    for (const after of [0, 1, 2, 3]) {
      const l = position('BTX', 'protagonist-abilities');
      character(l, 'a', '巫女', civilian, 'shrine').counters.goodwill = 3;
      l.state.boards.shrine = before;
      compare(
        l,
        [civilian],
        [civilian],
        [
          stage(
            clock('protagonist-abilities'),
            clock('incident'),
            completed('a', 'shrine-maiden-remove'),
            { kind: 'board', board: 'shrine', intrigue: after },
          ),
        ],
        () => after === Math.max(0, before - 1),
        'miko/' + [before, after],
      );
    }
  const l = position('MZ', 'protagonist-abilities');
  character(l, 'a', '职员', civilian, 'school').counters.goodwill = 3;
  character(l, 'b', '鉴别员', civilian, 'school').counters.goodwill = 2;
  character(l, 'c', '男学生', civilian, 'school');
  character(l, 'd', '女学生', civilian, 'school');
  for (const count of [0, 1, 2]) {
    const e = stage(
      clock('protagonist-abilities'),
      clock('incident'),
      completed('a', 'office-worker'),
      completed('b', 'forensic-transfer', { from: 'c', to: 'd' }),
      report('identity', count, { character: 'a' }),
      report('character', 0),
    );
    compare(l, [civilian], [civilian], [e], () => count === 1, 'confirmed announcements/' + count);
  }
});

function place(l: Lab, target: string, kinds: CardKind[]) {
  l.state.placements = kinds.map((kind, i) => {
    const card = l.state.cards.find((c) => c.kind === kind && c.status === 'hand');
    assert.ok(card, 'missing ' + kind + '/' + i);
    card.status = 'set';
    return { card: card.id, target };
  });
}
test('行动卡、角色禁止区域和副线附加效果合并后的位置和友好', () => {
  for (const module of ['MZ', 'BTX'] as const)
    for (const movement of ['horizontal', 'vertical'] as const)
      for (const block of [false, true])
        for (const dual of [false, true]) {
          const l = position(module, 'card-resolution');
          const a = character(l, 'a', '巫女', civilian, 'shrine');
          if (module === 'MZ') l.state.setup.x = ['心无灵犀'];
          place(l, 'a', [
            movement,
            ...(dual
              ? [movement === 'vertical' ? ('horizontal' as const) : ('vertical' as const)]
              : []),
            'goodwill+1',
            ...(block ? ['block-goodwill' as const] : []),
          ]);
          for (const endArea of ['hospital', 'school', 'shrine'] as const)
            for (const endGood of [0, 1]) {
              const unblocked: Area = dual
                ? 'shrine'
                : movement === 'horizontal'
                  ? 'hospital'
                  : 'school';
              compare(
                l,
                module === 'BTX' ? [civilian, traveler] : [civilian],
                [civilian],
                [
                  stage(clock('card-resolution'), clock('mastermind-abilities'), {
                    kind: 'character',
                    character: a.id,
                    area: endArea,
                    counters: { goodwill: endGood },
                  }),
                ],
                (role) =>
                  endArea === (module === 'MZ' && block ? 'shrine' : unblocked) &&
                  endGood === Number(!block || role === traveler),
                'cards/' + [module, movement, dual, block, endArea, endGood],
              );
            }
        }
});

test('遗言导致该轮失败、下轮发卡；同一角色的因果残片与遗言只发一份', () => {
  for (const goodwill of [0, 1, 2])
    for (const threshold of [false, true])
      for (const count of [0, 1, 2]) {
        const l = position('AHR', 'incident');
        l.state.setup.days = 1;
        l.state.setup.y = '次元融合计划';
        const a = character(l, 'a', '男学生', civilian, 'school');
        character(l, 'b', '女学生', civilian, 'school').counters.goodwill = goodwill;
        a.counters.paranoia = threshold ? a.paranoiaLimit : 0;
        l.state.setup.incidents = [{ day: 1, name: '遗言', culprit: 'a' }];
        const stages = [
          stage(clock('incident'), clock('captain-change'), incident('遗言', true)),
          stage(clock('captain-change'), clock('day-end')),
          stage(clock('day-end'), clock('loop-end')),
          stage(clock('loop-end'), clock('discussion', 1, 2)),
          stage(clock('discussion', 1, 2), clock('loop-start', 1, 2)),
          stage(
            clock('loop-start', 1, 2),
            clock('day-start', 1, 2),
            ...['p0', 'p1', 'p2'].map((owner) =>
              report('card-grant', count, { kind: 'hope+1', owner }),
            ),
          ),
        ];
        stages[4]!.decisions = [{ actor: 'p1', choice: { kind: 'continue' } }];
        compare(
          l,
          [civilian, '强迫症'],
          [civilian, '因果残片'],
          stages,
          (a) => (a === '强迫症' || threshold) && count === 1,
          'last will/' + [goodwill, threshold, count],
        );
      }
});
test('可疑信件的实际移动决定次日行动卡：相同翻牌，连续历史不能拼接两条分支', () => {
  for (const moved of [false, true])
    for (const endArea of ['city', 'school', 'hospital'] as Area[]) {
      const l = position('MC', 'incident');
      const a = character(l, 'a', '男学生', civilian, 'school');
      a.counters.paranoia = a.paranoiaLimit;
      character(l, 'b', '女学生', civilian, 'school');
      l.state.setup.incidents = [{ day: 1, name: '可疑信件', culprit: 'a' }];
      const area = moved ? 'hospital' : 'school';
      const stages = [
        stage(
          clock('incident'),
          clock('captain-change'),
          incident('可疑信件', true),
          { kind: 'character', character: 'b', area },
          { kind: 'ex', value: 1 },
        ),
        stage(clock('captain-change'), clock('day-end')),
        stage(clock('day-end'), clock('day-start', 2)),
        stage(clock('day-start', 2), clock('mastermind-cards', 2)),
        stage(clock('mastermind-cards', 2), clock('protagonist-cards', 2)),
        stage(clock('protagonist-cards', 2), clock('card-resolution', 2)),
        stage(
          clock('card-resolution', 2),
          clock('mastermind-abilities', 2),
          {
            kind: 'cards',
            placements: [
              { owner: 'mastermind', kind: 'horizontal', target: 'b' },
              { owner: 'mastermind', kind: 'vertical', target: 'city' },
              { owner: 'mastermind', kind: 'block-goodwill', target: 'hospital' },
              { owner: 'p0', kind: 'block-intrigue', target: 'city' },
              { owner: 'p1', kind: 'block-intrigue', target: 'school' },
              { owner: 'p2', kind: 'block-intrigue', target: 'shrine' },
            ],
          },
          { kind: 'character', character: 'b', area: endArea },
        ),
      ];
      stages[0]!.decisions = [
        { actor: 'mastermind', choice: { kind: 'select', value: 'b' } },
        { actor: 'mastermind', choice: { kind: 'select', value: area } },
      ];
      compare(
        l,
        [civilian],
        [civilian],
        stages,
        () => endArea === (moved ? 'hospital' : 'city'),
        'suspicious letter/' + [moved, endArea],
      );
    }
});

test('疯狂之夜在事件发生时计数，延迟至日末；六具丧尸、古墓版图尸体和主人公保护', () => {
  for (const n of [4, 5, 6])
    for (const corpse of [false, true])
      for (const protectedHero of [false, true])
        for (const dies of [false, true]) {
          const l = position('HSA', 'incident');
          if (corpse) {
            l.state.setup.y = '古墓活尸';
            l.state.boards.hospital = 1;
          }
          for (let i = 0; i < n; i++)
            character(l, 'z' + i, '男学生', '丧尸', 'hospital').status = 'dead';
          l.state.protected = protectedHero;
          l.state.setup.incidents = [{ day: 1, name: '疯狂之夜', culprit: 'hospital' }];
          // Keep the hospital deserted so the other day-end zombie-majority effect has no victim.
          l.state.characters.c!.area = 'school';
          compare(
            l,
            [civilian],
            [civilian],
            [
              stage(
                clock('incident'),
                clock('captain-change'),
                incident('疯狂之夜', true),
                report('failure', 0),
              ),
              stage(clock('captain-change'), clock('day-end')),
              stage(
                clock('day-end'),
                dies ? clock('loop-end') : clock('day-start', 2),
                report('failure', Number(dies)),
              ),
            ],
            () => dies === (!protectedHero && n + Number(corpse) >= 6),
            'mad night/' + [n, corpse, protectedHero, dies],
          );
        }
});

test('AHR 刑警为提线木偶时，同一次友好结算加守护再耗守护，日末按世界移动升一次 EX', () => {
  for (const puppet of [false, true])
    for (const guard of [0, 1])
      for (const ex of [0, 1, 2]) {
        const l = position('AHR', 'protagonist-abilities');
        character(l, 'a', '刑警', civilian, 'school').counters.goodwill = 5;
        const start = stage(
          clock('protagonist-abilities'),
          clock('incident'),
          completed('a', 'detective-guard', { target: 'a' }),
          figure('a', 'alive', guard),
          { kind: 'ex', value: 0 },
        );
        start.decisions = [
          {
            actor: 'p0',
            choice: {
              kind: 'ability',
              owner: 'a',
              ability: 'detective-guard',
              choices: { target: 'a' },
            },
          },
        ];
        if (puppet)
          start.decisions = [
            ...start.decisions,
            { actor: 'mastermind', choice: { kind: 'refuse', refuse: false } },
          ];
        compare(
          l,
          [civilian, '提线木偶'],
          [civilian],
          [
            start,
            stage(clock('incident'), clock('captain-change')),
            stage(clock('captain-change'), clock('day-end')),
            stage(clock('day-end'), clock('day-start', 2), { kind: 'ex', value: ex }),
          ],
          (a) => ex === 1 && (a === '提线木偶') === puppet && guard === Number(a === civilian),
          'puppet/' + [guard, ex],
        );
      }
});

test('医院事故、黑猫、AI的指示物门槛、亵渎杀人独处和 AI 调用灭绝之火', () => {
  for (const cat of [false, true])
    for (const intrigue of [0, 1, 2])
      for (const died of [false, true]) {
        const l = position('BTX', 'incident');
        const a = character(l, 'a', cat ? '黑猫' : 'AI', civilian, 'shrine');
        a.counters.goodwill = a.paranoiaLimit;
        if (cat) a.counters.paranoia = a.paranoiaLimit;
        character(l, 'b', '女学生', civilian, 'hospital');
        l.state.characters.c!.area = 'school';
        l.state.boards.hospital = intrigue;
        l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'a' }];
        const heroDies = !cat && intrigue >= 2;
        compare(
          l,
          [civilian],
          [civilian, traveler],
          [
            stage(
              clock('incident'),
              clock(heroDies ? 'loop-end' : 'captain-change'),
              incident('医院事故', true),
              figure('b', died ? 'dead' : 'alive', 0),
              report('no-effect', Number(!died && !heroDies)),
            ),
          ],
          (_, b) => died === (!cat && intrigue > 0 && b !== traveler),
          'hospital/' + [cat, intrigue, died],
        );
      }
  const h = position('HSA', 'incident');
  const a = character(h, 'a', '男学生', civilian, 'city');
  a.counters.paranoia = a.paranoiaLimit;
  h.state.setup.incidents = [{ day: 1, name: '亵渎杀人', culprit: 'a' }];
  for (const n of [0, 1])
    compare(
      h,
      [civilian],
      [civilian],
      [
        stage(clock('incident'), clock('captain-change'), incident('亵渎杀人', true), {
          kind: 'board',
          board: 'city',
          intrigue: n,
        }),
      ],
      () => n === 1,
      'blasphemy/' + n,
    );
  const ai = position('WM', 'protagonist-abilities');
  const robot = character(ai, 'a', 'AI', civilian, 'city');
  robot.counters.goodwill = 5;
  ai.state.setup.incidents = [{ day: 2, culprit: 'a', name: '灭绝之火' }];
  const ability = ai.pack.characters['AI']!.abilities.find((a) =>
    a.steps.some((step) => step.effects.some((e) => e.op === 'invoke-incident')),
  )!.id;
  for (const n of [0, 1])
    compare(
      ai,
      [civilian],
      [civilian],
      [
        stage(
          clock('protagonist-abilities'),
          clock('incident'),
          completed('a', ability),
          report('incident', n),
          report('character', 0),
          report('no-effect', 0),
          report('failure', 0),
        ),
      ],
      () => n === 0,
      'AI invocation/' + n,
    );
});

test('跨轮回快照取重置前的友好、希望和 EX', () => {
  for (const module of ['BTX', 'MC'] as const)
    for (const value of [0, 1, 2, 3])
      for (const observed of [0, 1, 2]) {
        const l = position(module, 'loop-end');
        l.state.failed = true;
        l.state.setup.x = [module === 'BTX' ? '因果线' : '隔离病房惊魂记'];
        l.state.ex = value;
        l.state.characters.b!.counters[value % 2 ? 'hope' : 'goodwill'] = value;
        const discussion = stage(clock('discussion', 1, 2), clock('loop-start', 1, 2));
        discussion.decisions = [{ actor: 'p0', choice: { kind: 'continue' } }];
        compare(
          l,
          [civilian],
          [civilian],
          [
            stage(clock('loop-end'), clock('discussion', 1, 2)),
            discussion,
            stage(
              clock('loop-start', 1, 2),
              clock('day-start', 1, 2),
              module === 'BTX'
                ? {
                    kind: 'character',
                    character: 'b',
                    counters: { paranoia: observed, goodwill: 0, hope: 0 },
                  }
                : { kind: 'ex', value: observed },
            ),
          ],
          () => observed === (module === 'BTX' ? (value > 0 ? 2 : 0) : Number(value <= 2)),
          'loop snapshot/' + [module, value, observed],
        );
      }
});
test('密钥公开的轮次、最终日提早结算和次日剧作家张数', () => {
  for (const loop of [1, 2, 3])
    for (const last of [false, true])
      for (const dies of [false, true]) {
        const l = position('LL', 'incident');
        l.state.loop = loop;
        l.state.setup.days = last ? 1 : 3;
        const a = character(l, 'a', '男学生', civilian, 'school');
        a.counters.paranoia = a.paranoiaLimit;
        l.state.setup.incidents = [{ day: 1, name: '自白', culprit: 'a' }];
        const c = (p: Phase, d = 1) => clock(p, d, loop);
        const stages = [
          stage(
            c('incident'),
            c('captain-change'),
            incident('自白', true),
            report('identity', 1, { character: 'a' }),
          ),
          stage(c('captain-change'), c('day-end')),
        ];
        if (last) stages.push(stage(c('day-end'), c('loop-end'), report('failure', Number(dies))));
        else {
          stages.push(
            stage(c('day-end'), c('day-start', 2), report('failure', 0)),
            stage(c('day-start', 2), c('mastermind-cards', 2)),
            stage(c('mastermind-cards', 2), c('protagonist-cards', 2)),
            stage(c('protagonist-cards', 2), c('card-resolution', 2)),
            stage(c('card-resolution', 2), c('mastermind-abilities', 2), {
              kind: 'cards',
              placements: [
                { owner: 'mastermind', kind: 'horizontal', target: 'city' },
                ...(!dies
                  ? [
                      { owner: 'mastermind' as const, kind: 'vertical' as const, target: 'school' },
                      {
                        owner: 'mastermind' as const,
                        kind: 'block-goodwill' as const,
                        target: 'hospital',
                      },
                    ]
                  : []),
                ...(['p0', 'p1', 'p2'] as const).map((owner, i) => ({
                  owner,
                  kind: 'block-intrigue' as const,
                  target: ['city', 'school', 'shrine'][i]!,
                })),
              ],
            }),
            stage(c('mastermind-abilities', 2), c('protagonist-abilities', 2)),
            stage(c('protagonist-abilities', 2), c('incident', 2)),
            stage(c('incident', 2), c('captain-change', 2)),
            stage(c('captain-change', 2), c('day-end', 2)),
            stage(
              c('day-end', 2),
              dies ? c('loop-end', 2) : c('day-start', 3),
              report('failure', Number(dies)),
            ),
          );
        }
        compare(
          l,
          [civilian, '密钥'],
          [civilian],
          stages,
          (a) => dies === (a === '密钥' && loop <= 2),
          'key/' + [loop, last, dies],
        );
      }
});

test('AHR 剧作家使用傀儡友好能力必须公开角色和目标，不能省略公告', () => {
  const l = position('AHR', 'mastermind-abilities');
  character(l, 'a', '刑警', civilian, 'school').counters.goodwill = 5;
  for (const n of [0, 1]) {
    const e = stage(
      clock('mastermind-abilities'),
      clock('protagonist-abilities'),
      completed('a', 'detective-guard', { target: 'a' }),
      report('declaration', n, {
        character: 'a',
        ability: 'detective-guard',
        choices: { target: 'a' },
      }),
    );
    e.decisions = [
      {
        actor: 'mastermind',
        choice: {
          kind: 'ability',
          owner: 'a',
          ability: 'detective-guard',
          choices: { target: 'a' },
        },
      },
    ];
    compare(
      l,
      [civilian, '提线木偶'],
      [civilian],
      [e],
      (a) => n === 1 && a === '提线木偶',
      'puppet announcement/' + n,
    );
  }
});

test('忍者可以选择公开身份，已结算的职员能力总会发出一次公告', () => {
  const l = position('MZ', 'protagonist-abilities');
  character(l, 'a', '职员', civilian, 'school').counters.goodwill = 3;
  character(l, 'b', '男学生', '杀人狂', 'school');
  for (const n of [0, 1]) {
    const e = stage(
      clock('protagonist-abilities'),
      clock('incident'),
      completed('a', 'office-worker'),
      report('identity', 1, { character: 'a' }),
      report('identity', n, { character: 'a', identity: '杀人狂' }),
    );
    compare(l, [civilian, '忍者'], ['杀人狂'], [e], (a) => n === 0 || a === '忍者', 'ninja/' + n);
  }
});
test('完整日末的缺席还约束常驻临时工和延迟效果，覆盖不完整时保留候选', () => {
  const l = position('BTX', 'day-end');
  character(l, 'a', '临时工', civilian, 'city').counters.paranoia = 3;
  const entry = { ...l.state, ...l.state.setup, characters: Object.values(l.state.characters) };
  const domains = Object.fromEntries(entry.characters.map((c) => [c.id, [c.identity]]));
  const e = stage(clock('day-end'), clock('day-start', 2));
  function result(exhaustive: boolean, coverage: PhaseEvidence['coverage']) {
    return [
      ...solveAbsence(
        l.pack,
        {
          entry,
          timing: { kind: 'day-end' },
          coverage: 'complete',
          extent: 'phase',
          absent: [{ phenomenon: 'death', character: 'a' }],
        },
        domains,
        {
          evidence: { ...e, coverage },
          workPerRow: 100,
          worlds: () => ({ exhaustive, states: [l.state] }),
        },
      ),
    ][0]!.status;
  }
  assert.equal(result(true, 'complete'), 'excluded');
  assert.equal(result(false, 'complete'), 'unknown');
  assert.equal(result(true, 'partial'), 'unknown');
  l.state.characters.a!.counters.guard = 1;
  assert.equal(result(true, 'complete'), 'possible');
});
test('完整翻牌剪枝与未加提示的穷举逐项同解，并减少实际搜索次数', (ctx) => {
  const l = position('BTX', 'protagonist-cards');
  for (const [owner, target] of [
    ['p0', 'hospital'],
    ['p1', 'shrine'],
  ] as const) {
    const card = l.state.cards.find((c) => c.owner === owner && c.kind === 'block-intrigue')!;
    card.status = 'set';
    l.state.placements.push({ card: card.id, target });
  }
  const start = stage(clock('protagonist-cards'), clock('card-resolution'));
  let plainWork = 0,
    hintedWork = 0;
  for (const kind of ['horizontal', 'vertical', 'goodwill+1'] as const)
    for (const area of ['city', 'shrine', 'school'] as const) {
      const placements = [
        { owner: 'p0' as const, target: 'hospital', kind: 'block-intrigue' as const },
        { owner: 'p1' as const, target: 'shrine', kind: 'block-intrigue' as const },
        { owner: 'p2' as const, target: 'b', kind },
      ];
      const end = stage(clock('card-resolution'), clock('mastermind-abilities'), {
        kind: 'character',
        character: 'b',
        area,
      });
      const plain = verifyAbsenceHistory(
        l.pack,
        l.state,
        [start, { ...end, rules: [...end.rules!, report('cards', 1, { placements })] }],
        4000,
      );
      const hinted = verifyAbsenceHistory(
        l.pack,
        l.state,
        [
          start,
          {
            ...end,
            rules: [...end.rules!, { kind: 'cards', placements: [...placements].reverse() }],
          },
        ],
        4000,
      );
      assert.equal(
        plain.status,
        area === (kind === 'horizontal' ? 'city' : kind === 'vertical' ? 'shrine' : 'school')
          ? 'possible'
          : 'excluded',
      );
      assert.equal(hinted.status, plain.status);
      plainWork += plain.work;
      hintedWork += hinted.work;
    }
  assert.ok(hintedWork < plainWork);
  ctx.diagnostic('finite card search work: exhaustive=' + plainWork + ', reveal=' + hintedWork);
});
test('MZ 自白已公开身份后无静默公告；MC 黑猫仍触发模组 EX', () => {
  const m = position('MZ', 'incident');
  m.state.characters.a!.counters.paranoia = m.state.characters.a!.paranoiaLimit;
  m.state.setup.incidents = [{ day: 1, culprit: 'a', name: '自白' }];
  for (const n of [0, 1])
    compare(
      m,
      [civilian, '强迫症'],
      [civilian],
      [
        stage(
          clock('incident'),
          clock('captain-change'),
          incident('自白', true),
          report('identity', 1, { character: 'a' }),
          report('no-effect', n),
        ),
      ],
      () => n === 0,
      'confession/' + n,
    );
  const mc = position('MC', 'incident');
  const cat = character(mc, 'a', '黑猫', civilian, 'shrine');
  cat.counters.paranoia = cat.paranoiaLimit;
  mc.state.setup.incidents = [{ day: 1, culprit: 'a', name: '医院事故' }];
  mc.state.boards.hospital = 2;
  compare(
    mc,
    [civilian],
    [civilian],
    [
      stage(
        clock('incident'),
        clock('captain-change'),
        incident('医院事故', true),
        report('no-effect', 1),
        { kind: 'ex', value: 1 },
        report('failure', 0),
      ),
    ],
    () => true,
    'MC black cat',
  );
});

test('补全必须符合入口公开盘面，不能借用假守护解释实际无人死亡', () => {
  const l = position('BTX', 'day-end');
  character(l, 'a', '男学生', killer, 'school');
  character(l, 'b', '女学生', civilian, 'school');
  const entry = { ...l.state, ...l.state.setup, characters: Object.values(l.state.characters) };
  const domains = Object.fromEntries(entry.characters.map((c) => [c.id, [c.identity]]));
  const fake = clone(l.state);
  fake.characters.b!.counters.guard = 1;
  const e = stage(clock('day-end'), clock('day-start', 2), { kind: 'no-death', character: 'b' });
  const rows = [
    ...solveAbsence(
      l.pack,
      { entry, timing: { kind: 'day-end' }, coverage: 'complete', absent: [] },
      domains,
      {
        evidence: e,
        workPerRow: 100,
        worlds: () => ({ exhaustive: true, states: [fake, l.state] }),
      },
    ),
  ];
  assert.equal(rows[0]?.status, 'excluded');
});
