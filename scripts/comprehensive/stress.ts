import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fixtures, generate, checkpoint } from '../../tests/engine/official-harness.js';
import { replay } from '../../packages/engine/src/runtime/replay.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { lab, character, phase, act, drain } from '../../tests/comprehensive/harness.js';
import { effective } from '../../packages/engine/src/runtime/expressions.js';
import type { Module } from '../../packages/contracts/src/game.js';
const report = {
  games: 0,
  commands: 0,
  characterProfiles: 0,
  counterVectors: 0,
  failures: [] as { case: string; error: string }[],
};
for (const fixture of fixtures)
  for (const seed of [1, 7, 31, 97])
    for (const aggressive of [false, true]) {
      const id = `${fixture.id}/${seed}/${aggressive}`;
      try {
        const h = generate(fixture, aggressive, seed);
        const r = replay(compileOfficial(h.setup.module, h.setup.anniversary), {
          setup: h.setup,
          choices: h.steps.map((s) => ({ actor: s.actor, choice: s.command.choice })),
        });
        assert.equal(r.status, 'replayed');
        assert.deepEqual(checkpoint(r.state), h.steps.at(-1)!.expected);
        report.games++;
        report.commands += h.steps.length;
      } catch (e) {
        report.failures.push({ case: id, error: String(e) });
      }
    }
console.log(`full games ${report.games}; starting character/profile matrix`);
for (const module of ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM', 'AHR', 'LL'] as Module[])
  for (const anniversary of [false, true]) {
    if (anniversary && ['AHR', 'LL'].includes(module)) continue;
    const pack = compileOfficial(module, anniversary);
    for (const name of Object.keys(pack.characters))
      for (const identity of Object.keys(pack.identities)) {
        const id = `${module}${anniversary ? '+' : ''}/${name}/${identity}`;
        try {
          const l = lab(module, anniversary);
          const c = character(l, 'a', name, identity);
          Object.assign(c.counters, { goodwill: 5, paranoia: 3, intrigue: 2 });
          phase(l, 'protagonist-abilities');
          const a = l.state.pending?.options.find((c) => c.kind === 'ability' && c.owner === 'a');
          if (a) {
            act(l, a);
            drain(l);
          }
          for (const c of Object.values(l.state.characters))
            for (const n of Object.values(c.counters)) assert.ok(Number.isSafeInteger(n) && n >= 0);
          for (const n of Object.values(l.state.boards))
            assert.ok(Number.isInteger(n) && n >= 0 && n <= 3);
          report.characterProfiles++;
        } catch (e) {
          report.failures.push({ case: id, error: String(e) });
        }
      }
  }
for (let g = 0; g < 4; g++)
  for (let p = 0; p < 4; p++)
    for (let i = 0; i < 4; i++)
      for (let h = 0; h < 4; h++)
        for (let d = 0; d < 4; d++) {
          const l = lab();
          Object.assign(l.state.characters.a!.counters, {
            goodwill: g,
            paranoia: p,
            intrigue: i,
            hope: h,
            despair: d,
          });
          assert.equal(effective(l.state, 'a', 'goodwill'), g + h);
          assert.equal(effective(l.state, 'a', 'paranoia'), p + d);
          assert.equal(effective(l.state, 'a', 'intrigue'), Math.max(0, i + d - h));
          report.counterVectors++;
        }
writeFileSync('products/comprehensive/stress.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
if (report.failures.length) process.exitCode = 1;
