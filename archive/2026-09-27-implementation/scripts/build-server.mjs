import { build } from 'esbuild';
await build({
  entryPoints: ['apps/server/src/main.ts'],
  outfile: 'apps/server/dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: ['fastify', '@fastify/static', '@fastify/middie', 'vite'],
});
