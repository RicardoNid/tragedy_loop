import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const root = new URL('../../', import.meta.url);
const log = new URL('products/engine/solution3-monitor.jsonl', root);
const duration = Number(process.argv[2] ?? 6) * 3600000;
if (!Number.isFinite(duration) || duration <= 0) throw Error('时长须为正数');
const until = Date.now() + duration;
let pass = 0;
do {
  const start = new Date();
  const jobs = [
    ['cross', ['scripts/engine/solution3-cross.ts']],
    [
      'regression',
      ['--test', 'tests/engine/solution3.test.ts', 'tests/engine/solution3-replay.test.ts'],
    ],
  ];
  if (pass % 10 === 0) jobs.push(['replay', ['scripts/engine/solution3-cross-replay.ts']]);
  for (const [suite, args] of jobs) {
    const before = performance.now();
    const r = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 600000,
    });
    const ok = r.status === 0 && !r.error;
    const output =
      ok && suite === 'regression'
        ? r.stdout
            .split(/\r?\n/)
            .filter((l) => /^# (tests|pass|fail)/.test(l))
            .join('\n')
        : r.stdout;
    const record = {
      start: start.toISOString(),
      end: new Date().toISOString(),
      pass,
      suite,
      ok,
      ms: Math.round(performance.now() - before),
      output,
      error: r.error?.message ?? r.stderr,
    };
    appendFileSync(log, JSON.stringify(record) + '\n');
    console.log(record.end, pass, suite, ok ? '通过' : '失败', record.ms);
    if (!ok) process.exit(1);
  }
  pass++;
  await sleep(Math.min(45000, Math.max(0, until - Date.now())));
} while (Date.now() < until);
console.log('完成', pass, '轮。');
