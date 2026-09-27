import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { Engine, createGame } from '../../packages/engine/src/index.js';
import { createCatalog, firstStepsScenario } from '../../packages/content/src/index.js';
import { seatSchema } from '../../packages/contracts/src/index.js';

const catalog = createCatalog();
function newGame() {
  const game = new Engine(createGame(firstStepsScenario(), catalog), catalog);
  game.start();
  return game;
}
let engine = newGame();
const host = '127.0.0.1';
const port = Number(process.env.GUI_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 45000) throw new Error('Invalid GUI_PORT');
const origin = `http://${host}:${port}`;
const vite = await createViteServer({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { middlewareMode: true, hmr: { port: port + 20000 }, allowedHosts: [host, 'localhost'] },
  appType: 'spa',
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', origin);
  if (!url.pathname.startsWith('/api/')) return vite.middlewares(req, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const reply = (code: number, value: unknown) => {
    res.statusCode = code;
    res.end(JSON.stringify(value));
  };
  try {
    if (req.headers.host !== `${host}:${port}` && req.headers.host !== `localhost:${port}`)
      return reply(403, { error: '无效访问地址' });
    const seat = seatSchema.parse(url.searchParams.get('seat') ?? 'protagonistA');
    if (req.method === 'GET' && url.pathname === '/api/state')
      return reply(200, { snapshot: engine.view(seat), actor: engine.waiting?.actor ?? null });
    if (req.method !== 'POST') return reply(405, { error: '不支持的操作' });
    if (req.headers.origin !== origin && req.headers.origin !== `http://localhost:${port}`)
      return reply(403, { error: '请从本机游戏页面操作' });
    if (!req.headers['content-type']?.startsWith('application/json'))
      return reply(415, { error: '需要 JSON 请求' });
    let body = '';
    for await (const chunk of req) {
      body += String(chunk);
      if (body.length > 16384) return reply(413, { error: '请求过大' });
    }
    if (url.pathname === '/api/reset') {
      engine = newGame();
      return reply(200, { ok: true });
    }
    if (url.pathname === '/api/choose') {
      const receipt = engine.submit(seat, JSON.parse(body));
      return reply(receipt.status === 'accepted' ? 200 : 409, receipt);
    }
    reply(404, { error: '未知接口' });
  } catch (error) {
    reply(400, { error: error instanceof Error ? error.message : '操作失败' });
  }
});
server.listen(port, host, () => console.log(`轮回 · 本地演示 ${origin}`));
