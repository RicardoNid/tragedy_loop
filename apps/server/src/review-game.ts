import { observedRoster } from '../../../packages/engine/src/runtime/knowledge-domain.js';
import type { ReviewSolverInputs } from '../../../packages/contracts/src/review.js';
import { createSession } from '../../../packages/engine/src/runtime/ports.js';
import { compileOfficial } from '../../../packages/content/src/official/index.js';
import type { Choice, GameSetup, Protagonist } from '../../../packages/contracts/src/game.js';
import type { MastermindReviewView } from '../../../packages/contracts/src/review.js';
import fsOfficial from './fixtures/fs-01g.json' with { type: 'json' };
import btxOfficial from './fixtures/btx-01g.json' with { type: 'json' };

import mcOfficial from './fixtures/mc-01g.json' with { type: 'json' };
import mzOfficial from './fixtures/mz-01g.json' with { type: 'json' };
export const reviewSetup = fsOfficial.setup as GameSetup;
export const btxReviewSetup = btxOfficial.setup as GameSetup;
export const reviewProfiles = { FS: reviewSetup, BTX: btxReviewSetup, MC: mcOfficial.setup as GameSetup, MZ: mzOfficial.setup as GameSetup };
export type Session = Extract<ReturnType<typeof createSession>, { status: 'ready' }>;

export function openGame(setup: GameSetup) {
  return createSession(compileOfficial(setup.module, setup.anniversary), setup);
}
/** Private diagnostic export of the local test host. Never used as solver input. */
export function engineTrace(game: Session) {
  const { setup, ruleDigest, revision, loop, day, phase, audit, choices, observations, winner } = game.host.snapshot();
  return { setup, ruleDigest, revision, loop, day, phase, audit, choices, observations: observations.protagonists, winner };
}
// Test-host inspection is deliberately separate from the normal mastermind port.
export function inspectMastermind(game: Session): MastermindReviewView {
  const view = game.mastermind.view();
  const state = game.host.snapshot();
  const cards = new Map(state.cards.map((c) => [c.id, c]));
  return {
    ...view,
    placements: state.placements.map(({ card, target }) => {
      const { owner, kind } = cards.get(card)!;
      return { owner, kind, card, target };
    }),
    hands: Object.fromEntries(
      (['mastermind', 'p0', 'p1', 'p2'] as const).map((owner) => [
        owner,
        state.cards
          .filter((c) => c.owner === owner)
          .map(({ id, kind, status }) => ({ id, kind, status })),
      ]),
    ),
    secret: {
      ...view.secret,
      roster: view.characters.map((c) => {
        const actor = state.characters[c.id]!;
        return {
          ...state.setup.characters.find((entry) => entry.id === c.id),
          ...c,
          identity: actor.identity,
          initialIdentity: actor.initialIdentity,
          initialArea: actor.initialArea,
          appeared: state.appeared.includes(c.id),
        };
      }),
      occurred: state.incidents,
      activeAlternateY: state.flags['alternate-y'],
      seatRoles: state.ll?.roles,
    },
  };
}
export function gameTurn(game: Session) {
  const views = [
    game.mastermind.view(),
    ...Object.values(game.protagonists).map((port) => port.view()),
  ];
  const decision = views.find((v) => v.decision)?.decision;
  return {
    actor: decision?.actor ?? null,
    kind: decision?.kind ?? null,
    phase: views[0]!.phase,
    finished: !!views[0]!.winner,
  };
}
export function fixtureStep(game: Session, seat: Protagonist, revision: number) {
  const port = game.protagonists[seat];
  if (port.view().revision !== revision) throw new Error('盘面已更新，请刷新。');
  const view = game.mastermind.view(),
    d = view.decision;
  if (!d) throw new Error('当前无需剧作家测试推进，请操作主人公席位。');
  let choice: Choice | undefined;
  if (d.cardPlacement) {
    const targets = d.cardPlacement.targets.filter((t) =>
      ['hospital', 'shrine', 'city', 'school'].includes(t),
    );
    const cards = (view.hands.mastermind ?? []).filter(
      (c) => c.status === 'hand' && ['horizontal', 'vertical', 'paranoia-1'].includes(c.kind),
    );
    if (targets.length >= d.cardPlacement.count && cards.length >= d.cardPlacement.count)
      choice = {
        kind: 'cards',
        placements: cards
          .slice(0, d.cardPlacement.count)
          .map((c, i) => ({ card: c.id, target: targets[i]! })),
      };
  } else choice = d.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ?? d.options[0];
  if (!choice) throw new Error('此剧本无法使用固定测试推进。');
  const result = game.mastermind.submit({
    id: crypto.randomUUID(),
    expectedRevision: view.revision,
    decisionId: d.id,
    choice,
  });
  if (result.status === 'rejected') throw new Error('测试推进被引擎拒绝。');
  return port.view();
}

export function solverInputs(game: Session): ReviewSolverInputs {
  const opening = game.host.publicOpening();
  const current = game.protagonists.p0.view();
  return {
    solver1: {
      opening: { ...opening, roster: observedRoster(opening, current) },
      history: current.observations,
      revision: current.revision,
    },
  };
}
