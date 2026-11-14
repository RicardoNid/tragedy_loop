import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import type { GameSetup } from '../../packages/contracts/src/game.js';
import { advance, drive, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import {
  buildProfiles,
  setupValues,
  shownIdentity,
} from '../../packages/engine/src/runtime/knowledge-domain.js';
import { CausalScope } from '../../packages/engine/src/runtime/knowledge-scope.js';

for (const module of ['FS', 'BTX'] as const) {
  test(
    module +
      ' every incident retains its actual hidden assignment after observable and quiet settlements',
    () => {
      let runs = 0,
        prefixes = 0,
        quiet = 0;
      for (const name of Object.keys(compileOfficial(module, true).incidents)) {
        const anniversary = !compileOfficial(module).incidents[name];
        const pack = compileOfficial(module, anniversary);
        for (const special of ['医生', '黑猫', '教主'] as const) {
          const setup: GameSetup = {
            module,
            anniversary,
            loops: 2,
            days: 2,
            captain: 'p0',
            discussion: 'allowed',
            y: module === 'FS' ? '守护此地' : '改变未来',
            x: module === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
            characters: [
              { id: 'a', character: '男学生', identity: '传谣人' },
              { id: 'b', character: '住院患者', identity: module === 'FS' ? '邪教徒' : '时间旅者' },
              { id: 'c', character: special, identity: module === 'FS' ? '关键人物' : '邪教徒' },
            ],
            incidents: [{ day: 1, name, culprit: 'c' }],
          };
          if (anniversary) {
            setup.characters.push({ id: 'd', character: '女学生', identity: '平民' });
            setup.anniversaryFragment = 'd';
          }
          const init = initializeDiscussion(pack, setup);
          assert.deepEqual(init.diagnostics, []);
          let s = init.state!;
          for (const a of Object.values(s.characters)) {
            a.counters.paranoia = 8;
            a.counters.goodwill = 4;
            a.area = a.id === 'b' ? 'hospital' : 'school';
            a.counters.intrigue = 2;
          }
          s.boards.hospital = 1;
          s.boards.school = 3;
          const opening = project(s, 'protagonists'),
            offset = opening.observations.length;
          s.pending = null;
          s.batch = null;
          s.frames = [];
          s.phase = 'incident';
          s.phaseEntered = false;
          announce(s, 'boundary', { phase: 'incident', captain: s.captain });
          drive(pack, s, 100);
          for (let n = 0; s.phase === 'incident' && s.pending && n < 16; n++) {
            const d = s.pending;
            const choice =
              d.options.find((c) => c.kind === 'select' && c.value === 'school') ?? d.options[0]!;
            const out = advance(pack, s, d.actor, {
              id: 'incident-' + n,
              decisionId: d.id,
              expectedRevision: s.revision,
              choice,
            });
            assert.notEqual(out.status, 'rejected');
            s = out.state;
          }
          assert.notEqual(s.phase, 'incident');
          const solver = new CausalScope(pack, opening);
          const profiles = buildProfiles(pack, opening, {
            checks: 0,
            removed: 0,
            branches: 0,
          }).filter((p) => p.y === setup.y && p.x.every((x) => setup.x.includes(x)));
          const truth = setupValues(setup);
          let happened = false,
            silent = false;
          for (const o of project(s, 'protagonists').observations.slice(offset)) {
            if (o.phase !== 'incident' && o.type !== 'boundary') break;
            solver.consume(
              o,
              profiles.filter((p) => p.active),
            );
            assert.ok(
              profiles.some((p) => {
                if (!p.active) return false;
                const store = p.store.clone();
                for (const [key, value] of truth) {
                  const domain = store.domains.get(key);
                  if (domain)
                    store.narrow(
                      key,
                      [...domain].filter(
                        (v) => (key.startsWith('identity:') ? shownIdentity(v) : v) === value,
                      ),
                    );
                }
                return store.propagate(true);
              }),
              JSON.stringify({ module, name, special, o }),
            );
            prefixes++;
            if (o.type === 'incident' && o.data.occurred === true) happened = true;
            if (o.type === 'no-effect') {
              silent = true;
              quiet++;
            }
            if (o.phase !== 'incident') break;
          }
          assert.ok(happened);
          if (special === '黑猫') assert.ok(silent, name);
          runs++;
        }
      }
      console.log(JSON.stringify({ module, runs, prefixes, quiet }));
    },
  );
}

// Exercise the recipient stream, including non-board announcements and
// multiple settlement frames, through the ordinary engine phase transition.
test('hospital at one intrigue publishes exactly one common quiet result, or the actual phenomenon', () => {
  function reports(
    mode: 'empty' | 'immune' | 'cat' | 'dead' | 'guard' | 'below' | 'reveal' | 'private' | 'follow',
  ) {
    const pack = structuredClone(compileOfficial('BTX'));
    const setup: GameSetup = {
      module: 'BTX',
      anniversary: false,
      days: 2,
      loops: 2,
      captain: 'p0',
      discussion: 'allowed',
      y: '改变未来',
      x: ['流言四起', '因果线'],
      characters: [
        { id: 'a', character: '男学生', identity: '传谣人' },
        { id: 'b', character: '住院患者', identity: '时间旅者' },
        { id: 'c', character: mode === 'cat' ? '黑猫' : '医生', identity: '邪教徒' },
      ],
      incidents: [{ day: 1, name: '医院事故', culprit: 'c' }],
    };
    if (mode === 'reveal')
      pack.incidents['医院事故']!.steps = [{ effects: [{ op: 'reveal-rule', rule: '因果线' }] }];
    if (mode === 'private')
      pack.incidents['医院事故']!.steps = [{ effects: [{ op: 'flag', key: 'private' }] }];
    if (mode === 'follow')
      pack.characters['医生']!.abilities.push({
        source: 'test',
        id: 'completion',
        timing: 'incident-completed',
        mandatory: true,
        steps: [{ effects: [{ op: 'reveal-rule', rule: '因果线' }] }],
      });
    const s = initializeDiscussion(pack, setup).state!;
    for (const c of Object.values(s.characters)) c.area = 'school';
    s.boards.hospital = 1;
    if (mode === 'immune') s.characters.b!.area = 'hospital';
    if (['cat', 'guard', 'dead'].includes(mode)) s.characters.a!.area = 'hospital';
    if (mode === 'guard') s.characters.a!.counters.guard = 1;
    s.characters.c!.counters.paranoia = mode === 'below' ? 0 : 8;
    s.pending = null;
    s.batch = null;
    s.frames = [];
    s.phase = 'incident';
    s.phaseEntered = false;
    announce(s, 'boundary', { phase: 'incident', captain: s.captain });
    drive(pack, s, 100);
    assert.notEqual(s.phase, 'incident');
    return project(s, 'protagonists')
      .observations.filter((o) => o.phase === 'incident' && o.type !== 'boundary')
      .map((o) => [o.type, o.data]);
  }
  const occurrence = ['incident', { day: 1, name: '医院事故', occurred: true }];
  for (const mode of ['empty', 'immune', 'cat', 'private'] as const)
    assert.deepEqual(reports(mode), [occurrence, ['no-effect', { day: 1 }]], mode);
  for (const mode of ['dead', 'guard'] as const) {
    const r = reports(mode);
    assert.deepEqual(
      r.map((v) => v[0]),
      ['incident', 'character'],
    );
    assert.ok(r[1]![1] && typeof r[1]![1] === 'object');
    const data = r[1]![1] as Record<string, unknown>;
    assert.equal(data.status, mode === 'dead' ? 'dead' : 'alive');
    assert.equal((data.counters as Record<string, number>).guard, 0);
  }
  const reveal = ['rule', { rule: '因果线' }];
  const quiet = ['no-effect', { day: 1 }];
  assert.deepEqual(reports('reveal'), [occurrence, reveal, quiet]);
  assert.deepEqual(reports('follow'), [occurrence, quiet, reveal]);
  assert.deepEqual(reports('below'), [['incident', { day: 1, name: '医院事故', occurred: false }]]);
});
