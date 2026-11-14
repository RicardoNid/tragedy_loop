import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { firstBatch } from '../../packages/content/src/first-batch.js';
import { previewCounterEffect, type EffectContext, type EffectChoice } from '../../packages/engine/src/preview-counter-effect.js';
import type { CounterRule } from '../../packages/engine/src/rule-definition.js';

const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(new URL(p, root))).digest('hex');
const sourceLock = JSON.parse(read('packages/content/src/source-lock.json'));
const coverage = JSON.parse(read('packages/content/src/coverage.json'));
function rule(id: string): CounterRule {
  const result = firstBatch.find(r => r.id === id);
  assert.ok(result && result.kind === 'counter-effect');
  return result;
}
const context: EffectContext = {
  module: 'FS', edition: 'base', anniversaryOverlay: false, timing: 'mastermind-ability', ownerId: 'A',
  characters: [
    { id: 'A', alive: true, area: 'school' }, { id: 'B', alive: true, area: 'school' },
    { id: 'C', alive: true, area: 'hospital' }, { id: 'D', alive: false, area: 'school' },
    { id: 'E', alive: true, area: null },
  ],
};

test('every citation is pinned and resolves to the exact original excerpt', () => {
  for (const source of Object.values(sourceLock.sources) as any[]) {
    assert.equal(sha(source.file), source.sha256, source.file);
    if (source.upstream) assert.equal(sha(source.upstream.file), source.upstream.sha256, source.upstream.file);
    const text = read(source.file);
    const selected = source.pointer
      ? source.pointer.split('/').slice(1).reduce((v: any, k: string) => v[k], JSON.parse(text))
      : text.split(/\r?\n/).slice(source.startLine - 1, source.endLine).join('\n');
    assert.equal(selected, source.excerpt);
  }
  assert.equal(new Set(firstBatch.map(r => r.id)).size, firstBatch.length);
  for (const r of firstBatch) for (const id of [r.evidence.primary, ...r.evidence.dependencies]) assert.ok(sourceLock.sources[id], id);
});

test('catalog scope preserves official versions and explicit character requirements', () => {
  assert.equal(sha(coverage.catalog.file), coverage.catalog.sha256);
  assert.equal(sha(coverage.anniversary.file), coverage.anniversary.sha256);
  for (const entry of coverage.entries) assert.equal(sha(entry.file), entry.sha256, entry.file);
  for (const title of ['仙人', 'UP主', 'Basic Tragedy', 'Basic Tragedy X', 'Basic Tragedy X Plus', 'Another Horizon', 'Another Horizon Revised', 'Haunted Stage', 'Haunted Stage Again']) {
    assert.equal(coverage.entries.find((e: any) => e.title === title)?.included, true, title);
  }
  assert.equal(coverage.entries.find((e: any) => e.title === 'Supernatural Tragedy')?.included, false);
  assert.deepEqual(coverage.anniversary.applicableBaseModules, ['FS', 'BTX', 'MZ', 'MC', 'HSA', 'WM']);
  assert.deepEqual([...coverage.translatedFragments].sort(), firstBatch.map(r => r.id).sort());
});

// Handwritten expected values below come from the cited text, never from transition constants.
test('FS module overrides: one X slot and no final guess', () => {
  assert.deepEqual(firstBatch.filter(r => r.kind === 'setting').map(r => r.setting), [
    { key: 'x-slot-count', value: 1 }, { key: 'final-guess', value: false },
  ]);
});

for (const module of ['FS', 'BTX'] as const) {
  test(`${module} rumors: any board gets exactly one intrigue; faraway is not a board`, () => {
    const r = rule(`${module}.rule.random-intrigue`);
    for (const id of ['hospital', 'shrine', 'city', 'school']) {
      assert.deepEqual(previewCounterEffect(r, { ...context, module }, { kind: 'use', targetId: id }), {
        status: 'intent', intent: { kind: 'add-counter', target: { kind: 'board', id }, counter: 'intrigue', amount: 1 },
      });
    }
    assert.equal(previewCounterEffect(r, { ...context, module }, { kind: 'use', targetId: 'faraway' }).status, 'rejected');
    assert.deepEqual(r.limit, { maximum: 1, scope: 'loop', key: 'rule-instance', consumeOn: 'source-completed', resetOn: 'next-loop' });
    assert.deepEqual(previewCounterEffect(r, { ...context, module }, { kind: 'decline' }), { status: 'declined' });
  });
  test(`${module} gossip: self and living same-area targets only`, () => {
    const r = rule(`${module}.identity.gossip`);
    for (const id of ['A', 'B']) assert.deepEqual(previewCounterEffect(r, { ...context, module }, { kind: 'use', targetId: id }), {
      status: 'intent', intent: { kind: 'add-counter', target: { kind: 'character', id }, counter: 'paranoia', amount: 1 },
    });
    for (const id of ['C', 'D', 'E', 'missing']) assert.equal(previewCounterEffect(r, { ...context, module }, { kind: 'use', targetId: id }).status, 'rejected');
    for (const ownerId of ['D', 'E', 'missing']) assert.equal(previewCounterEffect(r, { ...context, module, ownerId }, { kind: 'use', targetId: 'B' }).status, 'rejected');
    assert.equal(r.limit?.scope, 'phase');
  });
}

