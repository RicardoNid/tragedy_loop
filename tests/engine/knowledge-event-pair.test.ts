import assert from 'node:assert/strict';
import test from 'node:test';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import type { GameSetup, Observation } from '../../packages/contracts/src/game.js';
import { initializeDiscussion, advance, drive } from '../../packages/engine/src/runtime/engine.js';
import { announce } from '../../packages/engine/src/runtime/settlement.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';
import { zeroCounters } from '../../packages/engine/src/runtime/model.js';
import { CausalScope } from '../../packages/engine/src/runtime/knowledge-scope.js';
import { buildProfiles } from '../../packages/engine/src/runtime/knowledge-domain.js';
import {
  distinctCounterPair,
  PairExecution,
} from '../../packages/engine/src/runtime/knowledge-pair.js';

test('parallel lanes spend the local budget only on targets compatible with the observed change', () => {
  const pair = distinctCounterPair(compileOfficial('FS').incidents['不安扩散']!.steps)!;
  const actors = new Map(
    Array.from({ length: 12 }, (_, i) => {
      const id = String(i);
      return [
        id,
        {
          id,
          character: '男学生',
          area: 'school' as const,
          status: 'alive' as const,
          counters: zeroCounters(),
        },
      ] as const;
    }),
  );
  const run = (delta: number) => {
    const tracker = new PairExecution(pair, 'parallel', 1);
    const possible = tracker.advance(actors, {
      kind: 'counter',
      target: '11',
      counter: 'paranoia',
      before: 0,
      after: delta,
    });
    return { possible, branches: tracker.branches, uncertain: tracker.uncertain };
  };
  assert.deepEqual(run(4), { possible: true, branches: 1, uncertain: false });
  assert.deepEqual(run(3), { possible: false, branches: 0, uncertain: false });
  assert.deepEqual(run(2), { possible: true, branches: 1, uncertain: true });
});

