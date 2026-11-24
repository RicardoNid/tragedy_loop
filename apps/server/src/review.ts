import { awaitingFirstPlacement } from '../../../packages/contracts/src/game.js';
import { waitingForCharacters } from '../../../packages/engine/src/runtime/knowledge-live.js';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  inspectMastermind,
  openGame,
  gameTurn,
  fixtureStep,
  engineTrace,
  solverInputs,
  reviewSetup,
  btxReviewSetup,
  reviewProfiles,
  type Session,
} from './review-game.js';
import {solution3} from './solution3.js';
import { knowledgeService } from './knowledge.js';
import type { Command, GameSetup, Protagonist } from '../../../packages/contracts/src/game.js';
export { reviewSetup, btxReviewSetup };
const seats = ['p0', 'p1', 'p2'];
const actors = ['mastermind', ...seats];
export function buildReviewServer() {
  const app = Fastify({ bodyLimit: 128 * 1024 });
  const games = new Map<string, Session>();
  const knowledge = knowledgeService();
  app.get<{Params:{id:string};Querystring:{through:string;details?:string}}>('/api/games/:id/solution3',async(req,reply)=>{
    const game=games.get(req.params.id);
    if(!game)return reply.code(404).send({message:'对局不存在。'});
    try{return solution3(game,Number(req.query.through),req.query.details==='1');}
    catch(error){return reply.code(400).send({message:String(error)});}
  });
  app.get<{ Params: { id: string } }>('/api/games/:id/public-opening', async (req, reply) => {
    const game = games.get(req.params.id);
    return game ? game.host.publicOpening() : reply.code(404).send({ message: '对局不存在。' });
  });
  app.get<{ Params: { id: string } }>('/api/games/:id/mastermind/solver-inputs', async (req, reply) => {
    const game = games.get(req.params.id);
    return game ? solverInputs(game) : reply.code(404).send({ message: '对局不存在。' });
  });
  app.get('/api/health', async () => ({ ready: true }));
  app.addHook('onClose', async () => { for (const game of games.values()) game.host.close(); await knowledge.close(); });
  for (const verify of [false, true]) {
    app.route<{ Params: { id: string } }>({
      method: verify ? 'POST' : 'GET',
      url: '/api/games/:id/knowledge' + (verify ? '/verify' : ''),
      handler: async (req, reply) => {
        const game = games.get(req.params.id);
        if (!game) return reply.code(404).send({ message: '对局不存在。' });
        const view = game.protagonists.p0.view();
        if (awaitingFirstPlacement(view)) return waitingForCharacters(view.revision);
        return knowledge.get(req.params.id, game.host.publicOpening(), view, verify);
      },
    });
  }
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    const webPort = process.env.REVIEW_WEB_PORT ?? '5173';
    if (origin && ![`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`].includes(origin))
      return reply.code(403).send({ message: '请求来源不允许。' });
  });
  app.post('/api/games', async (req, reply) => {
    try {
      const body = req.body as { setup?: GameSetup; profile?: string } | null;
      if (body?.profile && !Object.hasOwn(reviewProfiles, body.profile))
        return reply.code(400).send({ message: '测试配置支持 FS、BTX、MC 和 MZ。' });
      const setup = body?.setup ?? reviewProfiles[(body?.profile ?? 'FS') as keyof typeof reviewProfiles];
      const result = openGame(setup);
      if (result.status !== 'ready')
        return reply
          .code(400)
          .send({ message: '剧本未通过规则校验。', diagnostics: result.diagnostics });
      if (games.size >= 100)
        return reply.code(429).send({ message: '测试对局已达上限，请重启本地服务。' });
      const id = randomUUID();
      games.set(id, result);
      return { id, view: result.protagonists.p0.view() };
    } catch {
      return reply.code(400).send({ message: '无法读取剧本，请使用当前 GameSetup 格式。' });
    }
  });
  // Only actor/timing metadata crosses this route, never another seat's choices.
  app.get<{ Params: { id: string } }>('/api/games/:id/turn', async (req, reply) => {
    const game = games.get(req.params.id);
    if (!game) return reply.code(404).send({ message: '对局不存在。' });
    return gameTurn(game);
  });
  app.get<{ Params: { id: string } }>('/api/games/:id/mastermind/trace', async (req, reply) => {
    const game = games.get(req.params.id);
    return game ? engineTrace(game) : reply.code(404).send({ message: '对局不存在。' });
  });
  app.route<{ Params: { id: string; seat: string }; Body: Command }>({
    method: ['GET', 'POST'],
    url: '/api/games/:id/:seat',
    handler: async (req, reply) => {
      const game = games.get(req.params.id);
      if (!game || !actors.includes(req.params.seat))
        return reply.code(404).send({ message: '对局或席位不存在。' });
      const port =
        req.params.seat === 'mastermind'
          ? game.mastermind
          : game.protagonists[req.params.seat as Protagonist];
      if (req.method === 'GET')
        return req.params.seat === 'mastermind' ? inspectMastermind(game) : port.view();
      const result = port.submit(req.body);
      if (result.status === 'rejected')
        return reply.code(409).send({ message: `操作未提交：${result.reason}`, view: port.view() });
      return req.params.seat === 'mastermind' ? inspectMastermind(game) : result.view;
    },
  });
  app.post<{ Params: { id: string }; Body: { seat: Protagonist; revision: number } }>(
    '/api/games/:id/fixture',
    async (req, reply) => {
      const game = games.get(req.params.id);
      if (!game || !req.body || !seats.includes(req.body.seat))
        return reply.code(404).send({ message: '对局或席位不存在。' });
      try {
        return fixtureStep(game, req.body.seat, req.body.revision);
      } catch (error) {
        return reply.code(409).send({ message: (error as Error).message });
      }
    },
  );
  return app;
}