test('evil contamination emits two shrine intrigue with no chosen target or occurrence claim', () => {
  const r = rule('BTX.incident.evil-contamination');
  const c = { ...context, module: 'BTX', timing: 'incident-effect-entry' } as const;
  assert.deepEqual(previewCounterEffect(r, c, { kind: 'use' }), {
    status: 'intent', intent: { kind: 'add-counter', target: { kind: 'board', id: 'shrine' }, counter: 'intrigue', amount: 2 },
  });
  assert.equal(previewCounterEffect(r, c, { kind: 'decline' }).status, 'rejected');
  assert.equal(previewCounterEffect(r, c, { kind: 'use', targetId: 'school' }).status, 'rejected');
  assert.equal(r.recordsIncidentOccurrence, false);
});

test('mismatched scope and timing are rejected; immutable inputs support replay', () => {
  const r = rule('FS.identity.gossip');
  for (const change of [{ module: 'BTX' }, { anniversaryOverlay: true }, { timing: 'incident-effect-entry' }] as const) {
    assert.equal(previewCounterEffect(r, { ...context, ...change }, { kind: 'use', targetId: 'A' }).status, 'rejected');
  }
  const before = structuredClone(context);
  assert.deepEqual(previewCounterEffect(r, context, { kind: 'use', targetId: 'B' }), previewCounterEffect(r, context, { kind: 'use', targetId: 'B' }));
  assert.deepEqual(context, before);
});

test('finite fragment history check retains only one coherent hidden owner throughout', () => {
  // This isolated fixture has two ordinary living holders A/B in different areas.
  // A single holder can add only to itself. Each observation separately has a witness;
  // the ordered history A+1 then B+1 has none with one fixed holder and no movement.
  const r = rule('FS.identity.gossip');
  const c = { ...context, characters: [{ id: 'A', alive: true, area: 'school' }, { id: 'B', alive: true, area: 'hospital' }] } as const;
  const choices: EffectChoice[] = [{ kind: 'decline' }, { kind: 'use', targetId: 'A' }, { kind: 'use', targetId: 'B' }];
  const witnesses = ['A', 'B'].flatMap(ownerId => choices.flatMap(first => choices.flatMap(second => {
    const results = [first, second].map(ch => previewCounterEffect(r, { ...c, ownerId }, ch));
    if (results.some(x => x.status === 'rejected')) return [];
    return [{ ownerId, observations: results.flatMap(x => x.status === 'intent' ? [x.intent.target.id] : []) }];
  })));
  assert.equal(witnesses.length, 8); // 2 owners × (decline or self)², separate phase entries.
  assert.ok(witnesses.some(w => w.observations.includes('A')));
  assert.ok(witnesses.some(w => w.observations.includes('B')));
  assert.ok(!witnesses.some(w => w.observations.join(',') === 'A,B'));
  assert.deepEqual(witnesses.filter(w => w.observations.join(',') === 'A,A').map(w => w.ownerId), ['A']);
});

test('state transition and unresolved semantics remain explicit data', () => {
  const reviews = JSON.parse(read('packages/content/src/review-cases.json'));
  for (const entry of reviews.cases) {
    for (const id of entry.sources) assert.ok(sourceLock.sources[id], id);
    assert.ok(entry.initial.length && entry.expectedProcess.length && entry.expectedResult.length);
  }
  for (const r of firstBatch) {
    for (const id of r.unresolved) assert.ok(reviews.cases.some((c: any) => c.id === id));
    if (r.kind !== 'counter-effect') continue;
    assert.deepEqual(r.transition.nextValue.before, { read: 'target-written-field', snapshot: 'effect-entry' });
    assert.equal(r.transition.frame, 'other-base-fields-unchanged');
    assert.equal(r.transition.after, 'recompute-derived-state-and-required-triggers');
    assert.deepEqual(r.unresolved, []);
    assert.deepEqual(r.evidence.projectDecisions, ['Q2']);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r); // No hidden callbacks or undefined fields.
  }
});

test('confirmed project decisions preserve provenance and independent case expectations', () => {
  const ledger = JSON.parse(read('packages/content/src/foundation-decisions.json'));
  const reviews = JSON.parse(read('packages/content/src/review-cases.json'));
  assert.equal(ledger.authority, 'project-user-decision');
  assert.equal(ledger.clarification, '两项替代＋一项自身，合计三项');
  assert.deepEqual(ledger.decisions.map((d: any) => d.id), ['Q1', 'Q2', 'Q3']);
  for (const d of ledger.decisions) {
    assert.equal(d.status, 'confirmed');
    const c = reviews.cases.find((c: any) => c.id === d.caseId);
    assert.deepEqual(c.decisionRefs, [d.id]);
    assert.deepEqual(c.openQuestions, []);
    for (const source of d.sources) assert.ok(sourceLock.sources[source]);
  }
  assert.deepEqual(ledger.decisions[0].example, {
    servantDirectRequests: 1, replacementRequests: 2, totalRequests: 3,
    guardCancelledRequests: 1, unblockedRequests: 2, actualServantDeaths: 1,
    protectedCharactersSurvive: true,
  });
  assert.equal(ledger.decisions[1].semantics.scope, 'loop-end-not-game-victory');
  assert.equal(ledger.decisions[2].semantics.previousLoopSnapshot, 'after-loop-end-processing-before-reset');
  for (const r of firstBatch) for (const id of r.evidence.projectDecisions) {
    assert.ok(ledger.decisions.some((d: any) => d.id === id && d.status === 'confirmed'));
  }
});
