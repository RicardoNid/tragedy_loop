import { fork } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import type { DecisionAnalysis } from '../../../../packages/contracts/src/decision.js';
import type { AnalysisRequest } from './analyze.js';
import { scenarios } from './scenarios.js';

export async function makeDecisionServer() {
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024 });
  const dist = new URL('../../../web/dist/decision/', import.meta.url);
  const assets = await readdir(new URL('assets/', dist));
  app.get('/', async (_, reply) =>
    reply.type('text/html; charset=utf-8').send(await readFile(new URL('decision.html', dist))),
  );
  for (const file of assets) {
    const mime = extname(file) === '.js' ? 'text/javascript' : 'text/css';
    app.get('/assets/' + file, async (_, reply) =>
      reply.type(mime).send(await readFile(new URL('assets/' + file, dist))),
    );
  }
  app.get('/api/scenarios', async () => scenarios);
  let active: ReturnType<typeof fork> | undefined;
  app.addHook('onClose', async () => {
    active?.kill();
  });
  app.post<{ Body: AnalysisRequest }>('/api/decision', async (request, reply) => {
    if (active) return reply.code(503).send({ error: '上一局面仍在计算，请稍后重试' });
    if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)
      return reply.code(403).send({ error: '请从本地决策台提交' });
    if (!request.headers['content-type']?.startsWith('application/json'))
      return reply.code(415).send({ error: '请求需要 JSON 格式' });
    const child = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    active = child;
    type Outcome = { ok: true; result: DecisionAnalysis } | { ok: false; error: string };
    const cancel = () => child.kill();
    reply.raw.once('close', cancel);
    const timer = setTimeout(cancel, 90000);
    try {
      const outcome = await new Promise<Outcome>((done) => {
        child.once('error', () => done({ ok: false, error: '计算进程启动失败' }));
        child.once('exit', () =>
          done({ ok: false, error: '计算中断或超过 90 秒，请缩小候选范围或预算' }),
        );
        child.once('message', (msg) => done(msg as Outcome));
        child.send(request.body, (err) => {
          if (err) done({ ok: false, error: '问题无法发送给计算进程' });
        });
      });
      return outcome.ok ? outcome.result : reply.code(422).send({ error: outcome.error });
    } finally {
      clearTimeout(timer);
      reply.raw.off('close', cancel);
      active = undefined;
      child.kill();
    }
  });
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await makeDecisionServer();
  const address = await app.listen({
    host: '127.0.0.1',
    port: Number(process.env.DECISION_PORT ?? 4179),
  });
  console.log('惨剧轮回决策台 ' + address);
}
