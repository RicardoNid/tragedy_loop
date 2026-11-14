import '../../tests/comprehensive/setup-cases.js';
import '../../tests/comprehensive/more.js';
import '../../tests/comprehensive/interactions.js';
import '../../tests/comprehensive/remaining.js';
import '../../tests/comprehensive/final-cases.js';
import { cases } from '../../tests/comprehensive/cases.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const results = [];
for (const c of cases) {
  const started = performance.now();
  try {
    c.run();
    results.push({ ...c, run: undefined, status: 'passed', ms: performance.now() - started });
  } catch (e) {
    const error = e instanceof Error ? e.stack : String(e);
    results.push({
      ...c,
      run: undefined,
      status: 'failed',
      error,
      ms: performance.now() - started,
    });
    console.log(`FAIL ${c.id}: ${error}`);
  }
}
mkdirSync('products/comprehensive', { recursive: true });
writeFileSync('products/comprehensive/cases.json', JSON.stringify(results, null, 2) + '\n');
console.log(
  `${results.filter((r) => r.status === 'passed').length}/${results.length} targeted cases passed`,
);
if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
