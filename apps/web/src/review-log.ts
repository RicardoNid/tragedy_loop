import type { PlayerView } from '../../../packages/contracts/src/game';
import type { KnowledgeView } from '../../../packages/contracts/src/knowledge';
import type { ReviewEngineTrace, ReviewSolverInputs } from '../../../packages/contracts/src/review';

interface Entry {
  id: string;
  updated: number;
  started?: number;
  engine?: ReviewEngineTrace;
  checkpoints: {
    command: number;
    revision: number;
    auditThrough: number;
    observationThrough: number;
  }[];
  calculations: NonNullable<KnowledgeView['calculationTrace']>;
  passes: Record<number, KnowledgeView>;
}
interface RunCall {
  id: string;
  gameId: string;
  sequence: number;
  started: number;
  finished: number;
  method: string;
  input: unknown[];
  solverInput?: ReviewSolverInputs['solver1'] | { opening: PlayerView; current: PlayerView };
  solverInputMode?: 'full-history-replay' | 'public-view';
  inputError?: string;
  inputMatchesOutput?: boolean;
  output?: unknown;
  error?: string;
  engine?: ReviewEngineTrace;
}
type Transport = {
  publicOpening(id:string):Promise<import('../../../packages/contracts/src/game').PlayerView>;
  view(id:string,seat:'p0'):Promise<import('../../../packages/contracts/src/game').PlayerView>;
  engineTrace(id: string): Promise<ReviewEngineTrace>;
  solverInputs(id: string): Promise<ReviewSolverInputs>;
};
let database: Promise<IDBDatabase> | undefined;
let sequence = 0;
let tail = Promise.resolve();
const entries = new Map<string, Entry>();
const dirty = new Set<string>();
const pending = new Map<string, RunCall>();
const signatures = new Map<string, string>();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work);
  tail = next.then(
    () => {},
    () => {},
  );
  return next;
}
function open() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tragedy-review-log', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('games'))
        db.createObjectStore('games', { keyPath: 'id' }).createIndex('updated', 'updated');
      if (!db.objectStoreNames.contains('calls'))
        db.createObjectStore('calls', { keyPath: 'id' }).createIndex('gameId', 'gameId');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(Error('请关闭旧版测试页后重试保存。'));
    };
  }));
}
function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function entryFor(id: string) {
  let entry = entries.get(id);
  if (!entry) {
    const db = await open();
    entry = await read<Entry | undefined>(db.transaction('games').objectStore('games').get(id));
    entry ??= { id, updated: 0, checkpoints: [], calculations: [], passes: {} };
    entries.set(id, entry);
  }
  return entry;
}
function updateEntry(entry: Entry, call: RunCall) {
  entry.started = Math.min(entry.started ?? call.started, call.started);
  entry.updated = Math.max(entry.updated, call.finished);
  if (call.engine) {
    entry.engine = call.engine;
    if (entry.checkpoints.at(-1)?.command !== call.engine.choices.length)
      entry.checkpoints.push({
        command: call.engine.choices.length,
        revision: call.engine.revision,
        auditThrough: call.engine.audit.length,
        observationThrough: call.engine.observations.length,
      });
  }
  if ((call.method === 'knowledge' || call.method === 'verifyKnowledge') && call.output) {
    const result = call.output as KnowledgeView;
    entry.passes[result.revision] = result;
    if (result.calculationTrace) entry.calculations = result.calculationTrace;
  }
}
async function flush() {
  // Retain failed writes in memory and retry them with the next successful transaction.
  for (const call of pending.values()) {
    const entry = await entryFor(call.gameId);
    updateEntry(entry, call);
    dirty.add(entry.id);
  }
  if (!dirty.size && !pending.size) return;
  const db = await open();
  const tx = db.transaction(['games', 'calls'], 'readwrite');
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error('运行记录事务中止。'));
    tx.onerror = () => reject(tx.error ?? Error('运行记录写入失败。'));
    try {
      for (const id of dirty) tx.objectStore('games').put(entries.get(id)!);
      for (const call of pending.values()) tx.objectStore('calls').put(call);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
  dirty.clear();
  pending.clear();
}
function notify(error = '') {
  window.dispatchEvent(new CustomEvent('tragedy-run-log', { detail: error }));
}
async function record(call: RunCall) {
  // Preserve every command and failure. Identical solver polling replies add no new evidence.
  const poll = call.method === 'knowledge';
  const key = call.gameId + '/' + call.method;
  const signature = poll ? JSON.stringify([call.solverInput, call.output, call.error]) : '';
  await serial(async () => {
    if (poll && !call.error && signatures.get(key) === signature) {
      await flush();
      return;
    }
    pending.set(call.id, call);
    await flush();
    if (poll && !call.error) signatures.set(key, signature);
  });
}
/** Record the public transport boundary, including full solver replay inputs and rejected requests. */
export function withRunLog<T extends Transport>(transport: T): T {
  return new Proxy(transport, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function' || typeof property !== 'string') return method;
      return async (...args: unknown[]) => {
        const call: RunCall = {
          id: crypto.randomUUID(),
          gameId: String(args[0] ?? ''),
          sequence: ++sequence,
          started: Date.now(),
          finished: 0,
          method: property,
          input: structuredClone(args),
        };
        if (property === 'create') call.gameId = 'attempt-' + call.id;
        if (['knowledge', 'verifyKnowledge'].includes(property)) {
          try {
            const inputs = await target.solverInputs(call.gameId);
            call.solverInput = {
              ...inputs.solver1,
              verifyAll: property === 'verifyKnowledge',
            };
            call.solverInputMode = 'full-history-replay';
          } catch (error) {
            call.inputError = String(error);
          }
        }
        if(property==='solution3') {
          try {
            const [opening,current]=await Promise.all([target.publicOpening(call.gameId),target.view(call.gameId,'p0')]);
            call.solverInput={opening,current};
            call.solverInputMode='public-view';
          } catch(error){call.inputError=String(error);}
        }
        let output: unknown;
        let failure: unknown;
        try {
          output = await Reflect.apply(method, target, args);
          call.output = structuredClone(output);
          if (property === 'create') call.gameId = (output as { id: string }).id;
        } catch (error) {
          failure = error;
          call.error = String(error);
        }
        if (
          ['create', 'submit', 'fixture'].includes(property) &&
          !call.gameId.startsWith('attempt-')
        ) {
          try {
            call.engine = await target.engineTrace(call.gameId);
          } catch (error) {
            call.inputError = String(error);
          }
        }
        if (call.solverInput && output && typeof output === 'object' && 'revision' in output) {
          const revision =
            'current' in call.solverInput
              ? call.solverInput.current.revision
              : call.solverInput.revision;
          call.inputMatchesOutput = revision === output.revision;
        }
        if(property==='solution3' && call.solverInput && 'current' in call.solverInput && output && typeof output==='object' && 'through' in output)
          call.inputMatchesOutput=output.through===args[1] && Number(args[1])<=call.solverInput.current.observations.length;
        call.finished = Date.now();
        try {
          await record(call);
          notify(call.inputError ? '运行记录输入采集失败：' + call.inputError : '');
        } catch (error) {
          notify('运行记录保存失败：' + String(error));
        }
        if (failure) throw failure;
        return output;
      };
    },
  });
}
export async function listLogs() {
  return serial(async () => {
    await flush();
    const db = await open();
    const saved = await read<Entry[]>(db.transaction('games').objectStore('games').getAll());
    return saved
      .sort((a, b) => (b.started ?? b.updated) - (a.started ?? a.updated))
      .map((entry) => ({
        id: entry.id,
        updated: entry.updated,
        module: entry.engine?.setup.module ?? '未开局',
        revision: entry.engine?.revision ?? 0,
      }));
  });
}
export async function exportLog(id?: string) {
  const data = await serial(async () => {
    await flush();
    const db = await open();
    const store = db.transaction('games').objectStore('games');
    let entry: Entry | undefined;
    if (id) entry = await read<Entry | undefined>(store.get(id));
    else
      entry = (await read<Entry[]>(store.getAll())).sort(
        (a, b) => (b.started ?? b.updated) - (a.started ?? a.updated),
      )[0];
    if (!entry) throw Error('当前浏览器还没有保存测试运行记录。');
    const calls = await read<RunCall[]>(
      db.transaction('calls').objectStore('calls').index('gameId').getAll(entry.id),
    );
    calls.sort((a, b) => a.started - b.started || a.sequence - b.sequence);
    return { version: 2, ...entry, calls };
  });
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `测试诊断-${data.engine?.setup.module ?? '未开局'}-${data.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
