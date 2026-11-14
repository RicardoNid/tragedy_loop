import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
export async function buildLocal() {
  const result = await build({
    configFile: false,
    resolve: {
      alias: [
        { find: /^\.\/api$/, replacement: join(root, 'apps/web/src/offline/api.ts') },
        { find: 'node:crypto', replacement: join(root, 'apps/web/src/offline/hash.ts') },
      ],
    },
    worker: { format: 'iife' },
    root: join(root, 'apps/web'),
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry: join(root, 'apps/web/src/main.tsx'), name: 'TragedyReview', formats: ['iife'] },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const js = output
    .filter((o) => o.type === 'chunk')
    .map((o) => o.code)
    .join('\n')
    .replace(/<\/script/gi, '<\\/script');
  const css = output
    .filter((o) => o.type === 'asset' && o.fileName.endsWith('.css'))
    .map((o) => o.source)
    .join('\n');
  writeFileSync(
    join(root, 'tragedy-test-ui.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>惨剧轮回 · 本地人类测试</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
  );
  console.log('Local UI: tragedy-test-ui.html');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildLocal();
