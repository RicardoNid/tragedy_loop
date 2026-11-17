import type { Observation, PlayerView } from './game.js';

/** Only public opening information crosses into the solver. */
export interface KnowledgeInput {
  opening: PlayerView;
  history: Observation[];
  revision: number;
  /** Append-only transport offset; history is a suffix when present. */
  after?: number;
  verifyAll?: boolean;
}
export interface CompoundSettlement {
  variables: string[];
  participants: string[];
  branches: number;
  unresolved: boolean;
}
export interface KnowledgeView {
  revision: number;
  ruleDigest: string;
  status:
    | 'waiting'
    | 'running'
    | 'exact'
    | 'incomplete'
    | 'unsupported'
    | 'contradiction'
    | 'error';
  /** Symbolic mode: all initial variable domains exist, but may contain unverified values. */
  domainComplete: boolean;
  /** In symbolic mode these are tested configurations/witnesses, NOT the joint solution count. */
  generated: number;
  possible: number;
  unresolved: number;
  excluded: number;
  expansions: number;
  elapsedMs: number;
  identities: Record<string, string[]>;
  /** Identity required by every local explanation of this public observation. */
  impliedIdentities?: Record<string, { identity: string; observation: number }>;
  calculationTrace?: {
    observation: number;
    removed: number;
    mode: 'local' | 'history' | 'joint';
    reason: string;
    alternatives?: string[];
    compound?: CompoundSettlement;
  }[];
  rules: string[];
  culprits: Record<string, string[]>;
  reasons: string[];
  evidenceThrough: number;
  deductions?: { observation: number; removed: number; reason: string }[];
  /** Persistent conditional relations; candidate matrices are only projections of these constraints. */
  relations?: {
    id: string;
    observation: number;
    fact: string;
    implications: string[];
    cases: { when: string[]; alternatives: string[]; limits: string[]; notes: string[] }[];
  }[];
  transition?: {
    fromVersion: number;
    toVersion: number;
    firstObservation: number;
    lastObservation: number;
    historyCandidates?: number[];
    newHistoryRoots?: number;
    historyBranches?: number;
  };
  /** Latest local cause analysis. Skipped entries remain in the global domain. */
  scope?: {
    kind: 'board-intrigue' | 'incident-occurrence' | 'mandatory-absence' | 'visible-effect';
    alternatives?: string[];
    fields?: { field: string; alternatives?: string[] }[];
    needsHistory?: boolean;
    locallyExplained?: boolean;
    /** This report only advanced the public board; no hidden-source search was necessary. */
    publicSettlement?: boolean;
    /** Partial projection for one settlement, never a full-script model count. */
    compound?: CompoundSettlement;
    observation: number;
    phase: string;
    target: string;
    characters: string[];
    rules: string[];
    events: string[];
    skippedCharacters: string[];
    skippedRules: string[];
    skippedEvents: string[];
    conservative: string[];
    deferred: boolean;
  };
  openingColumns?: { identities: string[]; rules: string[]; culprits: string[]; days: string[] };
  historySearchDeferred?: boolean;
  representation?: 'constraints';
  /** Exact surviving configuration count only after joint enumeration and replay finish. */
  jointCount?: number | null;
  ruleCombinations?: { y: string; x: string[] }[];
  realIncidents?: Record<string, string[]>;
  parameters?: Record<string, string[]>;
  verified?: {
    identities: Record<string, string[]>;
    rules: string[];
    culprits: Record<string, string[]>;
    realIncidents: Record<string, string[]>;
  };
  propagation?: {
    checks: number;
    removed: number;
    branches: number;
    informationVersion: number;
    constraintVersion: number;
    pending: number;
    candidateValues: number;
    verifiedValues: number;
    initializations: number;
    historyComparisons: number;
    causeBranches?: number;
  };
}
