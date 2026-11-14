import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(process.execPath, [vite, '--config', 'vite.config.ts'], {
    cwd: fileURLToPath(new URL('../../apps/web/', import.meta.url)),
    stdio: 'inherit',
    windowsHide: true,
  }),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (e) => {
    console.error(e);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
