import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardKind, Choice, GameSetup } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initialize } from '../../packages/engine/src/runtime/engine.js';
import { replay, type RecordedChoice } from '../../packages/engine/src/runtime/replay.js';
import { canonical } from '../../packages/engine/src/runtime/model.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { act, character, lab, phase, type Lab } from '../comprehensive/harness.js';

function cardChoice(l: Lab, entries: [string, CardKind][]): Choice {
  const { actor, kind } = l.state.pending!;
  assert.equal(kind, 'cards');
  const placements = entries.map(([target, kind]) => {
    const card = l.state.cards.find(
      (c) => c.owner === actor && c.kind === kind && c.status === 'hand',
    );
    assert.ok(card, actor + '/' + kind);
    return { target, card: card.id };
  });
  return { kind: 'cards', placements };
}

function place(l: Lab, entries: [string, CardKind][]) {
  act(l, cardChoice(l, entries));
}

function selectMenu(l: Lab, expected: string[]) {
  const d = l.state.pending!;
  assert.equal(d.kind, 'choice');
  assert.deepEqual(
    d.options,
    expected.map((value) => ({ kind: 'select', value })),
  );
}

// Compare the entire serializable result (including decisions, receipts and observations).
function answerAfterSave(l: Lab, choice: Choice) {
  const saved = { pack: l.pack, state: JSON.parse(JSON.stringify(l.state)) };
  act(saved, choice);
  act(l, choice);
  assert.equal(canonical(saved.state), canonical(l.state));
}

// FAQ 167–169, 188, 191, 193 and the servant character card.
test('同时出牌：从者在大人物、大小姐、追加的幻想间选跟随，随后在移动后版图结算指示物', () => {
  for (const additional of [false, true]) {
    const base = lab();
    character(base, 'a', '从者', '平民', 'school').counters.goodwill = 4;
    character(base, 'b', '大人物', '平民', 'school');
    character(base, 'c', '大小姐', '平民', 'school');
    character(base, 'd', '幻想', '平民', 'school');
    base.state.setup.characters.find((c) => c.id === 'b')!.territory = 'city';
    if (additional) {
      phase(base, 'protagonist-abilities');
      act(base, { kind: 'ability', owner: 'a', ability: 'servant', choices: { target: 'd' } });
      assert.equal(base.state.characters.a!.flags.protect, 'd');
    }
    phase(base, 'mastermind-cards');
    place(base, [
      ['c', 'horizontal'],
      ['b', 'vertical'],
      ['school', 'diagonal'],
    ]);
    place(base, [['a', 'block-movement']]);
    place(base, [['hospital', 'goodwill+1']]);
    place(base, [['school', 'paranoia+1']]);
    const ids = additional ? ['b', 'c', 'd'] : ['b', 'c'];
    selectMenu(base, ids);
    assert.equal(base.state.pending!.actor, base.state.captain);
    assert.equal(project(base.state, 'mastermind').decision, undefined);
    for (const c of Object.values(base.state.characters)) assert.equal(c.area, 'school');
    assert.equal(base.state.characters.d!.counters.goodwill, 0);
    for (const id of ids) {
      const l = { pack: base.pack, state: structuredClone(base.state) };
      answerAfterSave(l, { kind: 'select', value: id });
      const { a, b, c, d } = l.state.characters;
      assert.deepEqual([b!.area, c!.area, d!.area], ['shrine', 'city', 'hospital']);
      assert.equal(a!.area, l.state.characters[id]!.area);
      assert.equal(d!.counters.goodwill, 1);
      assert.equal(d!.counters.paranoia, 0);
      assert.equal(a!.counters.goodwill, 4);
      assert.ok(!l.state.placements.length);
    }
  }
});

