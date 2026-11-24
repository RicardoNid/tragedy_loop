import assert from 'node:assert/strict';
import { CardReports } from '../../packages/engine/src/runtime/knowledge-cards.ts';
import { multipleBlocksApply } from '../../packages/engine/src/runtime/card-settlement.ts';
import { drive } from '../../packages/engine/src/runtime/engine.ts';
import { COUNTERS, clone } from '../../packages/engine/src/runtime/model.ts';
import { lab } from '../../tests/comprehensive/harness.ts';

const movement = ['horizontal', 'vertical', 'diagonal'];
const rules = {
  horizontal:
    '同一目标的移动牌合成目的地，出现禁止移动时排除此移动来源。目标区域变化后核对随行和禁行。',
  vertical: '同一目标的移动牌合成目的地，核对纵向移动后的公开区域及原指示物。',
  diagonal: '同一目标的移动牌合成目的地，核对斜向移动后的公开区域及原指示物。',
  'block-movement': '使目标的牌面移动留在原地。实际发生移动时应另查允许的效果和随行来源。',
  'block-paranoia': '排除本目标的不安牌增减；对应观察如仍有变化，另查其他来源。',
  'block-goodwill': '禁止本目标的友好变化；可无视禁止的身份或心无灵犀对移动的修正另行核对。',
  'block-intrigue':
    '核对全场禁止密谋张数，通常多张同时失效，WM 的 Ex 达到 3 时多张仍生效；检查同区邪教徒绕过。',
  'hope+1': '先数全场希望牌。只有一张时增加希望，多张时转为友好，再核对有效禁止和可见数量。',
  'despair+1': '增加目标绝望。按全部正向变化核对目标指示物，再由之后的门槛判断是否需检查身份。',
};
const kinds = [
  ...movement,
  'block-movement',
  'goodwill+1',
  'goodwill+2',
  'block-goodwill',
  'paranoia+1',
  'paranoia+2',
  'paranoia-1',
  'block-paranoia',
  'intrigue+1',
  'intrigue+2',
  'block-intrigue',
  'hope+1',
  'despair+1',
];
export function cardCases(measureWindow) {
  return kinds.map((kind) => {
    const samples = [];
    const partners = [[], ...kinds.map((k) => [k])];
    if (kind === 'intrigue+1' || kind === 'intrigue+2')
      partners.push(['block-intrigue', 'block-intrigue']);
    if (kind === 'hope+1') partners.push(['hope+1', 'block-goodwill']);
    for (const module of ['BTX', 'WM'])
      for (const companions of partners) {
        const [other, third] = companions;
        const { pack, state } = lab(module);
        state.phase = 'card-resolution';
        state.pending = null;
        state.phaseEntered = false;
        state.ex = module === 'WM' ? 3 : 0;
        const a = state.characters.a;
        a.counters.paranoia = 2;
        // Isolate the public reveal. Fill other seats with blocks on different targets.
        const placed = [
          { kind, target: 'a' },
          { kind: other ?? 'block-movement', target: other ? 'a' : 'b' },
          { kind: third ?? 'block-movement', target: third ? 'a' : 'c' },
          { kind: 'block-movement', target: 'd' },
        ];
        const cards = placed.map((p, i) => ({
          id: 'audit-card-' + i,
          kind: p.kind,
          owner: ['mastermind', 'p0', 'p1', 'p2'][i],
          status: 'set',
          once: false,
        }));
        state.cards.push(...cards);
        state.placements = cards.map((c, i) => ({ card: c.id, target: placed[i].target }));
        const model = new CardReports(
          new Map(Object.entries(state.characters)),
          state.boards,
          pack,
        );
        model.collect(
          {
            type: 'cards',
            day: state.day,
            loop: state.loop,
            data: { placements: cards.map((c, i) => ({ ...placed[i], owner: c.owner })) },
          },
          () => false,
          () => false,
          multipleBlocksApply(module, state.ex),
        );
        const predicted = model.targets.get('a');
        const next = clone(state);
        for (let i = 0; i < 20 && next.phase === 'card-resolution'; i++) {
          assert.equal(next.pending, null);
          drive(pack, next, 1);
        }
        assert.equal(next.phase, 'mastermind-abilities');
        assert.equal(next.characters.a.area, predicted.move ?? a.area);
        for (const counter of COUNTERS)
          assert.equal(
            next.characters.a.counters[counter],
            Math.max(
              0,
              a.counters[counter] +
                (predicted.plus[counter] ?? 0) +
                (predicted.minus[counter] ?? 0),
            ),
            JSON.stringify({ module, kind, other, counter }),
          );
        samples.push({
          module,
          companions,
          ...measureWindow(pack, state, [module, kind, ...companions].join('/')),
        });
      }
    return {
      kind,
      logic:
        rules[kind] ??
        '按目标汇总 ' +
          kind +
          '，先加后减；检查禁止牌与实际截断值，有可行的绕过身份时保留对应原因。',
      samples,
    };
  });
}
