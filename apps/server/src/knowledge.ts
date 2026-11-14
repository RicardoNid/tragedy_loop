import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PlayerView } from '../../../packages/contracts/src/game.js';
import type { KnowledgeView } from '../../../packages/contracts/src/knowledge.js';
import { observedRoster } from '../../../packages/engine/src/runtime/knowledge-domain.js';

/** One background worker per local review server; switching games releases its search tree. */
export function knowledgeService() {
  let worker: ChildProcess | undefined,
    gameId = '',
    version = -1;
  let latest: KnowledgeView | undefined;
  let sentThrough = 0;
  let rosterKey = '';
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function close() {
    worker?.kill();
    worker = undefined;
    gameId = '';
    if (expiry) clearTimeout(expiry);
  }
  return {
    close,
    get(id: string, opening: PlayerView, view: PlayerView, verifyAll = false): KnowledgeView {
      if (expiry) clearTimeout(expiry);
      expiry = setTimeout(close, 30000);
      expiry.unref();
      // A delayed arrival becomes public only when the engine projects it.
      // Replay the full prefix with the expanded domain before reusing exclusions.
      const roster = observedRoster(opening, view);
      const key = JSON.stringify(roster);
      opening = { ...opening, roster };
      if (gameId !== id || !worker || key !== rosterKey) {
        worker?.kill();
        gameId = id;
        rosterKey = key;
        version = -1;
        sentThrough = 0;
        latest = undefined;
        worker = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            '--max-old-space-size=384',
            fileURLToPath(new URL('./knowledge-worker.ts', import.meta.url)),
          ],
          {
            // Loading/restarting a review game must not create a Windows console window.
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          },
        );
        const current = worker;
        worker.on('message', (result: KnowledgeView & { error?: string }) => {
          if (worker !== current) return;
          if (result.error) {
            if (latest) latest = { ...latest, status: 'error', reasons: [result.error] };
          } else if (result.revision === version) latest = result;
        });
        const failed = () => {
          if (worker === current && latest)
            latest = { ...latest, status: 'error', reasons: ['求解进程已停止；重新开局可重试。'] };
        };
        worker.on('error', failed);
        worker.on('exit', failed);
      }
      if (view.revision !== version) {
        version = view.revision;
        // The worker alone can publish candidates for the new public revision.
        latest = {
          revision: version,
          ruleDigest: '',
          status: 'running',
          domainComplete: false,
          generated: 0,
          possible: 0,
          unresolved: 0,
          excluded: 0,
          expansions: 0,
          elapsedMs: 0,
          identities: {},
          rules: [],
          culprits: {},
          reasons: [],
          evidenceThrough: 0,
        };
        if (worker.connected) {
          worker.send({
            opening,
            history: view.observations.slice(sentThrough),
            after: sentThrough,
            revision: version,
          });
          sentThrough = view.observations.length;
        }
      }
      if (verifyAll && worker.connected) {
        worker.send({
          opening,
          history: [],
          after: sentThrough,
          revision: version,
          verifyAll: true,
        });
        if (latest)
          latest = {
            ...latest,
            status: 'running',
            historySearchDeferred: false,
            scope: latest.scope ? { ...latest.scope, deferred: false } : undefined,
          };
      }
      return latest!;
    },
  };
}
