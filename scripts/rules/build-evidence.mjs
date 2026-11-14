// Read-only source capture. Writes only this task's two declared content artifacts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const json = p => JSON.parse(read(p));
const sources = {};
function field(id, entity, pointer) {
  const file = `facts/data/${entity}.json`;
  const data = json(file);
  const tokens = pointer.split('/').slice(1);
  const excerpt = tokens.reduce((v, k) => v[k], data);
  if (typeof excerpt !== 'string') throw Error(`Non-string citation: ${id}`);
  const provenance = data.provenance?.[tokens[1]] ?? data.sources[0];
  const upstream = provenance.snapshot ?? provenance.path;
  sources[id] = { file, sha256: hash(file), pointer, excerpt, provenance,
    upstream: upstream ? { file: `facts/${upstream}`, sha256: hash(`facts/${upstream}`) } : null };
}
function lines(id, file, needle, count = 1, provenance = 'wiki') {
  const all = read(file).split(/\r?\n/);
  const matches = all.flatMap((line, i) => line.includes(needle) ? [i] : []);
  if (matches.length !== 1) throw Error(`Expected unique citation: ${id}: ${matches.length}`);
  const start = matches[0];
  sources[id] = { file, sha256: hash(file), startLine: start + 1, endLine: start + count,
    excerpt: all.slice(start, start + count).join('\n'), provenance: { provider: provenance } };
}
field('fs.settings', 'modules/13222d412f58d5ab', '/fields/special');
field('fs.random-intrigue', 'rules/8ff617a0561ece90', '/fields/effect');
field('btx.random-intrigue', 'rules/5dfad689bca7fed4', '/fields/effect');
field('fs.gossip', 'identities/f16898d92f630937', '/fields/abilities/0');
field('btx.gossip', 'identities/27cc906490dd3178', '/fields/abilities/0');
field('btx.evil-contamination', 'incidents/ecc3824a2e25ff40', '/fields/effect');
const faq = {
  'gossip-self':'410fa861debfaffd', 'once-phase':'be825c0e9e9f6413',
  'two-serial-killers':'70858d0d8544c57b', 'hospital-both':'3522539a0b4c29fd',
  'hospital-no-secret':'12ef2c6c95429ab1', 'hospital-empty':'6f557b4046072e56',
  'substitute-guard':'8a72d941bd3fd3e6', 'immortal-guard':'024896648fd9ba4d',
  'substitute-immortal':'d8af2317ba109cf8', 'fool-hospital':'4f701be8966d8585',
  'fool-horrific':'75bf9f777d1ef926', 'causal-transfer':'aa029c7a644c1d94',
  'causal-parttimer':'193a1d3a3cfaf4dd', 'causal-dead':'507518f13255b0b4',
  'causal-removed':'0b1ac228bacc9130', 'causal-hope':'a7598881cc7b439b',
  'friend-disclosure':'a65424f88d6fab89', 'friend-dead':'7dd6066fa7680371',
};
for (const [name, id] of Object.entries(faq)) {
  field(`faq.${name}`, `faq/${id}`, '/fields/answer');
  sources[`faq.${name}`].question = json(`facts/data/faq/${id}.json`).fields.question;
}
const general = 'facts/text/references/2db1b5d63b2bcd80.txt';
lines('general.once-loop', general, 'Q：每轮限1次是什么？');
lines('general.once-phase', general, 'Q：剧作家能力能无限发动吗？');
lines('general.characters', general, 'Q：角色和卡牌有什么区别？');
lines('general.disclosure', general, 'Q：剧作家发动能力时怎么声明？');
lines('general.incident-disclosure', general, 'Q：事件要怎么声明？');
lines('general.interrupt', general, 'Q：如果在事件阶段途中关键人物或主人公死亡，如何结算？');
lines('general.wm-anniversary', general, 'Q：十周年规则之后WM的剧本怎么办？');
lines('general.optional', 'facts/text/articles/f82c02b2ecd5e14e.txt', '即使满足条件，剧作家也可以选择是否结算该能力。', 5, 'lloyd');
lines('general.completion', 'facts/sources/lunhui/tragedy_loop_game_rules(3)(1).md', '只有事件、能力或规则规定的全部效果文本', 1, 'lloyd');
lines('conflict.causal-scope', 'facts/sources/lunhui/tragedy_loop_game_rules(3)(1).md', '因果线检查上一轮回结束时有效友好数量', 1, 'lloyd');
lines('conflict.fs-settings', 'facts/sources/lunhui/tragedy_loop_game_rules(3)(1).md', 'First Steps 默认不开放最终决战', 1, 'lloyd');
field('btx.causal', 'rules/9d51f3526f0e04db', '/fields/effect');
field('btx.friend', 'identities/cf76a8767153fd13', '/fields/abilities/1');
field('btx.hospital', 'incidents/62be423c7130d75f', '/fields/effect');
field('mc.horrific', 'incidents/b131d70dc5ced968', '/fields/effect');
field('mc.fool', 'identities/0e9089dadbdd7c93', '/fields/abilities/1');
field('character.servant', 'characters/ff7a5b572d8e564f', '/fields/特性');
field('character.ai', 'characters/6bcb295b44e53184', '/fields/友好能力/0/text');
// Body provenance is distinct from a page's list of providers (wiki pages can be empty).
const bodyEntities = {
  'facts/text/references/2db1b5d63b2bcd80.txt': 'facts/data/references/2db1b5d63b2bcd80.json',
  'facts/text/articles/f82c02b2ecd5e14e.txt': 'facts/data/articles/f82c02b2ecd5e14e.json',
};
for (const source of Object.values(sources)) {
  const entity = bodyEntities[source.file];
  if (!entity) continue;
  source.provenance = json(entity).bodySource;
  const upstream = source.provenance.snapshot ?? source.provenance.path;
  source.upstream = { file: `facts/${upstream}`, sha256: hash(`facts/${upstream}`) };
}

