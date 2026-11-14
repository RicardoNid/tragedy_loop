/** First translation slice. These definitions describe effects, not a complete game. */
export type ModuleId = 'FS' | 'BTX';
export type Board = 'hospital' | 'shrine' | 'city' | 'school';
export type SourceId = string;

export interface Evidence {
  readonly primary: SourceId;
  readonly dependencies: readonly SourceId[];
  /** Project decisions are separate from original-source provenance. */
  readonly projectDecisions: readonly ('Q1' | 'Q2' | 'Q3')[];
  readonly status: 'assistant-checked';
  readonly humanAcceptance: 'pending';
}

export interface Scope {
  readonly module: ModuleId;
  /** A pinned local source revision; not a claim about the official publication edition. */
  readonly revision: 'local-2026-11-08';
  readonly edition: 'base';
  readonly anniversaryOverlay: false;
}

export interface RuleBase {
  readonly id: string;
  readonly name: string;
  readonly scope: Scope;
  readonly evidence: Evidence;
  readonly unresolved: readonly string[];
}

export interface SettingRule extends RuleBase {
  readonly kind: 'setting';
  readonly timing: 'setup';
  readonly setting: { readonly key: 'x-slot-count'; readonly value: 1 }
    | { readonly key: 'final-guess'; readonly value: false };
  readonly choice: 'none';
  readonly disclosure: 'public-module-setting';
  readonly interruption: 'not-applicable';
}

export interface CounterRule extends RuleBase {
  readonly kind: 'counter-effect';
  readonly activation: 'optional-mastermind-ability' | 'invoked-incident-effect';
  readonly timing: 'mastermind-ability' | 'incident-effect-entry';
  readonly snapshot: 'effect-entry';
  readonly owner: 'selected-x-slot' | 'current-ability-holder' | 'incident-invocation';
  readonly guard: 'owner-alive-and-present' | 'none';
  readonly choice: {
    readonly actor: 'mastermind' | 'none';
    readonly target: 'any-board' | 'alive-character-in-owner-area' | 'fixed-shrine';
    readonly includesSelf: boolean;
    readonly bindAt: 'effect-entry';
    readonly noLegalTarget: 'unavailable';
  };
  readonly limit: {
    readonly maximum: 1;
    readonly scope: 'loop' | 'phase';
    readonly key: 'rule-instance' | 'holder-and-ability';
    readonly consumeOn: 'source-completed';
    readonly resetOn: 'next-loop' | 'next-phase';
  } | null;
  /** The primitive transition is data. It is never a free-text instruction or callback. */
  readonly transition: {
    readonly kind: 'single-batch';
    readonly target: 'resolved-choice-target';
    readonly write: { readonly field: 'raw-counter'; readonly counter: 'intrigue' | 'paranoia' };
    readonly nextValue: {
      readonly operator: 'add';
      readonly before: { readonly read: 'target-written-field'; readonly snapshot: 'effect-entry' };
      readonly constant: 1 | 2;
    };
    readonly frame: 'other-base-fields-unchanged';
    readonly after: 'recompute-derived-state-and-required-triggers';
  };
  readonly interruption: 'finish-current-batch-and-required-followups';
  readonly disclosure: 'public-counter-change-only';
  /** Invocation does not prove that a scheduled incident occurred. */
  readonly recordsIncidentOccurrence: false;
  readonly integration: 'requires-lifecycle-and-modifier-engine';
}

export type RuleDefinition = SettingRule | CounterRule;
