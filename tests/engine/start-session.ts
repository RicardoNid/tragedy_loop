import { initialPlacementView } from '../../packages/engine/src/runtime/ports.js';
import assert from 'node:assert/strict';
import type { createSession } from '../../packages/engine/src/runtime/ports.js';

/** Advance the public briefing before inspecting an opening board in solver tests. */
type Session = ReturnType<typeof createSession>;
export function startSession(
  session: Session,
): asserts session is Extract<Session, { status: 'ready' }> {
  assert.equal(session.status, 'ready');
  const port = session.protagonists[session.mastermind.view().captain];
  const view = port.view();
  const result = port.submit({
    id: 'start-game',
    expectedRevision: view.revision,
    decisionId: view.decision!.id,
    choice: { kind: 'start' },
  });
  assert.equal(result.status, 'ok');
}

/** Synthetic post-placement board with the original captain decision for solver-only cases. */
export function solverOpening(session: Extract<Session, { status: 'ready' }>) {
  const placement = initialPlacementView(session.host.snapshot());
  return { ...session.protagonists.p0.view(), characters: placement.characters, territory: placement.territory };
}
