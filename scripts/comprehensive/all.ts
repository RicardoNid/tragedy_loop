import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { checkSources, sha } from './source-check.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const tsx = 'node_modules/tsx/dist/cli.mjs',
  tsc = 'node_modules/typescript/bin/tsc';
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const vite = join(dirname(webRequire.resolve('vite/package.json')), 'bin/vite.js');
mkdirSync('products/comprehensive', { recursive: true });
const startedAt = new Date().toISOString(),
  before = checkSources();
const checks: { name: string; status: string; exit: number | null; ms: number; log: string }[] = [];
async function run(name: string, args: string[], runtime = process.execPath) {
  const start = performance.now(),
    chunks: Buffer[] = [];
  console.log(`Starting ${name}`);
  const code = await new Promise<number | null>((resolve, reject) => {
    const p = spawn(runtime, args, { windowsHide: true });
    p.stdout.on('data', (b) => chunks.push(b));
    p.stderr.on('data', (b) => chunks.push(b));
    p.on('error', reject);
    p.on('close', resolve);
  });
  const log = `${name}.txt`;
  writeFileSync(`products/comprehensive/${log}`, Buffer.concat(chunks));
  checks.push({
    name,
    status: code === 0 ? 'passed' : 'failed',
    exit: code,
    ms: performance.now() - start,
    log,
  });
  console.log(
    `${name}: ${code === 0 ? 'passed' : 'FAILED'} (${Math.round((performance.now() - start) / 1000)}s)`,
  );
}
const tests = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => `${dir}/${f}`);
await run('comprehensive-types', [tsc, '-p', 'tests/comprehensive/tsconfig.json']);
await run('engine-types', [tsc, '-p', 'tests/engine/tsconfig.json']);
await run('engine-regression', [tsx, '--test', ...tests('tests/engine')]);
await run('rules-types', [tsc, '-p', 'tests/rules/tsconfig.json']);
await run('rules-regression', [tsx, '--test', ...tests('tests/rules')]);
await run('targeted-log', [tsx, 'scripts/comprehensive/run.ts']);
await run('stress-log', [tsx, 'scripts/comprehensive/stress.ts']);
await run('web-build', [vite, 'build', '--config', 'apps/web/vite.config.ts', 'apps/web']);
await run('web-types', [tsc, '-p', 'apps/web/tsconfig.json']);
await run('server-types', [tsc, '-p', 'apps/server/tsconfig.json']);
await run('review-regression', [tsx, '--test', ...tests('tests/review')]);
await run('gui-regression', [
  'node_modules/@playwright/test/cli.js',
  'test',
  '-c',
  'scripts/comprehensive/playwright.config.ts',
]);
const after = checkSources();
if (JSON.stringify(before) !== JSON.stringify(after))
  throw new Error('Read-only FAQ sources changed during this verification run');
writeFileSync('products/comprehensive/sources.json', JSON.stringify(after, null, 2) + '\n');
const sourceHashes: Record<string, string> = {};
function walk(dir: string) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${f.name}`;
    if (f.isDirectory()) walk(path);
    else if (/\.(ts|tsx|json|css|mjs)$/.test(f.name)) sourceHashes[path] = sha(readFileSync(path));
  }
}
for (const dir of [
  'packages/engine/src/runtime',
  'packages/content/src/official',
  'packages/contracts/src',
  'tests/comprehensive',
  'scripts/comprehensive',
  'apps/web/src',
  'apps/server/src',
])
  walk(dir);
writeFileSync(
  'products/comprehensive/verification.json',
  JSON.stringify(
    { startedAt, completedAt: new Date().toISOString(), checks, sourceHashes },
    null,
    2,
  ) + '\n',
);
await run('report', [tsx, 'scripts/comprehensive/report.ts']);
if (checks.some((c) => c.status !== 'passed')) process.exitCode = 1;