const catalogFile = 'facts/data/catalog.json';
const catalog = json(catalogFile).items;
const inventoryKinds = new Set(['modules', 'characters', 'rules', 'identities', 'incidents', 'actions']);
const inventory = catalog.filter(i => inventoryKinds.has(i.kind)).map(i => ({
  id: i.id, title: i.title, kind: i.kind, scope: i.scope,
  authority: i.authority, included: i.authority === '官方',
  status: i.authority === '官方' ? 'catalogued-not-translated' : i.authority === '民间' ? 'excluded-fan-content' : 'classification-pending',
  file: `facts/${i.path}`, sha256: hash(`facts/${i.path}`),
}));
const article = 'facts/data/articles/cddea332129b696d.json';
const outputs = {
  'packages/content/src/source-lock.json': { schemaVersion: 1, capturedForTask: '2026-11-08', policy: 'wiki > lloyd > ricardo, per field', sources },
  'packages/content/src/coverage.json': {
    schemaVersion: 1, catalog: { file: catalogFile, sha256: hash(catalogFile) },
    meaning: 'Local catalog inventory, not proof of official completeness or legal cross-module combinations. Scope must not filter unsupported possibilities as impossible.',
    anniversary: { file: article, sha256: hash(article), applicableBaseModules: ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM'], status: 'catalogued-not-translated' },
    separateVersions: [['Basic Tragedy', 'Basic Tragedy X', 'Basic Tragedy X Plus'], ['Haunted Stage', 'Haunted Stage Again'], ['Another Horizon', 'Another Horizon Revised']],
    translatedFragments: ['FS.setting.x-count', 'FS.setting.final-guess', 'FS.rule.random-intrigue', 'BTX.rule.random-intrigue', 'FS.identity.gossip', 'BTX.identity.gossip', 'BTX.incident.evil-contamination'],
    entries: inventory,
  },
};
for (const [file, value] of Object.entries(outputs)) fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
console.log(JSON.stringify({ sources: Object.keys(sources).length, entries: inventory.length, officialByKind: Object.fromEntries([...inventoryKinds].map(k => [k, inventory.filter(x => x.kind === k && x.included).length])) }));
