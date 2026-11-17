import type {
  Actor,
  Board,
  CardKind,
  CardPlacement,
  Choice,
  Decision,
  Module,
  Observation,
  Phase,
  Protagonist,
  PublicCharacter,
} from './game.js';
import type { InvestigationOptions, InvestigationResult } from './investigation.js';
import type { CoverageResult, CoverageCheck } from './coverage.js';

export type DecisionGoal =
  | { kind: 'game' }
  | { kind: 'seat-win'; seat: Protagonist }
  | { kind: 'survival'; target: string; maxAbilities?: number };
export type MastermindGoal = { kind: 'loop-failure' } | { kind: 'mastermind-win' };
export interface PolicyView {
  loop: number;
  day: number;
  phase: Phase;
  captain: Protagonist;
  markers?: { communicated: string[]; died: string[] };
  personalRole?: 'A' | 'B' | 'C';
  reports: Observation[];
  menu: Pick<Decision, 'actor' | 'kind' | 'areas' | 'options'>;
  targets?: string[];
  answerKind?: 'identities' | 'culprits';
  territory?: Board;
  boards: Record<Board, number>;
  ex: number;
  ownCards: {
    id: string;
    owner: Actor;
    kind: CardKind;
    status: 'hand' | 'set' | 'used' | 'removed';
  }[];
  placements: CardPlacement[];
  curses?: string[];
  characters: PublicCharacter[];
}
export interface PolicyNode {
  seat?: Actor;
  choice: Choice;
  reportsBefore: number;
  responses: { when: PolicyView; then: PolicyNode }[];
}
export interface PolicyAdvice {
  status: 'guaranteed' | 'no-guaranteed-policy' | 'unknown' | 'no-candidates' | 'illegal-opening';
  work: number;
  reusedProofs?: number;
  reason?: 'limit' | 'unsupported' | 'incomplete';
  policy?: PolicyNode;
}
export type PolicyFailure =
  | 'lost'
  | 'death'
  | 'left-play'
  | 'illegal-choice'
  | 'missing-response'
  | 'ambiguous-response'
  | 'invalid-node'
  | 'ability-limit';
export interface PublicVerification {
  status: 'verified' | 'counterexample' | 'unknown' | 'no-candidates';
  work: number;
  winningLeaves: number;
  reason?: PolicyFailure | 'limit' | 'unsupported' | 'incomplete';
  counterexample?: {
    at: Pick<PolicyView, 'loop' | 'day' | 'phase'>;
    reports: Observation[];
    question?: PolicyView;
  };
}
export interface Scenario {
  id: string;
  title: string;
  module: Module;
  description: string;
}
export interface DayEndPruning {
  checked: number;
  compiled: number;
  excluded: number;
  windows: {
    firstReport: number;
    lastReport: number;
    loop: number;
    day: number;
    branches: number;
    example: { ability: string; owner: string; roles: Record<string, string> };
  }[];
}
export interface IncidentConflict {
  report: number;
  day: number;
  loop: number;
  culprit: string;
  predicted: boolean;
}
export interface DecisionAnalysis {
  coverage?: CoverageResult;
  coverageCheck?: CoverageCheck;
  opening?: Choice;
  actionInput?: { cardCount?: number; identities?: string[] };
  module: Module;
  sheet?: { loops: number; days: number; incidents: { day: number; name: string }[] };
  goal: DecisionGoal;
  view?: PolicyView;
  worlds: number;
  exhaustive: boolean;
  historyWork?: number;
  dayEndPruning?: DayEndPruning;
  historyReason?: string;
  generatedSetups?: number;
  advice?: PolicyAdvice;
  verification?: PublicVerification;
  suggestedInvestigation?: InvestigationOptions;
  investigation?: { options: InvestigationOptions; result: InvestigationResult };
  scriptPruning?: {
    incidentExamples?: IncidentConflict[];
    skippedSetups: number;
    skippedChoices: number;
    sources: {
      kind:
        | 'culprit'
        | 'culprit-answers'
        | 'initial-answer'
        | 'personal-role'
        | 'incident-outcome'
        | 'missing-loop-grant'
        | 'missing-plot-grant';
      plot?: '超越世界线';
      character?: string;
      grant?: 'hope+1' | 'despair+1';
      endReport?: number;
      report?: number;
      occurred?: boolean;
    }[];
  };
}
