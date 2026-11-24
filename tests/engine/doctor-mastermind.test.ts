import assert from 'node:assert/strict';
import test from 'node:test';
import { lab, character, phase, act } from '../comprehensive/harness.js';
import { project } from '../../packages/engine/src/runtime/ports.js';

test('医生友好2：剧作家菜单按无视友好、目标、门槛开放，实际可加减不安', () => {
  // Doctor card and local FAQ: despair grants mandatory refusal.
  for (const identity of ['平民', '主谋', '杀手', '邪教徒'])
    for (const goodwill of [1, 2, 3])
      for (const despair of [0, 1])
        for (const targetAlive of [false, true]) {
          const l = lab();
          const doctor = character(l, 'a', '医生', identity, 'hospital');
          Object.assign(doctor.counters, { goodwill, despair });
          character(l, 'b', '住院患者', '平民', 'hospital').status = targetAlive ? 'alive' : 'dead';
          character(l, 'c', '男学生', '平民', 'school');
          character(l, 'd', '巫女', '平民', 'shrine');
          phase(l, 'mastermind-abilities');
          const menu = project(l.state, 'mastermind').decision;
          const present =
            menu?.options.some(
              (c) => c.kind === 'ability' && c.owner === 'a' && c.ability === 'doctor-counter',
            ) ?? false;
          assert.equal(
            present,
            goodwill >= 2 && targetAlive && (identity !== '平民' || despair > 0),
            JSON.stringify({ identity, goodwill, despair, targetAlive }),
          );
          if (!present) continue;
          assert.equal(l.state.pending!.actor, 'mastermind');
          assert.ok(
            !menu!.options.some((c) => c.kind === 'ability' && c.ability === 'doctor-release'),
          );
          for (const direction of ['add', 'remove']) {
            const branch = { pack: l.pack, state: structuredClone(l.state) };
            branch.state.characters.b!.counters.paranoia = 1;
            act(branch, {
              kind: 'ability',
              owner: 'a',
              ability: 'doctor-counter',
              choices: { target: 'b', direction },
            });
            assert.equal(branch.state.characters.b!.counters.paranoia, direction === 'add' ? 2 : 0);
            assert.ok(
              !project(branch.state, 'mastermind').decision?.options.some(
                (c) => c.kind === 'ability' && c.ability === 'doctor-counter',
              ),
            );
          }
        }
});
