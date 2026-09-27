import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
// Both src/main.ts and bundled dist/main.js are three directories below the root.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT');
const origin = `http://127.0.0.1:${port}`;
const development = !import.meta.url.endsWith('/dist/main.js');
const app = await buildApp({ root, origin, development });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ port, host: '127.0.0.1' });
console.log(`Tragedy Loop ${origin} (${development ? 'development' : 'production'})`);
