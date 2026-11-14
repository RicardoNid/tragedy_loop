import type {
  Command,
  GameSetup,
  PlayerView,
  Protagonist,
  Actor,
} from '../../../packages/contracts/src/game.js';
import type { MastermindReviewView } from '../../../packages/contracts/src/review.js';
import type { KnowledgeView } from '../../../packages/contracts/src/knowledge.js';
import type { ReviewEngineTrace } from '../../../packages/contracts/src/review';
// UI transport only. No runtime/content import and no authoritative state.
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/games${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('开发服务未连接，请启动 pnpm dev:review。');
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('本地规则服务尚未就绪，请确认 pnpm dev:review 正在运行。');
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? '请求失败');
  return data as T;
}
export const api = {
  engineTrace: (id: string) => request<ReviewEngineTrace>(`/${id}/mastermind/trace`),
  turn: (id: string) =>
    request<{ actor: Actor | null; kind: string | null; phase: string; finished: boolean }>(
      `/${id}/turn`,
    ),
  knowledge: (id: string) => request<KnowledgeView>(`/${id}/knowledge`),
  verifyKnowledge: (id: string) => request<KnowledgeView>(`/${id}/knowledge/verify`, {}),
  create: (setup?: GameSetup, profile: 'FS' | 'BTX' = 'FS') =>
    request<{ id: string; view: PlayerView }>('', { setup, profile }),
  view: (id: string, seat: Actor) => request<PlayerView | MastermindReviewView>(`/${id}/${seat}`),
  submit: (id: string, seat: Actor, command: Command) =>
    request<PlayerView | MastermindReviewView>(`/${id}/${seat}`, command),
  fixture: (id: string, seat: Protagonist, revision: number) =>
    request<PlayerView>(`/${id}/fixture`, { seat, revision }),
};
