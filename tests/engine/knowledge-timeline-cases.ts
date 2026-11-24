import assert from 'node:assert/strict';
import type { Choice, GameSetup } from '../../packages/contracts/src/game.js';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import { advance, initializeDiscussion } from '../../packages/engine/src/runtime/engine.js';
import type { EngineState } from '../../packages/engine/src/runtime/model.js';
import { initialPlacementView, project } from '../../packages/engine/src/runtime/ports.js';

export interface FocusedTimelineCase {
  id: string;
  name: string;
  setup: GameSetup;
  focus: 'protagonist-abilities' | 'incident';
  play: (state: EngineState) => Choice;
  verify: (state: EngineState) => void;
}

export const focusedTimelineCases: FocusedTimelineCase[] = [];
for (const module of ['FS', 'BTX'] as const) {
  const modes = [
    'goodwill-effective',
    'goodwill-quiet',
    'incident-absent',
    'incident-quiet',
    'incident-empty',
    ...(module === 'BTX' ? ['incident-fixed', 'incident-capped'] : []),
  ];
  for (const mode of modes) {
    const goodwill = mode.startsWith('goodwill'),
      capped = mode === 'incident-capped';
    const setup: GameSetup = {
      module,
      anniversary: false,
      loops: 1,
      days: capped ? 2 : 1,
      captain: 'p0',
      discussion: 'allowed',
      y: module === 'FS' ? '复仇的火种' : '和我签订契约吧！',
      x: module === 'FS' ? ['流言四起'] : ['流言四起', '妄想扩大病毒'],
      characters: [
        {
          id: 'a',
          character: module === 'BTX' ? (goodwill ? '女学生' : '巫女') : '男学生',
          identity: module === 'FS' ? '主谋' : '关键人物',
        },
        {
          id: 'b',
          character: module === 'BTX' ? '男学生' : goodwill ? '女学生' : '巫女',
          identity: '传谣人',
        },
      ],
      incidents: goodwill
        ? []
        : [
            {
              day: capped ? 2 : 1,
              name: mode === 'incident-fixed' || capped ? '邪气污染' : '医院事故',
              culprit: 'a',
            },
          ],
    };
    const fixture: FocusedTimelineCase = {
      id: module + '-' + mode,
      name:
        module +
        ' ' +
        ({
          'goodwill-effective': '友好能力公开减不安',
          'goodwill-quiet': '友好能力零值无变化',
          'incident-absent': '事件全部低于门槛',
          'incident-quiet': '事件发生但医院零密谋',
          'incident-empty': '事件发生但医院无目标',
          'incident-fixed': '事件固定公开增加',
          'incident-capped': '事件公开封顶无变化',
        }[mode] ?? mode),
      setup,
      focus: goodwill ? 'protagonist-abilities' : 'incident',
      play(state) {
        const pending = state.pending!;
        if (pending.kind === 'cards') {
          let entries: string[][];
          if (pending.actor === 'mastermind') {
            entries = goodwill
              ? [
                  [mode === 'goodwill-quiet' ? 'paranoia-1' : 'paranoia+1', 'b'],
                  ['block-paranoia', 'a'],
                  ['intrigue+1', 'hospital'],
                ]
              : mode === 'incident-absent'
                ? [
                    ['block-paranoia', 'a'],
                    ['paranoia-1', 'b'],
                    ['intrigue+1', 'city'],
                  ]
                : [
                    ['paranoia+1', 'a'],
                    ['paranoia+1', 'b'],
                    [
                      capped && state.day === 1 ? 'intrigue+2' : 'intrigue+1',
                      capped ? 'shrine' : mode === 'incident-empty' ? 'hospital' : 'city',
                    ],
                  ];
          } else {
            const target = { p0: 'a', p1: 'b', p2: 'school' }[pending.actor as 'p0' | 'p1' | 'p2'];
            entries = [
              [
                goodwill && pending.actor === 'p0'
                  ? 'goodwill+2'
                  : !goodwill && mode !== 'incident-absent' && pending.actor !== 'p2'
                    ? 'paranoia+1'
                    : capped && pending.actor === 'p2' ? 'horizontal' : 'block-movement',
                target,
              ],
            ];
          }
          const used = new Set<string>();
          return {
            kind: 'cards',
            placements: entries.map(([kind, target]) => {
              const card = state.cards.find(
                (c) =>
                  c.owner === pending.actor &&
                  c.kind === kind &&
                  c.status === 'hand' &&
                  !used.has(c.id),
              );
              assert.ok(card, pending.actor + ' missing ' + kind);
              used.add(card.id);
              return { card: card.id, target: target! };
            }),
          };
        }
        if (
          goodwill &&
          state.phase === 'protagonist-abilities' &&
          pending.actor !== 'mastermind' &&
          !state.observations.protagonists.some(
            (o) =>
              o.type === 'own-choice' && (o.data.choice as Choice | undefined)?.kind === 'ability',
          )
        ) {
          const ability = pending.options.find(
            (c) => c.kind === 'ability' && c.owner === 'a' && c.ability === 'student',
          );
          if (ability?.kind === 'ability') return { ...ability, choices: { target: 'b' } };
        }
        const allow = pending.options.find((c) => c.kind === 'refuse' && !c.refuse);
        return (
          allow ??
          pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
          pending.options[0]!
        );
      },
      verify(state) {
        const history = state.observations.protagonists;
        if (goodwill) {
          assert.ok(
            history.some((o) => {
              const choice = o.data.choice as Choice | undefined;
              return o.type === 'own-choice' && choice?.kind === 'ability' && choice.owner === 'a';
            }),
          );
          assert.equal(state.characters.b!.counters.paranoia, 0);
          assert.equal(
            history.some((o) => o.type === 'refused'),
            false,
          );
          assert.equal(
            history.some((o) => o.phase === 'protagonist-abilities' && o.type === 'character'),
            mode === 'goodwill-effective',
          );
        } else {
          assert.equal(
            history.find((o) => o.type === 'incident')?.data.occurred,
            mode !== 'incident-absent',
          );
          if (mode === 'incident-fixed')
            assert.ok(
              history.some(
                (o) =>
                  o.phase === 'incident' &&
                  o.type === 'board' &&
                  o.data.board === 'shrine' &&
                  o.data.intrigue === 2,
              ),
            );
          if (['incident-quiet', 'incident-empty', 'incident-capped'].includes(mode))
            assert.ok(history.some((o) => o.type === 'no-effect' && o.phase === 'incident'));
          if (capped) assert.equal(state.boards.shrine, 3);
        }
      },
    };
    focusedTimelineCases.push(fixture);
  }
}

export function focusedHistory(fixture: FocusedTimelineCase) {
  const pack = compileOfficial(fixture.setup.module, fixture.setup.anniversary);
  const initial = initializeDiscussion(pack, fixture.setup);
  assert.ok(initial.state, JSON.stringify(initial.diagnostics));
  let state = initial.state;
  const opening = initialPlacementView(state);
  for (let i = 0; !state.winner && i < 120; i++) {
    assert.ok(state.pending);
    const choice = fixture.play(state);
    const next = advance(pack, state, state.pending.actor, {
      id: 'focused-' + i,
      expectedRevision: state.revision,
      decisionId: state.pending.id,
      choice,
    });
    assert.equal(
      next.status,
      'ok',
      JSON.stringify({
        reason: next.status === 'rejected' ? next.reason : undefined,
        phase: state.phase,
        choice,
      }),
    );
    state = next.state;
  }
  assert.ok(state.winner);
  fixture.verify(state);
  return { pack, opening, history: project(state, 'protagonists').observations, state };
}