// Hospital incident, rulebook 4.1.2 and FAQ 108, 189, 190, 453.
test('医院事故：按实际位置同时替死，护卫逐请求消耗，主人公死亡和愚者的后续均完成', () => {
  const logs = new Map<string, Lab['state']['observations']>();
  for (const bossAtHospital of [false, true])
    for (const intrigue of [0, 1, 2])
      for (const guard of [0, 1, 2, 3])
        for (const reverse of [false, true]) {
          const l = lab('MC');
          character(l, 'a', '从者', '平民', 'hospital').counters.guard = guard;
          character(l, 'b', '大小姐', '关键人物', 'hospital');
          character(l, 'c', '大人物', '平民', bossAtHospital ? 'hospital' : 'city');
          l.state.setup.characters.find((c) => c.id === 'c')!.territory = bossAtHospital
            ? 'city'
            : 'hospital';
          character(l, 'd', '医生', '愚者', 'hospital').counters.paranoia = 5;
          if (reverse)
            l.state.characters = Object.fromEntries(Object.entries(l.state.characters).reverse());
          l.state.boards.hospital = intrigue;
          l.state.setup.incidents = [{ day: 1, name: '医院事故', culprit: 'd' }];
          phase(l, 'incident');
          const key = JSON.stringify([bossAtHospital, intrigue, guard]);
          if (reverse) assert.deepEqual(l.state.observations, logs.get(key), '公告重放分歧 ' + key);
          else logs.set(key, structuredClone(l.state.observations));
          if (intrigue === 2 && guard === 0) {
            for (const stream of Object.values(l.state.observations)) {
              const firstDeath = (id: string) => stream.find(o => o.type === 'character' && o.data.character === id && o.data.status === 'dead');
              const group = firstDeath('a')!.simultaneousGroup;
              assert.ok(group !== undefined);
              assert.equal(firstDeath('d')!.simultaneousGroup, group);
              assert.equal(stream.find(o => o.type === 'failure' && o.data.result === 'protagonist-death')!.simultaneousGroup, group);
              // The fool clears paranoia only AFTER the hospital incident completes.
              const cleanup = stream.find(o => o.type === 'character' && o.data.character === 'd' && o.data.status === 'dead' && (o.data.counters as {paranoia: number}).paranoia === 0);
              assert.ok(cleanup);
              assert.ok(cleanup.sequence >= group + firstDeath('d')!.simultaneousSize!);
              assert.notEqual(cleanup.simultaneousGroup, group);
            }
          }
          const { a, b, c, d } = l.state.characters;
          const hits = intrigue === 0 ? 0 : 2 + Number(bossAtHospital);
          const label = JSON.stringify({ bossAtHospital, intrigue, guard, reverse });
          assert.deepEqual(
            [
              a!.status,
              a!.counters.guard,
              b!.status,
              c!.status,
              d!.status,
              d!.counters.paranoia,
              l.state.protagonistDead,
            ],
            [
              guard < hits ? 'dead' : 'alive',
              Math.max(0, guard - hits),
              'alive',
              'alive',
              intrigue ? 'dead' : 'alive',
              0,
              intrigue === 2,
            ],
            label,
          );
          assert.equal(l.state.incidents.filter((i) => i.name === '医院事故').length, 1, label);
          assert.equal(
            l.state.audit.filter((e) => e.kind === 'replacement-request').length,
            Math.max(0, hits - 1),
            label,
          );
        }
});

// Immortal character card: move, THEN revive at the resulting location.
// FAQ 191, 311: follow movement from an ability; a sealed board blocks movement.
test('仙人复活：封锁改变可声明尸体，从者只跟随实际移动，拒绝后两步均不发生', () => {
  for (const locked of [false, true])
    for (const refuse of [false, true])
      for (const x of [0, 3]) {
        const l = lab('AHR');
        character(l, 'a', '仙人', '童谣', 'school').counters.goodwill = 5;
        l.state.setup.characters.find((c) => c.id === 'a')!.x = x;
        character(l, 'b', '从者', '平民', 'school').flags.protect = 'a';
        character(l, 'c', '幻想', '平民', 'city').status = 'dead';
        character(l, 'd', '大人物', '平民', 'school').status = 'dead';
        l.state.setup.characters.find((c) => c.id === 'd')!.territory = 'city';
        if (locked) {
          l.state.flags['lockdown-area'] = 'city';
          l.state.flags['lockdown-day'] = '1';
        }
        phase(l, 'protagonist-abilities');
        const target = locked ? 'd' : 'c';
        const pending = l.state.pending!;
        const declaration = { kind: 'ability' as const, owner: 'a', ability: 'immortal-revive' };
        const bad = advance(l.pack, l.state, pending.actor, {
          id: 'other-corpse',
          expectedRevision: l.state.revision,
          decisionId: pending.id,
          choice: { ...declaration, choices: { area: 'city', target: locked ? 'c' : 'd' } },
        });
        assert.equal(bad.status, 'rejected');
        assert.equal(bad.state, l.state);
        act(l, { ...declaration, choices: { area: 'city', target } });
        assert.equal(l.state.pending?.kind, 'refusal');
        assert.equal(l.state.pending?.actor, 'mastermind');
        answerAfterSave(l, { kind: 'refuse', refuse });
        const { a, b, c, d } = l.state.characters;
        const destination = locked || refuse ? 'school' : 'city';
        assert.deepEqual(
          [a!.area, b!.area, c!.status, d!.status, c!.counters.goodwill, d!.counters.goodwill],
          [
            destination,
            destination,
            !locked && !refuse ? 'alive' : 'dead',
            locked && !refuse ? 'alive' : 'dead',
            !locked && !refuse ? x : 0,
            locked && !refuse ? x : 0,
          ],
        );
      }
});

