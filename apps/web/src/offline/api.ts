import ReviewWorker from './game.worker?worker&inline';
import type { Reply, ReviewApi } from './messages';

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, (reply: Reply) => void>();
function call<K extends keyof ReviewApi>(method: K, ...args: Parameters<ReviewApi[K]>) {
  return new Promise<Awaited<ReturnType<ReviewApi[K]>>>((resolve, reject) => {
    if (!worker) {
      worker = new ReviewWorker();
      worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        pending.get(data.sequence)?.(data);
        pending.delete(data.sequence);
      };
      worker.onerror = (event) => {
        for (const [sequence, finish] of pending)
          finish({ sequence, error: event.message || '本地规则运行失败，请重新开局。' });
        pending.clear();
        worker?.terminate();
        worker = undefined;
      };
    }
    const id = ++sequence;
    pending.set(id, (reply) =>
      reply.error
        ? reject(new Error(reply.error))
        : resolve(reply.value as Awaited<ReturnType<ReviewApi[K]>>),
    );
    try {
      worker.postMessage({ method, args, sequence: id });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}
export const api: ReviewApi = {
  engineTrace: (...args) => call('engineTrace', ...args),
  create: (...args) => call('create', ...args),
  turn: (...args) => call('turn', ...args),
  view: (...args) => call('view', ...args),
  submit: (...args) => call('submit', ...args),
  fixture: (...args) => call('fixture', ...args),
  knowledge: (...args) => call('knowledge', ...args),
  verifyKnowledge: (...args) => call('verifyKnowledge', ...args),
};
