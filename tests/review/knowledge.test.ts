import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewServer } from '../../apps/server/src/review.js';
import { compileOfficial } from '../../packages/content/src/official/index.js';
import { initializeDiscussion, advance } from '../../packages/engine/src/runtime/engine.js';
import type { GameSetup, Choice } from '../../packages/contracts/src/game.js';
import { project } from '../../packages/engine/src/runtime/ports.js';
import { knowledgeService } from '../../apps/server/src/knowledge.js';

test('first public arrival expands the worker roster and replays the existing prefix', async () => {
  const setup: GameSetup = {
    module: 'FS', anniversary: false, loops: 2, days: 2, captain: 'p0', discussion: 'allowed',
    y: '复仇的火种', x: ['流言四起'], incidents: [],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '医生', identity: '传谣人' },
      { id: 'later', character: '转校生', identity: '平民', enterDay: 1 },
    ],
  };
  const pack = compileOfficial('FS');
  const state = initializeDiscussion(pack, setup).state!;
  const opening = project(state, 'protagonists');
  const service = knowledgeService();
  try {
    const read = async (view: typeof opening) => {
      for (let i = 0; i < 200; i++) {
        const result = service.get('arrival', opening, view);
        if (result.representation === 'constraints') return result;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw Error('worker did not publish its domain');
    };
    assert.ok(!('later' in (await read(opening)).identities));
    const d = state.pending!;
    const next = advance(pack, state, d.actor, {
      id: 'start', expectedRevision: state.revision, decisionId: d.id, choice: { kind: 'continue' },
    });
    const arrived = project(next.state, 'protagonists');
    assert.ok(arrived.characters.some((c) => c.id === 'later'));
    const result = await read(arrived);
    assert.ok(result.identities.later?.includes('平民'));
    assert.equal(result.evidenceThrough, arrived.observations.length);
  } finally {
    service.close();
  }
});

test('background knowledge endpoint uses public version, returns counts and closes worker', async () => {
  const app = buildReviewServer();
  try {
    const created = (await app.inject({ method: 'POST', url: '/api/games' })).json();
    const waiting = (await app.inject(`/api/games/${created.id}/knowledge`)).json();
    assert.equal(waiting.status, 'waiting');
    assert.deepEqual(waiting.identities, {});
    const started = (await app.inject({
      method: 'POST', url: `/api/games/${created.id}/p0`,
      payload: { id: 'start', expectedRevision: created.view.revision, decisionId: created.view.decision.id, choice: { kind: 'start' } },
    })).json();
    let result;
    for (let i = 0; i < 200; i++) {
      result = (await app.inject(`/api/games/${created.id}/knowledge`)).json();
      if (result.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(result.status, 'incomplete');
    assert.equal(result.generated, 0);
    assert.equal(result.historySearchDeferred, true);
    assert.equal(result.representation, 'constraints');
    assert.equal(result.jointCount, null);
    assert.ok(result.propagation.candidateValues > 0);
    assert.equal(result.propagation.verifiedValues, 0);
    const again = (await app.inject(`/api/games/${created.id}/knowledge`)).json();
    assert.deepEqual(again.propagation, result.propagation, 'polling does not start new inference');
    assert.equal(result.revision, started.revision);
    assert.equal('setup' in result, false);
    assert.equal('frontier' in result, false);
    assert.equal((await app.inject('/api/games/missing/knowledge')).statusCode, 404);
  } finally {
    await app.close();
  }
});

test('local board batch pauses global enumeration and explicit verification resumes through IPC', async () => {
  const app = buildReviewServer();
  const setup: GameSetup = {
    module: 'FS',
    anniversary: false,
    loops: 2,
    days: 2,
    captain: 'p0',
    discussion: 'allowed',
    y: '复仇的火种',
    x: ['开膛者的魔影'],
    characters: [
      { id: 'a', character: '男学生', identity: '主谋' },
      { id: 'b', character: '住院患者', identity: '杀人狂' },
      { id: 'c', character: '巫女', identity: '传谣人' },
    ],
    incidents: [],
  };
  const pack = compileOfficial('FS');
  let state = initializeDiscussion(pack, setup).state!;
  try {
    const { id, view: briefing } = (
      await app.inject({ method: 'POST', url: '/api/games', payload: { setup } })
    ).json();
    assert.equal((await app.inject({
      method: 'POST', url: `/api/games/${id}/p0`,
      payload: { id: 'start', expectedRevision: briefing.revision, decisionId: briefing.decision.id, choice: { kind: 'start' } },
    })).statusCode, 200);
    const url = `/api/games/${id}/knowledge`;
    let used = false;
    await app.inject(url);
    for (let step = 0; step < 30; step++) {
      const pending = state.pending!;
      let choice: Choice;
      if (pending.kind === 'cards') {
        const hand = state.cards.filter(
          (c) =>
            c.owner === pending.actor &&
            c.status === 'hand' &&
            !['horizontal', 'vertical', 'diagonal'].includes(c.kind),
        );
        choice = {
          kind: 'cards',
          placements: hand.slice(0, pending.actor === 'mastermind' ? 3 : 1).map((c, i) => ({
            card: c.id,
            target: ['a', 'b', 'c'][
              pending.actor === 'mastermind' ? i : Number(pending.actor.slice(1))
            ]!,
          })),
        };
      } else if (
        !used &&
        pending.options.some((c) => c.kind === 'ability' && c.ability === 'brain')
      ) {
        choice = pending.options.find((c) => c.kind === 'ability' && c.ability === 'brain')!;
        used = true;
      } else if (
        pending.kind === 'choice' &&
        pending.options.some((c) => c.kind === 'select' && c.value === 'school')
      )
        choice = { kind: 'select', value: 'school' };
      else
        choice =
          pending.options.find((c) => c.kind === 'pass' || c.kind === 'continue') ??
          pending.options[0]!;
      const command = {
        id: `ipc-${step}`,
        expectedRevision: state.revision,
        decisionId: pending.id,
        choice,
      };
      const publicView = (await app.inject(`/api/games/${id}/${pending.actor}`)).json();
      const response = await app.inject({
        method: 'POST',
        url: `/api/games/${id}/${pending.actor}`,
        payload: {
          ...command,
          expectedRevision: publicView.revision,
          decisionId: publicView.decision.id,
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      state = advance(pack, state, pending.actor, command).state;
      await app.inject(url);
      if (state.boards.school > 0) break;
    }
    assert.equal(state.boards.school, 1);
    let result;
    for (let i = 0; i < 100; i++) {
      result = (await app.inject(url)).json();
      if (result.relations?.length && result.transition) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(result.relations.some((r: { observation: number }) => r.observation > 0));
    const relationIds = result.relations.map((r: { id: string }) => r.id);
    assert.equal(result.transition.toVersion, result.transition.fromVersion + 1);
    assert.equal(result.revision, (await app.inject(`/api/games/${id}/p0`)).json().revision);
    assert.equal((await app.inject({ method: 'POST', url: `${url}/verify` })).statusCode, 200);
    for (let i = 0; i < 200; i++) {
      result = (await app.inject(url)).json();
      if (!result.scope?.deferred && result.status === 'exact') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(result.status, 'exact', JSON.stringify(result));
    assert.ok(
      relationIds.every((id: string) => result.relations.some((r: { id: string }) => r.id === id)),
    );
    assert.ok(result.identities.a.includes('主谋'));
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/games/missing/knowledge/verify' })).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
