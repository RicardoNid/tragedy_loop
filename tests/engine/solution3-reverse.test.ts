import assert from 'node:assert/strict';
import test from 'node:test';
import { reverseWindow } from '../../scripts/engine/solution3-reverse-prototype.js';
const branches = [
  {
    id: '强制',
    literals: ['心理医生', 'EX≥1', '所有目标有不安'],
    traces: [['减一']],
    exhaustive: true,
  },
  {
    id: '可静默',
    literals: ['心理医生', 'EX≥1', '存在零不安目标'],
    traces: [[], ['减一']],
    exhaustive: true,
  },
  { id: '未触发', literals: ['EX为零'], traces: [[]], exhaustive: true },
];
test('反向原型只在闭合时用缺失排除整条分支', () => {
  assert.deepEqual(reverseWindow(branches, [], 'open').rejected, []);
  const closed = reverseWindow(branches, [], 'complete');
  assert.deepEqual(closed.rejected, ['强制']);
  assert.deepEqual(closed.alternatives, [branches[1]!.literals, branches[2]!.literals]);
  assert.deepEqual(reverseWindow(branches, ['减一'], 'complete').rejected, ['未触发']);
});
test('反向原型保留记录缺口、未穷尽的局部选择及尚未送齐的后续批次', () => {
  const chain = [
    {
      id: '连锁',
      literals: ['同一执行者'],
      traces: [['替死与护卫', '返回诅咒']],
      exhaustive: true,
    },
  ];
  assert(!reverseWindow(chain, ['替死与护卫'], 'open').conflict);
  assert(reverseWindow(chain, ['替死与护卫'], 'complete').conflict);
  assert(!reverseWindow(chain, ['返回诅咒'], 'gap').conflict);
  assert(!reverseWindow([{ ...chain[0]!, exhaustive: false }], [], 'complete').conflict);
});
