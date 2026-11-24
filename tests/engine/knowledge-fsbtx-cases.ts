import assert from 'node:assert/strict';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';

export const cases: {
  name: string;
  setup: GameSetup;
  cards?: string[][];
  verify: (s: EngineState) => void;
}[] = [
  {
    name: 'FS copycat identity allocation and simultaneous serial killers',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '复仇的火种',
      x: ['开膛者的魔影'],
      characters: [
        { id: 'a', character: '女学生', identity: '杀人狂' },
        { id: 'b', character: '男学生', identity: '主谋' },
        { id: 'c', character: '住院患者', identity: '传谣人' },
        { id: 'd', character: '模仿犯', identity: '杀人狂', copiedFrom: 'a' },
      ],
      incidents: [],
    },
    cards: [
      ['horizontal', 'a'],
      ['intrigue+2', 'hospital'],
      ['paranoia+1', 'c'],
    ],
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.d!.status, 'dead');
    },
  },
  {
    name: 'FS simultaneous hospital deaths and immediate key-person loop end',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '守护此地',
      x: ['流言四起'],
      characters: [
        { id: 'a', character: '医生', identity: '关键人物' },
        { id: 'b', character: '住院患者', identity: '邪教徒' },
        { id: 'c', character: '男学生', identity: '传谣人' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.b!.status, 'dead');
      assert.equal(s.failed, true);
    },
  },
  {
    name: 'FS hospital batch with servant following, substitution and key-person death',
    setup: {
      module: 'FS',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '守护此地',
      x: ['流言四起'],
      characters: [
        { id: 'a', character: '从者', identity: '传谣人', initialArea: 'school' },
        { id: 'b', character: '大小姐', identity: '邪教徒' },
        { id: 'c', character: '医生', identity: '关键人物' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    cards: [
      ['diagonal', 'b'],
      ['intrigue+1', 'hospital'],
      ['paranoia+1', 'c'],
    ],
    verify(s) {
      assert.equal(s.characters.b!.area, 'hospital');
      assert.equal(s.characters.a!.area, 'hospital');
      assert.equal(s.characters.b!.status, 'alive');
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.c!.status, 'dead');
      assert.ok(s.audit.some((e) => e.kind === 'replacement-request'));
      assert.equal(s.failed, true);
    },
  },
  {
    name: 'BTX hospital simultaneous death and immortal time traveller',
    setup: {
      module: 'BTX',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '改变未来',
      x: ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '医生', identity: '邪教徒' },
        { id: 'b', character: '住院患者', identity: '时间旅者' },
        { id: 'c', character: '男学生', identity: '传谣人' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'b' }],
    },
    verify(s) {
      assert.equal(s.characters.a!.status, 'dead');
      assert.equal(s.characters.b!.status, 'alive');
    },
  },
  {
    name: 'BTX overlapping rumormonger quota, virus transformation and mandatory refusal',
    setup: {
      module: 'BTX',
      anniversary: false,
      loops: 2,
      days: 1,
      captain: 'p0',
      discussion: 'allowed',
      y: '巨大定时炸弹X',
      x: ['流言四起', '妄想扩大病毒'],
      characters: [
        { id: 'a', character: '女学生', identity: '魔女' },
        { id: 'b', character: '男学生', identity: '平民' },
        { id: 'c', character: '从者', identity: '传谣人', initialArea: 'school' },
      ],
      incidents: [],
    },
    verify(s) {
      assert.ok(s.observations.protagonists.some((o) => o.type === 'refused'));
      assert.equal(s.characters.b!.identity, '杀人狂');
      assert.equal(s.characters.a!.status, 'alive'); // Two other characters: serial killer does not trigger.
    },
  },
];

export function casePlayer(fixture: (typeof cases)[number]) {
  let triedAbility = false,
    triedGossip = false;
  return (state: EngineState): Choice => {
    const pending = state.pending!;
    assert.ok(pending);
    let choice: Choice;
    if (pending.kind === 'cards') {
      const entries =
        pending.actor === 'mastermind'
          ? (fixture.cards ?? [
              ['paranoia+1', 'b'],
              ['intrigue+2', 'hospital'],
              ['paranoia+1', 'c'],
            ])
          : pending.actor === 'p0'
            ? [['paranoia+1', 'b']]
            : pending.actor === 'p1'
              ? [['goodwill+2', 'a']]
              : [['horizontal', 'school']];
      const used = new Set<string>();
      choice = {
        kind: 'cards',
        placements: entries.map(([kind, target]) => {
          const card = state.cards.find(
            (c) =>
              c.owner === pending.actor &&
              c.kind === kind &&
              c.status === 'hand' &&
              !used.has(c.id),
          )!;
          assert.ok(card, `${pending.actor} missing ${kind}`);
          used.add(card.id);
          return { card: card.id, target: target! };
        }),
      };
    } else if (
      !triedGossip &&
      fixture.setup.incidents.length === 0 &&
      pending.actor === 'mastermind' &&
      pending.options.some((c) => c.kind === 'ability' && c.ability === 'gossip' && c.owner === 'c')
    ) {
      choice = pending.options.find(
        (c) => c.kind === 'ability' && c.ability === 'gossip' && c.owner === 'c',
      )!;
      triedGossip = true;
    } else if (
      pending.kind === 'choice' &&
      pending.actor === 'mastermind' &&
      pending.options.some((c) => c.kind === 'select' && c.value === 'b')
    ) {
      choice = pending.options.find((c) => c.kind === 'select' && c.value === 'b')!;
    } else if (
      !triedAbility &&
      fixture.setup.incidents.length === 0 &&
      pending.actor !== 'mastermind' &&
      pending.options.some((c) => c.kind === 'ability')
    ) {
      choice = pending.options.find((c) => c.kind === 'ability' && c.owner === 'a') ?? {
        kind: 'pass',
      };
      triedAbility = true;
    } else
      choice =
        pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
        pending.options[0]!;
    return choice;
  };
}
