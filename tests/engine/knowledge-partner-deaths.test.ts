import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { LiveKnowledge, EnumeratedKnowledge } from '../../packages/engine/src/runtime/knowledge.js';
import { project } from '../../packages/engine/src/runtime/ports.js';

test('BTX same-batch hospital deaths preserve both joint partner assignments through phase close', () => {
  const pack = compileOfficial('BTX');
  const setup: GameSetup = {
    module: 'BTX',
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '巨大定时炸弹X',
    x: ['恋爱风景线', '因果线'],
    characters: [
      { id: 'A', character: '医生', identity: '求爱者' },
      { id: 'B', character: '住院患者', identity: '心上人' },
      { id: 'C', character: '男学生', identity: '魔女' },
    ],
    incidents: [{ day: 1, name: '医院事故', culprit: 'B' }],
  };
  function play(config: GameSetup) {
    const init = initializeDiscussion(pack, config);
    assert.deepEqual(init.diagnostics, []);
    let state = init.state!;
    const opening = project(state, 'protagonists');
    for (let i = 0; i < 40; i++) {
      const d = state.pending!;
      let choice: Choice;
      if (d.kind === 'cards') {
        const plays =
          d.actor === 'mastermind'
            ? [
                ['paranoia+1', 'B'],
                ['intrigue+1', 'hospital'],
                ['paranoia+1', 'C'],
              ]
            : d.actor === 'p0'
              ? [['paranoia+1', 'B']]
              : d.actor === 'p1'
                ? [['goodwill+2', 'A']]
                : [['horizontal', 'school']];
        const used = new Set<string>();
        choice = {
          kind: 'cards',
          placements: plays.map(([kind, target]) => {
            const card = state.cards.find(
              (c) =>
                c.status === 'hand' && c.owner === d.actor && c.kind === kind && !used.has(c.id),
            );
            assert.ok(card);
            used.add(card.id);
            return { card: card.id, target: target! };
          }),
        };
      } else {
        const pass = d.options.find((c) => c.kind === 'pass' || c.kind === 'continue');
        assert.ok(pass);
        choice = pass;
      }
      const result = advance(pack, state, d.actor, {
        id: 'partner-' + i,
        decisionId: d.id,
        expectedRevision: state.revision,
        choice,
      });
      assert.equal(result.status, 'ok', result.reason);
      state = result.state;
      const reports = project(state, 'protagonists').observations;
      const close = reports.findIndex((o) => o.phase === 'captain-change' && o.type === 'boundary');
      if (close >= 0) return { opening, reports: reports.slice(0, close + 1) };
    }
    throw Error('Incident window did not close');
  }
  const { opening, reports } = play(setup);
  const incident = reports.filter((o) => o.phase === 'incident');
  const deaths = incident.filter((o) => o.type === 'character' && o.data.status === 'dead');
  assert.deepEqual(
    deaths.map((o) => o.data.character),
    ['A', 'B'],
  );
  assert.deepEqual(
    incident.map((o) => o.type),
    ['boundary', 'incident', 'character', 'character'],
  );
  const live = new LiveKnowledge(pack, opening);
  const oracle = new EnumeratedKnowledge(pack, opening);
  const orders = [
    ['求爱者', '心上人', '魔女'],
    ['心上人', '求爱者', '魔女'],
    ['求爱者', '魔女', '心上人'],
    ['心上人', '魔女', '求爱者'],
    ['魔女', '心上人', '求爱者'],
    ['魔女', '求爱者', '心上人'],
  ];
  const configs = orders.map((roles) => ({
    ...setup,
    characters: setup.characters.map((c, i) => ({ ...c, identity: roles[i]! })),
  }));
  const rows = [];
  for (const o of reports) {
    live.append([o], o.sequence - 1, o.sequence);
    if (o.type !== 'incident' && !deaths.includes(o) && o !== reports.at(-1)) continue;
    const isClosed = o === reports.at(-1);
    const local = live.snapshot();
    if (isClosed) {
      const relation = local.relations?.find(
        (r) => r.id === 'incident-death-reaction:' + o.sequence,
      );
      const notes = relation?.cases.flatMap((c) => c.alternatives) ?? [];
      for (const dead of ['A', 'B'])
        assert.ok(
          notes.some((note) => note.includes(dead + ' 死亡后 C 未增加不安')),
          JSON.stringify(notes),
        );
      assert.ok(
        !notes.some(
          (note) => note.includes('排除这两人的求爱者') && /死亡后 [AB] 未增加不安/.test(note),
        ),
      );
    }
    const result = configs.map((config) => live.queryConfiguration(config));
    const expected = configs.map((_, i) => (isClosed && i >= 2 ? 'excluded' : 'possible'));
    assert.deepEqual(result, expected, 'joint queries at #' + o.sequence);
    rows.push({
      sequence: o.sequence,
      type: o.type,
      result,
      historyCandidates: local.transition?.historyCandidates,
    });
  }
  oracle.update(reports, reports.at(-1)!.sequence);
  assert.deepEqual(
    configs.map((c) => oracle.queryConfiguration(c)),
    rows.at(-1)!.result,
  );
  for (const [i, config] of configs.entries()) {
    const witness = play(config).reports;
    if (i < 2) assert.deepEqual(witness, reports);
    else {
      const survivor = witness.filter(
        (o) => o.phase === 'incident' && o.type === 'character' && o.data.character === 'C',
      );
      assert.equal(survivor.length, 1);
      const before = witness
        .slice(0, witness.indexOf(survivor[0]!))
        .reverse()
        .find((o) => o.type === 'character' && o.data.character === 'C')!;
      const paranoia = (data: Record<string, unknown>) =>
        (data.counters as { paranoia: number }).paranoia;
      assert.equal(paranoia(survivor[0]!.data) - paranoia(before.data), 6);
    }
  }
  console.log(JSON.stringify({ orders, rows }));
});
