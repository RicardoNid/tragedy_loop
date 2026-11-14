import type { KnowledgeView } from '../../../packages/contracts/src/knowledge';
import type { ReviewEngineTrace } from '../../../packages/contracts/src/review';

// One IndexedDB record per game. Each tab owns a different game id.
interface Entry {
  id: string;
  updated: number;
  engine: ReviewEngineTrace;
  checkpoints: {
    command: number;
    revision: number;
    auditThrough: number;
    observationThrough: number;
  }[];
  calculations: NonNullable<KnowledgeView['calculationTrace']>;
  passes: Record<
    number,
    Pick<
      KnowledgeView,
      | 'status'
      | 'evidenceThrough'
      | 'generated'
      | 'expansions'
      | 'identities'
      | 'impliedIdentities'
      | 'transition'
      | 'propagation'
      | 'historySearchDeferred'
      | 'jointCount'
      | 'elapsedMs'
    >
  >;
}
let active: Entry | undefined;
let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tragedy-review-log', 1);
    request.onupgradeneeded = () =>
      request.result
        .createObjectStore('games', { keyPath: 'id' })
        .createIndex('updated', 'updated');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function save(entry: Entry) {
  entry.updated = Date.now();
  const db = await open();
  const tx = db.transaction('games', 'readwrite');
  tx.objectStore('games').put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export async function recordEngine(id: string, engine: ReviewEngineTrace) {
  if (active?.id !== id)
    active = { id, updated: 0, engine, checkpoints: [], calculations: [], passes: {} };
  if (active.checkpoints.at(-1)?.command === engine.choices.length) return;
  active.engine = engine;
  active.checkpoints.push({
    command: engine.choices.length,
    revision: engine.revision,
    auditThrough: engine.audit.length,
    observationThrough: engine.observations.length,
  });
  await save(active);
}
export async function recordSolver(id: string, result: KnowledgeView) {
  if (active?.id !== id || (result.status === 'running' && !result.ruleDigest)) return;
  const {
    revision,
    status,
    evidenceThrough,
    generated,
    expansions,
    identities,
    impliedIdentities,
    transition,
    propagation,
    historySearchDeferred,
    jointCount,
    elapsedMs,
  } = result;
  const last = active.passes[revision];
  if (
    last &&
    last.status === status &&
    last.expansions === expansions &&
    last.generated === generated &&
    last.historySearchDeferred === historySearchDeferred &&
    last.propagation?.verifiedValues === propagation?.verifiedValues &&
    last.jointCount === jointCount
  )
    return;
  active.passes[revision] = {
    status,
    evidenceThrough,
    generated,
    expansions,
    identities,
    impliedIdentities,
    transition,
    propagation,
    historySearchDeferred,
    jointCount,
    elapsedMs,
  };
  if (result.calculationTrace) active.calculations = result.calculationTrace;
  await save(active);
}
export async function exportLog(id?: string) {
  let entry: Entry | undefined;
  if (active && (!id || active.id === id)) entry = active;
  else {
    const db = await open();
    const store = db.transaction('games').objectStore('games');
    entry = await new Promise<Entry | undefined>((resolve, reject) => {
      if (id) {
        const r = store.get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } else {
        const r = store.index('updated').openCursor(null, 'prev');
        r.onsuccess = () => resolve(r.result?.value);
        r.onerror = () => reject(r.error);
      }
    });
  }
  if (!entry) throw Error('当前浏览器还没有保存测试诊断记录。');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ version: 1, ...entry }, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `测试诊断-${entry.engine.setup.module}-${entry.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
