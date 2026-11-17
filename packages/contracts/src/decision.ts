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

export type DecisionGoal =
  | { kind: 'game' }
  | { kind: 'seat-win'; seat: Protagonist }
  | { kind: 'survival'; target: string; maxAbilities?: number };
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
  seat?: Protagonist;
  choice: Choice;
  reportsBefore: number;
  responses: { when: PolicyView; then: PolicyNode }[];
}
export interface PolicyAdvice {
  status: 'guaranteed' | 'no-guaranteed-policy' | 'unknown' | 'no-candidates';
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
export interface DecisionAnalysis {
  module: Module;
  sheet?: { loops: number; days: number; incidents: { day: number; name: string }[] };
  goal: DecisionGoal;
  view?: PolicyView;
  worlds: number;
  exhaustive: boolean;
  historyWork?: number;
  historyReason?: string;
  generatedSetups?: number;
  advice?: PolicyAdvice;
  verification?: PublicVerification;
  suggestedInvestigation?: InvestigationOptions;
  investigation?: { options: InvestigationOptions; result: InvestigationResult };
  scriptPruning?: {
    skippedSetups: number;
    skippedChoices: number;
    sources: {
      kind: 'culprit' | 'culprit-answers' | 'initial-answer' | 'personal-role';
      report?: number;
    }[];
  };
}