for (const module of ['FS', 'BTX'] as const)
  for (const name of ['不安扩散', '散播'])
    for (const mode of ['ordinary', 'repeated', 'parallel'] as const)
      test(module + ' ' + name + ' real menus and public prefixes: ' + mode, () => {
        const pack = compileOfficial(module);
        const setup: GameSetup = {
          module,
          anniversary: false,
          loops: 2,
          days: 2,
          captain: 'p0',
          discussion: 'allowed',
          y: module === 'FS' ? '守护此地' : '改变未来',
          x: module === 'FS' ? ['流言四起'] : ['流言四起', '因果线'],
          characters: [
            { id: 'a', character: '男学生', identity: '传谣人' },
            { id: 'b', character: '住院患者', identity: module === 'FS' ? '邪教徒' : '时间旅者' },
            {
              id: 'c',
              character: mode === 'ordinary' ? '医生' : mode === 'repeated' ? '教主' : '临时工',
              identity: module === 'FS' ? '关键人物' : '邪教徒',
            },
          ],
          incidents: [{ day: 1, name, culprit: 'c' }],
        };
        const init = initializeDiscussion(pack, setup);
        assert.deepEqual(init.diagnostics, []);
        const initial = init.state!;
        for (const actor of Object.values(initial.characters)) {
          actor.status = 'alive';
          actor.counters.paranoia = 8;
          // One silent first choice is possible in 散播.
          actor.counters.goodwill = actor.id === 'b' ? 0 : 3;
        }
        const opening = initialPlacementView(initial);
        const prior = opening.observations.length;
        initial.pending = null;
        initial.batch = null;
        initial.frames = [];
        initial.phase = 'incident';
        announce(initial, 'boundary', { phase: 'incident', captain: initial.captain });
        initial.phaseEntered = false;
        drive(pack, initial, 100);
        const pair = distinctCounterPair(pack.incidents[name]!.steps)!;
        assert.ok(pair);
        let leaves = 0,
          rejectedMenus = 0,
          restored = 0;
        const seen = new Set<string>();
        function walk(state: typeof initial, choices: string[]) {
          const menu = state.pending;
          if (state.phase === 'incident' && menu?.kind === 'choice') {
            const first = mode === 'parallel' ? choices[choices.length - 2] : choices.at(-1);
            const second = mode === 'parallel' ? choices.length >= 2 : choices.length % 2 === 1;
            if (second) {
              assert.ok(first);
              assert.ok(!menu.options.some((v) => v.kind === 'select' && v.value === first));
              assert.equal(
                advance(pack, state, menu.actor, {
                  id: 'illegal',
                  decisionId: menu.id,
                  expectedRevision: state.revision,
                  choice: { kind: 'select', value: first },
                }).status,
                'rejected',
              );
              rejectedMenus++;
            }
            for (const choice of menu.options) {
              assert.equal(choice.kind, 'select');
              if (choice.kind !== 'select') continue;
              const result = advance(pack, state, menu.actor, {
                id: 'choice-' + state.revision,
                decisionId: menu.id,
                expectedRevision: state.revision,
                choice,
              });
              assert.notEqual(result.status, 'rejected');
              walk(result.state, [...choices, choice.value]);
            }
            return;
          }
          leaves++;
          const observations = project(state, 'protagonists').observations.slice(prior);
          const close = observations.findIndex(
            (o) => o.type === 'boundary' && o.phase === 'captain-change',
          );
          assert.ok(close >= 0);
          const prefix = observations.slice(0, close + 1);
          const signature = JSON.stringify(prefix);
          if (seen.has(signature)) return;
          seen.add(signature);
          const tracker = new PairExecution(pair, mode);
          const actors = new Map(opening.characters.map((a) => [a.id, structuredClone(a)]));
          for (const o of prefix.filter((o) => o.type === 'character')) {
            const a = actors.get(String(o.data.character))!;
            const counters = o.data.counters as typeof a.counters;
            const keys = (Object.keys(counters) as (keyof typeof counters)[]).filter(
              (k) => a.counters[k] !== counters[k],
            );
            assert.equal(keys.length, 1);
            const counter = keys[0]!;
            assert.ok(
              tracker.advance(actors, {
                kind: 'counter',
                target: a.id,
                counter,
                before: a.counters[counter],
                after: counters[counter],
              }),
            );
            a.counters = { ...counters };
          }
          if (mode === 'repeated' && name === '散播') {
            assert.ok(prefix.some((o) => o.type === 'character'));
            const unchanged = opening.characters.every(
                (a) => JSON.stringify(a.counters) === JSON.stringify(actors.get(a.id)!.counters),
              );
            assert.equal(prefix.some((o) => o.type === 'no-effect'), unchanged);
            if (unchanged) restored++;
          }
          assert.ok(tracker.advance(actors));
          assert.equal(tracker.uncertain, false);
          // Exercise normal observation routing, culprit projection, and closure.
          const scope = new CausalScope(pack, opening);
          const profiles = buildProfiles(pack, opening, {
            checks: 0,
            removed: 0,
            branches: 0,
          }).filter((p) => p.y === setup.y && p.x.every((x) => setup.x.includes(x)));
          for (const o of prefix) {
            const version = scope.version;
            const before = profiles.map((p) => [...p.store.values('culprit:1')]);
            scope.consume(
              o as Observation,
              profiles.filter((p) => p.active),
            );
            if (mode === 'ordinary' && o.type === 'character') {
              assert.equal(scope.version, version);
              assert.deepEqual(
                profiles.map((p) => [...p.store.values('culprit:1')]),
                before,
              );
            }
          }
          if (mode === 'ordinary') assert.equal(scope.causeBranches, 0);
          else assert.ok(scope.causeBranches > 0);
          if (mode !== 'ordinary')
            for (const profile of profiles.filter((p) => p.active))
              assert.deepEqual([...profile.store.values('culprit:1')], ['c']);
          assert.ok(
            profiles.some((p) => p.active && p.store.values('culprit:1').has('c')),
            JSON.stringify({ module, name, mode, choices, prefix }),
          );
        }
        walk(initial, []);
        assert.equal(leaves, mode === 'ordinary' ? 6 : mode === 'repeated' ? 36 : 144);
        assert.ok(rejectedMenus > 0);
        if (mode === 'repeated' && name === '散播') assert.ok(restored > 0);
        console.log(
          JSON.stringify({
            module,
            name,
            mode,
            legalMenus: leaves,
            publicTraces: seen.size,
            rejectedMenus,
          }),
        );
      });
