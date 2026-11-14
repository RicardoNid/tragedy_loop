import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewServer, reviewSetup } from '../../apps/server/src/review.js';
import type { Choice, PlayerView, Protagonist } from '../../packages/contracts/src/game.js';

test('review API preserves player isolation, validates commands, and reaches a real engine victory', async () => {
  const app = buildReviewServer();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/games', payload: {} });
    assert.equal(created.statusCode, 200);
    const { id } = created.json();
    const view = async (seat = 'p0'): Promise<PlayerView> =>
      (await app.inject(`/api/games/${id}/${seat}`)).json();
    const initial = await view();
    assert.equal('secret' in initial, false);
    assert.equal('mastermind' in initial.hands, false);
    assert.deepEqual(initial.characters, []);
    const mastermind = await view('mastermind');
    assert.equal('secret' in mastermind, true);
    assert.ok(mastermind.hands.mastermind?.length);
    assert.equal((await app.inject(`/api/games/${id}/invalid-actor`)).statusCode, 404);
    assert.deepEqual((await app.inject(`/api/games/${id}/turn`)).json(), {
      actor: initial.decision!.actor,
      kind: initial.decision!.kind,
      phase: initial.phase,
      finished: false,
    });
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/games/${id}/p0`,
          payload: { id: 'bad', expectedRevision: -1 },
        })
      ).statusCode,
      409,
    );
    assert.deepEqual(await view(), initial);
    const wrongSeat = await app.inject({
      method: 'POST',
      url: `/api/games/${id}/p1`,
      payload: {
        id: 'wrong-seat',
        expectedRevision: initial.revision,
        decisionId: initial.decision!.id,
        choice: { kind: 'continue' },
      },
    });
    assert.equal(wrongSeat.statusCode, 409);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/games/${id}/p0`,
      payload: {
        id: 'stale',
        expectedRevision: initial.revision + 1,
        decisionId: initial.decision!.id,
        choice: { kind: 'continue' },
      },
    });
    assert.equal(stale.statusCode, 409);
    assert.deepEqual(await view(), initial);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/games',
          headers: { origin: 'https://untrusted.example' },
          payload: {},
        })
      ).statusCode,
      403,
    );
    let commands = 0;
    for (let step = 0; step < 160; step++) {
      const v = await view();
      if (v.winner) {
        assert.equal(v.winner, 'protagonists');
        assert.ok(commands >= 6);
        return;
      }
      let operated = false;
      for (const seat of ['p0', 'p1', 'p2']) {
        const current = await view(seat),
          d = current.decision;
        if (!d) continue;
        const menu = d.cardPlacement;
        const card = menu?.cards.find(
          (id) => current.hands[seat as 'p0']?.find((c) => c.id === id)?.kind === 'horizontal',
        );
        const choice = menu
          ? {
              kind: 'cards',
              placements: [
                {
                  card,
                  target: menu.targets.find((t) =>
                    ['hospital', 'shrine', 'city', 'school'].includes(t),
                  ),
                },
              ],
            }
          : (d.options.find((c) => c.kind === 'continue' || c.kind === 'pass') ?? d.options[0]);
        const command = {
          id: `test-${step}`,
          expectedRevision: current.revision,
          decisionId: d.id,
          choice,
        };
        const result = await app.inject({
          method: 'POST',
          url: `/api/games/${id}/${seat}`,
          payload: command,
        });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal('secret' in result.json(), false);
        const duplicate = await app.inject({
          method: 'POST',
          url: `/api/games/${id}/${seat}`,
          payload: command,
        });
        assert.equal(duplicate.statusCode, 200);
        assert.deepEqual(duplicate.json(), result.json());
        if (menu) commands++;
        operated = true;
        break;
      }
      if (!operated) {
        const result = await app.inject({
          method: 'POST',
          url: `/api/games/${id}/fixture`,
          payload: { seat: 'p0', revision: v.revision },
        });
        assert.equal(result.statusCode, 200, result.body);
        for (const p of result
          .json<PlayerView>()
          .placements.filter((p) => p.owner === 'mastermind')) {
          assert.equal(p.card, undefined);
          assert.equal(p.kind, undefined);
        }
      }
    }
    assert.fail('review game did not finish');
  } finally {
    await app.close();
  }
});

test('invalid scripts do not replace an existing game; games stay independent', async () => {
  const app = buildReviewServer();
  try {
    const a = (await app.inject({ method: 'POST', url: '/api/games', payload: {} })).json();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: { setup: { ...reviewSetup, x: [] } },
    });
    assert.equal(bad.statusCode, 400);
    const b = (await app.inject({ method: 'POST', url: '/api/games', payload: {} })).json();
    assert.notEqual(a.id, b.id);
    assert.deepEqual((await app.inject(`/api/games/${a.id}/p0`)).json(), a.view);
  } finally {
    await app.close();
  }
});

test('protagonist card counters and goodwill ability choices settle through the engine', async () => {
  const app = buildReviewServer();
  try {
    const { id } = (await app.inject({ method: 'POST', url: '/api/games', payload: {} })).json();
    const view = async (seat: Protagonist = 'p0'): Promise<PlayerView> =>
      (await app.inject(`/api/games/${id}/${seat}`)).json();
    const submit = async (seat: Protagonist, choice: Choice) => {
      const v = await view(seat);
      const result = await app.inject({
        method: 'POST',
        url: `/api/games/${id}/${seat}`,
        payload: {
          id: `ability-${v.revision}`,
          expectedRevision: v.revision,
          decisionId: v.decision!.id,
          choice,
        },
      });
      assert.equal(result.statusCode, 200, result.body);
      return result.json<PlayerView>();
    };
    const fixture = async () => {
      const v = await view();
      const result = await app.inject({
        method: 'POST',
        url: `/api/games/${id}/fixture`,
        payload: { seat: 'p0', revision: v.revision },
      });
      assert.equal(result.statusCode, 200, result.body);
    };
    const arrived = await submit('p0', { kind: 'start' });
    assert.equal('identity' in arrived.characters[0]!, false);
    await submit('p0', { kind: 'continue' });
    await fixture();
    for (const [seat, kind, target] of [
      ['p0', 'goodwill+2', 'girlStudent'],
      ['p1', 'paranoia+1', 'boyStudent'],
      ['p2', 'horizontal', 'hospital'],
    ] as const) {
      const v = await view(seat);
      const card = v.hands[seat]!.find((c) => c.kind === kind)!.id;
      await submit(seat, { kind: 'cards', placements: [{ card, target }] });
    }
    await fixture();
    let v = await view();
    assert.equal(v.characters.find((c) => c.id === 'girlStudent')!.counters.goodwill, 2);
    assert.equal(v.characters.find((c) => c.id === 'boyStudent')!.counters.paranoia, 1);
    const ability = v.decision!.options.find(
      (c) => c.kind === 'ability' && c.owner === 'girlStudent',
    );
    assert.ok(ability);
    v = await submit('p0', ability);
    // FS-01G has only one other student here; the engine selects him automatically.
    assert.equal(v.characters.find((c) => c.id === 'boyStudent')!.counters.paranoia, 0);
  } finally {
    await app.close();
  }
});
