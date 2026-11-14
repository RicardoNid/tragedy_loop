// Read-only source import. This produces evidence, never executable translations.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const modules = {
  'First Steps': 'FS',
  'Basic Tragedy X': 'BTX',
  'Midnight Zone': 'MZ',
  'Mystery Circle': 'MC',
  'Haunted Stage Again': 'HSA',
  'Weird Mythology': 'WM',
  'Another Horizon Revised': 'AHR',
  'Last Liar': 'LL',
  'Basic Tragedy X Plus': 'BTX+',
};
const catalog = JSON.parse(readFileSync(resolve(root, 'facts/data/catalog.json'), 'utf8'));
const entries = catalog.items
  .filter(
    (i) =>
      (['rules', 'identities', 'incidents'].includes(i.kind) && modules[i.scope]) ||
      (i.kind === 'characters' && i.authority === '官方') ||
      (i.kind === 'modules' && modules[i.title]),
  )
  .map((i) => {
    const path = `facts/${i.path}`;
    const raw = readFileSync(resolve(root, path));
    const entity = JSON.parse(raw);
    return {
      id: i.id,
      name: i.title,
      kind: i.kind,
      module: modules[i.scope] ?? modules[i.title] ?? null,
      source: path,
      sha256: createHash('sha256').update(raw).digest('hex'),
      fields: entity.fields,
      provenance: entity.provenance,
    };
  });
const target = resolve(root, 'packages/content/src/official/source-catalog.json');
mkdirSync(resolve(root, 'packages/content/src/official'), { recursive: true });
writeFileSync(
  target,
  JSON.stringify(
    { schema: 1, policy: 'wiki > lloyd > ricardo per field; project rulings explicit', entries },
    null,
    2,
  ) + '\n',
);
console.log(`Pinned ${entries.length} official source entries. No rules inferred or executed.`);
