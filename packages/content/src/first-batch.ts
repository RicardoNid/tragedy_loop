import type { CounterRule, ModuleId, RuleDefinition, Scope } from '../../engine/src/rule-definition.js';

const scope = (module: ModuleId): Scope => ({
  module, revision: 'local-2026-11-08', edition: 'base', anniversaryOverlay: false,
});
const evidence = (primary: string, dependencies: readonly string[], projectDecisions: readonly ('Q1' | 'Q2' | 'Q3')[] = []) => ({
  primary, dependencies, projectDecisions, status: 'assistant-checked', humanAcceptance: 'pending',
} as const);

const addCounter = (counter: 'intrigue' | 'paranoia', constant: 1 | 2): CounterRule['transition'] => ({
  kind: 'single-batch', target: 'resolved-choice-target', write: { field: 'raw-counter', counter },
  nextValue: { operator: 'add', before: { read: 'target-written-field', snapshot: 'effect-entry' }, constant },
  frame: 'other-base-fields-unchanged', after: 'recompute-derived-state-and-required-triggers',
});

// Shared shapes are implementation reuse only. Every module retains its own source and ID.
function intrigue(module: ModuleId, source: string): CounterRule {
  return {
    id: `${module}.rule.random-intrigue`, name: '流言四起·放置密谋', scope: scope(module),
    evidence: evidence(source, ['general.optional', 'general.once-loop', 'general.disclosure', 'general.completion'], ['Q2']),
    unresolved: [], kind: 'counter-effect', activation: 'optional-mastermind-ability',
    timing: 'mastermind-ability', snapshot: 'effect-entry', owner: 'selected-x-slot', guard: 'none',
    choice: { actor: 'mastermind', target: 'any-board', includesSelf: false, bindAt: 'effect-entry', noLegalTarget: 'unavailable' },
    limit: { maximum: 1, scope: 'loop', key: 'rule-instance', consumeOn: 'source-completed', resetOn: 'next-loop' },
    transition: addCounter('intrigue', 1),
    interruption: 'finish-current-batch-and-required-followups', disclosure: 'public-counter-change-only',
    recordsIncidentOccurrence: false, integration: 'requires-lifecycle-and-modifier-engine',
  };
}

function gossip(module: ModuleId, source: string): CounterRule {
  return {
    id: `${module}.identity.gossip`, name: '传谣人·放置不安', scope: scope(module),
    evidence: evidence(source, ['general.optional', 'general.once-phase', 'general.characters', 'general.disclosure', 'general.completion', 'faq.gossip-self'], ['Q2']),
    unresolved: [], kind: 'counter-effect', activation: 'optional-mastermind-ability',
    timing: 'mastermind-ability', snapshot: 'effect-entry', owner: 'current-ability-holder', guard: 'owner-alive-and-present',
    choice: { actor: 'mastermind', target: 'alive-character-in-owner-area', includesSelf: true, bindAt: 'effect-entry', noLegalTarget: 'unavailable' },
    limit: { maximum: 1, scope: 'phase', key: 'holder-and-ability', consumeOn: 'source-completed', resetOn: 'next-phase' },
    transition: addCounter('paranoia', 1),
    interruption: 'finish-current-batch-and-required-followups', disclosure: 'public-counter-change-only',
    recordsIncidentOccurrence: false, integration: 'requires-lifecycle-and-modifier-engine',
  };
}

export const firstBatch = [
  {
    id: 'FS.setting.x-count', name: 'FS 只有一个 X 槽位', scope: scope('FS'),
    evidence: evidence('fs.settings', []), unresolved: [], kind: 'setting', timing: 'setup',
    setting: { key: 'x-slot-count', value: 1 }, choice: 'none', disclosure: 'public-module-setting', interruption: 'not-applicable',
  },
  {
    id: 'FS.setting.final-guess', name: 'FS 无最终决战', scope: scope('FS'),
    evidence: evidence('fs.settings', ['conflict.fs-settings']), unresolved: [], kind: 'setting', timing: 'setup',
    setting: { key: 'final-guess', value: false }, choice: 'none', disclosure: 'public-module-setting', interruption: 'not-applicable',
  },
  intrigue('FS', 'fs.random-intrigue'), intrigue('BTX', 'btx.random-intrigue'),
  gossip('FS', 'fs.gossip'), gossip('BTX', 'btx.gossip'),
  {
    id: 'BTX.incident.evil-contamination', name: '邪气污染·效果段', scope: scope('BTX'),
    evidence: evidence('btx.evil-contamination', ['general.incident-disclosure', 'general.completion'], ['Q2']),
    unresolved: [], kind: 'counter-effect', activation: 'invoked-incident-effect', timing: 'incident-effect-entry',
    snapshot: 'effect-entry', owner: 'incident-invocation', guard: 'none',
    choice: { actor: 'none', target: 'fixed-shrine', includesSelf: false, bindAt: 'effect-entry', noLegalTarget: 'unavailable' },
    limit: null, transition: addCounter('intrigue', 2),
    interruption: 'finish-current-batch-and-required-followups', disclosure: 'public-counter-change-only',
    recordsIncidentOccurrence: false, integration: 'requires-lifecycle-and-modifier-engine',
  },
] as const satisfies readonly RuleDefinition[];
