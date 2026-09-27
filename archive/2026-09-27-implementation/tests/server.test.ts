import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup() {
  const app = await buildApp({ root, origin: 'http://127.0.0.1:5180' });
  apps.push(app);
  return app;
}
const host = { host: '127.0.0.1:5180' };
describe('unified local server boundary', () => {
  it('serves projected state and reference pages but no checkout or legacy write APIs', async () => {
    const app = await setup();
    const state = await app.inject({ url: '/api/state?seat=protagonistA', headers: host });
    expect(state.statusCode).toBe(200);
    expect(
      state.json().snapshot.characters.find((c: { id: string }) => c.id === 'doctor').identity,
    ).toBeUndefined();
    for (const path of [
      '/site/',
      '/products/rules-atlas/index.html',
      '/site/slides/beginner-teaching.html',
    ]) {
      const result = await app.inject({ url: path, headers: host });
      expect(result.statusCode).toBe(200);
    }
    for (const path of ['/.git/config', '/.env']) {
      expect((await app.inject({ url: path, headers: host })).statusCode).toBe(403);
    }
    for (const path of ['/api/modules', '/site/editor.html']) {
      expect((await app.inject({ url: path, headers: host })).statusCode).toBe(404);
    }
  });
  it('rejects foreign origins, invalid seats and stale commands without advancing state', async () => {
    const app = await setup();
    expect(
      (await app.inject({ url: '/api/state', headers: { host: 'evil.test' } })).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: '/api/state?seat=unknown', headers: host })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/reset',
          headers: { ...host, origin: 'https://evil.test' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const before = (await app.inject({ url: '/api/state', headers: host })).json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/choose?seat=protagonistA',
      headers: { ...host, origin: 'http://127.0.0.1:5180' },
      payload: {
        protocolVersion: 2,
        sessionId: before.snapshot.sessionId,
        branchId: before.snapshot.branchId,
        commandId: 'stale-test',
        expectedRevision: -1,
        waitingInputId: 'missing',
        command: { kind: 'choose', optionIds: [] },
      },
    });
    expect([400, 409]).toContain(response.statusCode);
    expect((await app.inject({ url: '/api/state', headers: host })).json().snapshot.revision).toBe(
      before.snapshot.revision,
    );
  });
});