// FAQ 141/402: choose one effective area at EX3. FAQ 168: the illusion reads
// the action cards on its destination board after movement.
test('大人物邪教徒只撤销选区的禁止密谋，移动后的幻想与版图在同一批加密谋', () => {
  for (const mode of ['actual', 'territory'])
    for (const invoke of [false, true]) {
      const l = lab('WM');
      character(l, 'a', '大人物', '邪教徒', 'city');
      l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
      character(l, 'b', '幻想', '平民', 'shrine');
      l.state.ex = 3;
      phase(l, 'mastermind-cards');
      place(l, [
        ['city', 'intrigue+2'],
        ['school', 'intrigue+1'],
        ['shrine', 'vertical'],
      ]);
      place(l, [['city', 'block-intrigue']]);
      place(l, [['school', 'block-intrigue']]);
      place(l, [['c', 'goodwill+1']]);
      assert.equal(l.state.characters.b!.area, 'school');
      assert.deepEqual(
        [l.state.boards.city, l.state.boards.school, l.state.characters.b!.counters.intrigue],
        [0, 0, 0],
      );
      selectMenu(l, ['actual', 'territory']);
      answerAfterSave(l, { kind: 'select', value: mode });
      assert.equal(l.state.pending?.actor, 'mastermind');
      answerAfterSave(
        l,
        invoke ? { kind: 'ability', owner: 'a', ability: 'cultist' } : { kind: 'pass' },
      );
      const school = Number(invoke && mode === 'territory');
      assert.deepEqual(
        [l.state.boards.city, l.state.boards.school, l.state.characters.b!.counters.intrigue],
        [invoke && mode === 'actual' ? 2 : 0, school, school],
      );
    }
});

// Rulebook 4.1.2–4.1.3, FAQ 132, 189, 222: both day-end triggers have
// already fired before substitution, guard expenditure or loop interruption.
test('大人物与从者同为杀人狂：选领地杀关键人物不能取消同批已成立的替死请求', () => {
  for (const mode of ['actual', 'territory'])
    for (const guard of [0, 1, 2])
      for (const reverse of [false, true]) {
        const l = lab();
        character(l, 'a', '大人物', '杀人狂', 'city');
        l.state.setup.characters.find((c) => c.id === 'a')!.territory = 'school';
        character(l, 'b', '从者', '杀人狂', 'city').counters.guard = guard;
        character(l, 'c', '女学生', '关键人物', 'school');
        character(l, 'd', '医生', '平民', 'hospital');
        if (reverse)
          l.state.characters = Object.fromEntries(Object.entries(l.state.characters).reverse());
        phase(l, 'day-end');
        selectMenu(l, ['actual', 'territory']);
        assert.equal(l.state.pending!.actor, 'mastermind');
        assert.ok(Object.values(l.state.characters).every((c) => c.status === 'alive'));
        answerAfterSave(l, { kind: 'select', value: mode });
        const { a, b, c } = l.state.characters;
        const hits = mode === 'actual' ? 2 : 1;
        assert.deepEqual(
          [a!.area, a!.status, b!.status, b!.counters.guard, c!.status],
          [
            'city',
            'alive',
            guard < hits ? 'dead' : 'alive',
            Math.max(0, guard - hits),
            mode === 'actual' ? 'alive' : 'dead',
          ],
        );
        assert.equal(l.state.audit.filter((e) => e.kind === 'replacement-request').length, 1);
        assert.equal(l.state.phase, mode === 'territory' ? 'discussion' : 'mastermind-cards');
      }
});

