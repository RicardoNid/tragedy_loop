import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { Engine, createGame } from '@tragedy/engine';
import { createCatalog, firstStepsScenario } from '@tragedy/content';
import { seatSchema } from '@tragedy/contracts';

export async function buildApp(options: { root: string; origin: string; development?: boolean }) {
  const app = Fastify({ bodyLimit: 16384 });
  const catalog = createCatalog();
  function newGame() {
    const game = new Engine(createGame(firstStepsScenario(), catalog), catalog);
    game.start();
    return game;
  }
  let engine = newGame();
  const allowed = new Set([options.origin, options.origin.replace('127.0.0.1', 'localhost')]);
  app.addHook('onRequest', async (request, reply) => {
    if (!allowed.has(`http://${request.headers.host}`))
      return reply.code(403).send({ error: '无效访问地址' });
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (request.method === 'POST' && !allowed.has(request.headers.origin ?? ''))
        return reply.code(403).send({ error: '请从本机游戏页面操作' });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 400;
    reply.code(status).send({ error: error instanceof Error ? error.message : '操作失败' });
  });
  app.get<{ Querystring: { seat?: string } }>('/api/state', (request) => {
    const seat = seatSchema.parse(request.query.seat ?? 'protagonistA');
    return { snapshot: engine.view(seat), actor: engine.waiting?.actor ?? null };
  });
  app.post<{ Querystring: { seat?: string } }>('/api/choose', (request, reply) => {
    const seat = seatSchema.parse(request.query.seat ?? 'protagonistA');
    const receipt = engine.submit(seat, request.body);
    return reply.code(receipt.status === 'accepted' ? 200 : 409).send(receipt);
  });
  app.post('/api/reset', () => {
    engine = newGame();
    return { ok: true };
  });
  // Explicit read-only roots: never expose the checkout or any editing endpoint.
  for (const [prefix, directory] of [
    ['/site/', 'products/public'],
    ['/products/rules-atlas/', 'products/rules-atlas'],
    ['/facts/', 'facts'],
    ['/docs/', 'docs'],
    ['/packages/content/src/', 'packages/content/src'],
  ] as const)
    await app.register(staticFiles, {
      root: resolve(options.root, directory),
      prefix,
      decorateReply: false,
      dotfiles: 'deny',
    });
  if (options.development) {
    const { default: middie } = await import('@fastify/middie');
    const { createServer } = await import('vite');
    await app.register(middie);
    const vite = await createServer({
      root: resolve(options.root, 'apps/web'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: false },
    });
    app.use((req, res, next) => {
      if (/^\/(api|site|products|facts|docs)(\/|$)/.test(req.url ?? '/')) next();
      else vite.middlewares(req, res, next);
    });
    app.addHook('onClose', async () => {
      await vite.close();
    });
  } else {
    await app.register(staticFiles, {
      root: resolve(options.root, 'apps/web/dist'),
      prefix: '/',
      decorateReply: false,
      dotfiles: 'deny',
    });
  }
  return app;
}
