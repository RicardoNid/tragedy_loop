import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface Faq {
  id: string;
  question: string;
  answer: string;
  path: string;
  authority: string;
  scope: string;
  faqSources: { snapshot?: string; path?: string; url?: string; sheet?: string; row?: number }[];
}
export const faq = JSON.parse(readFileSync('facts/data/catalog.json', 'utf8')).items.filter(
  (x: { kind: string }) => x.kind === 'faq',
) as Faq[];
export function checkSources() {
  const expected = JSON.parse(
    readFileSync('tests/comprehensive/fixtures/faq-index.json', 'utf8'),
  ) as { id: string; sha256: string }[];
  assert.equal(
    faq.length,
    expected.length,
    'FAQ inventory changed; review mappings before updating the pinned index',
  );
  const files = new Map<string, string>();
  for (const [index, q] of faq.entries()) {
    assert.equal(q.id, expected[index]!.id, `FAQ order changed at ${index}`);
    assert.equal(sha(JSON.stringify(q)), expected[index]!.sha256, `FAQ ${q.id} changed`);
    const file = `facts/${q.path}`,
      bytes = readFileSync(file),
      entity = JSON.parse(bytes.toString('utf8'));
    assert.equal(entity.id, q.id);
    assert.equal(entity.fields.question, q.question);
    assert.equal(entity.fields.answer, q.answer);
    assert.ok(q.question.trim() && q.answer.trim());
    assert.ok(q.faqSources.length);
    files.set(file, sha(bytes));
    for (const source of q.faqSources) {
      for (const relative of [source.snapshot, source.path].filter((p): p is string =>
        Boolean(p),
      )) {
        const path = `facts/${relative}`;
        files.set(path, sha(readFileSync(path)));
      }
    }
  }
  return {
    count: faq.length,
    files: Object.fromEntries(files),
    catalog: sha(readFileSync('facts/data/catalog.json')),
  };
}
if (process.argv[1]?.endsWith('source-check.ts')) {
  const result = checkSources();
  writeFileSync('products/comprehensive/sources.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`FAQ source integrity: ${result.count}/${result.count}`);
}