// Reach the follow decision without injecting a phase, a flag, a card or a character position.
test('合法 BTX 剧本从简报到终局：复放两条不同跟随历史，分别得到各自的完整终态', () => {
  const setup: GameSetup = {
    module: 'BTX',
    anniversary: false,
    loops: 1,
    days: 2,
    captain: 'p0',
    discussion: 'between-loops',
    y: '谋杀计划',
    x: ['流言四起', '因果线'],
    characters: [
      { id: 'servant', character: '从者', identity: '主谋', initialArea: 'school' },
      { id: 'boss', character: '大人物', identity: '传谣人', territory: 'school' },
      { id: 'rich', character: '大小姐', identity: '关键人物' },
      { id: 'illusion', character: '幻想', identity: '平民' },
      { id: 'immortal', character: '仙人', identity: '杀手', initialArea: 'shrine', x: 3 },
    ],
    incidents: [],
  };
  const pack = compileOfficial('BTX');
  for (const leader of ['boss', 'rich']) {
    const start = initialize(pack, setup);
    assert.deepEqual(start.diagnostics, []);
    const l: Lab = { pack, state: start.state! };
    const history: RecordedChoice[] = [];
    let follows = 0;
    while (!l.state.winner) {
      assert.ok(history.length < 100, 'two-day decision limit');
      const p = l.state.pending!;
      assert.ok(p, l.state.diagnostic);
      const options = p.options;
      let choice: Choice;
      if (p.kind === 'cards') {
        const first = l.state.day === 1;
        const cards: Record<string, [string, CardKind][]> = {
          mastermind: first
            ? [
                ['boss', 'horizontal'],
                ['shrine', 'vertical'],
                ['city', 'block-goodwill'],
              ]
            : [
                ['rich', 'horizontal'],
                ['boss', 'vertical'],
                ['school', 'diagonal'],
              ],
          p0: first ? [['hospital', 'paranoia-1']] : [['servant', 'block-movement']],
          p1: first ? [['city', 'block-intrigue']] : [['hospital', 'goodwill+1']],
          p2: first ? [['immortal', 'block-movement']] : [['school', 'paranoia+1']],
        };
        choice = cardChoice(l, cards[p.actor]!);
      } else if (options.some((c) => c.kind === 'select' && c.value === leader)) {
        selectMenu(l, ['boss', 'rich']);
        assert.equal(l.state.phase, 'card-resolution');
        assert.equal(l.state.day, 2);
        assert.equal(p.actor, l.state.captain);
        assert.deepEqual(
          ['boss', 'rich', 'illusion', 'servant'].map((id) => l.state.characters[id]!.area),
          ['school', 'school', 'school', 'school'],
        );
        follows++;
        choice = { kind: 'select', value: leader };
      } else {
        const next = options.find(
          (c) =>
            c.kind === 'pass' ||
            c.kind === 'start' ||
            c.kind === 'continue' ||
            (c.kind === 'select' && c.value === 'actual'),
        );
        assert.ok(next, JSON.stringify(p));
        choice = next;
      }
      const r = advance(pack, l.state, p.actor, {
        id: 'replay-' + history.length,
        expectedRevision: l.state.revision,
        decisionId: p.id,
        choice,
      });
      assert.equal(r.status, 'ok', r.reason);
      history.push({ actor: p.actor, choice });
      l.state = r.state;
    }
    assert.equal(follows, 1);
    assert.equal(l.state.winner, 'protagonists');
    assert.equal(l.state.characters.servant!.area, leader === 'boss' ? 'shrine' : 'city');
    assert.equal(l.state.characters.illusion!.counters.goodwill, 1);
    const repeated = replay(pack, { setup, choices: JSON.parse(JSON.stringify(history)),
      expectedObservations: l.state.observations });
    assert.equal(repeated.status, 'replayed');
    assert.deepEqual(repeated.state, l.state);
    for (const audience of ['public', 'mastermind', 'protagonists'] as const) {
      const expected = structuredClone(l.state.observations[audience]);
      const member = expected.find(o => o.simultaneousGroup !== undefined)!;
      assert.ok(member);
      const first = member.sequence - 1;
      const size = member.simultaneousSize!;
      const reversed = expected.slice(first, first + size).reverse()
        .map((o, i) => ({ ...o, sequence: first + i + 1 }));
      const permuted = [...expected.slice(0, first), ...reversed, ...expected.slice(first + size)];
      assert.equal(replay(pack, { setup, choices: history, expectedObservations: { [audience]: permuted } }).status, 'replayed');
      const duplicated = [...permuted];
      duplicated[first] = { ...permuted[first + 1]!, sequence: first + 1 };
      assert.equal(replay(pack, { setup, choices: history, expectedObservations: { [audience]: duplicated } }).status, 'mismatch');
      const missing = expected.filter((_, i) => i !== first).map((o, i) => ({ ...o, sequence: i + 1 }));
      assert.equal(replay(pack, { setup, choices: history, expectedObservations: { [audience]: missing } }).status, 'mismatch');
      delete member.simultaneousGroup;
      const changed = replay(pack, { setup, choices: history, expectedObservations: { [audience]: expected } });
      assert.equal(changed.status, 'mismatch');
      assert.equal(changed.reason, 'announcement-mismatch');
      assert.ok('sequence' in changed && changed.sequence === member.sequence && changed.audience === audience);
    }
  }
});

// LL B wins on the sixth distinct communication before the goodwill effect.
// FAQ 172, 194, 277/463: removing the illusion preserves markers, causes no
// substitute death or follow, and skips the key's after-use trigger.
test('LL 幻想密钥：拒绝、第五枚、第六枚与重复沟通分别核对移除、从者及个人胜负', () => {
  for (const prior of [
    ['b', 'c', 'd', 'e'],
    ['b', 'c', 'd', 'e', 'f'],
    ['a', 'b', 'c', 'd', 'e'],
  ]) {
    for (const refuse of [false, true]) {
      const l = lab('LL');
      l.state.setup.x = ['神话收集者', '捏造的秘密'];
      character(l, 'a', '幻想', '密钥', 'shrine').counters.goodwill = 4;
      character(l, 'b', '从者', '平民', 'shrine').flags.protect = 'a';
      character(l, 'e', '教师');
      character(l, 'f', '班长');
      l.state.ll = {
        roles: { p0: 'A', p1: 'B', p2: 'C' },
        communicated: [...prior],
        died: [],
        finalTraitorsDisabled: false,
      };
      phase(l, 'protagonist-abilities');
      act(l, { kind: 'ability', owner: 'a', ability: 'illusion-remove' });
      assert.equal(l.state.pending?.kind, 'refusal');
      assert.deepEqual(l.state.ll.communicated, prior);
      answerAfterSave(l, { kind: 'refuse', refuse });
      const marked = refuse || prior.includes('a') ? prior : [...prior, 'a'];
      const won = marked.length === 6;
      assert.deepEqual(l.state.ll.communicated, marked);
      assert.equal(l.state.winner, won ? 'p1' : undefined);
      assert.equal(l.state.characters.a!.status, refuse || won ? 'alive' : 'removed');
      assert.deepEqual(
        [l.state.characters.b!.area, l.state.characters.b!.status],
        ['shrine', 'alive'],
      );
      assert.deepEqual(l.state.ll.died, []);
      assert.equal(l.state.delayed?.length ?? 0, 0);
    }
  }
});

// FAQ 270/273/374: choose the incident area first, all destinations next,
// and only then resolve the servant's competing follow targets.
test('仙人发动孤守：三名角色选完目的地仍未移动，队长选择跟随后整批生效', () => {
  for (const mode of ['actual', 'clockwise']) {
    const origin = mode === 'actual' ? 'school' : 'city';
    for (const leader of ['c', 'd']) {
      const l = lab('HSA');
      character(l, 'a', '仙人', '平民', 'school').counters.paranoia = 5;
      l.state.setup.characters.find((c) => c.id === 'a')!.x = 3;
      character(l, 'b', '从者', '平民', origin);
      character(l, 'c', '大人物', '平民', origin);
      l.state.setup.characters.find((c) => c.id === 'c')!.territory = 'hospital';
      character(l, 'd', '大小姐', '平民', origin);
      l.state.setup.incidents = [{ day: 1, name: '孤守', culprit: 'a' }];
      phase(l, 'incident');
      selectMenu(l, ['actual', 'clockwise']);
      answerAfterSave(l, { kind: 'select', value: mode });
      for (const area of [origin === 'city' ? 'school' : 'city', 'hospital', 'shrine']) {
        assert.equal(l.state.pending?.actor, 'mastermind');
        answerAfterSave(l, { kind: 'select', value: area });
        assert.deepEqual(
          ['b', 'c', 'd'].map((id) => l.state.characters[id]!.area),
          [origin, origin, origin],
        );
      }
      selectMenu(l, ['c', 'd']);
      assert.equal(l.state.pending?.actor, l.state.captain);
      answerAfterSave(l, { kind: 'select', value: leader });
      assert.deepEqual(
        ['a', 'b', 'c', 'd'].map((id) => l.state.characters[id]!.area),
        ['school', leader === 'c' ? 'hospital' : 'shrine', 'hospital', 'shrine'],
      );
      assert.equal(l.state.incidents.filter((i) => i.name === '孤守').length, 1);
    }
  }
});
