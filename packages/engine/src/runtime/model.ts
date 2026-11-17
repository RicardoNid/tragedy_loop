import type {
  Actor,
  Area,
  Board,
  CardKind,
  Choice,
  Counters,
  Decision,
  GameSetup,
  Module,
  Observation,
  Phase,
} from '../../../contracts/src/game.js';

export const BOARDS: Board[] = ['hospital', 'shrine', 'city', 'school'];
export const COUNTERS = ['goodwill', 'paranoia', 'intrigue', 'guard', 'hope', 'despair'] as const;
export const zeroCounters = (): Counters => ({
  goodwill: 0,
  paranoia: 0,
  intrigue: 0,
  guard: 0,
  hope: 0,
  despair: 0,
});
export interface CharacterDefinition extends CharacterTraits {
  name: string;
  source: string;
  initial: Area[];
  forbidden: Board[];
  paranoia: number;
  attributes: string[];
  abilities: Ability[];
  supported: boolean;
}
export interface IdentityDefinition extends IdentityTraits {
  name: string;
  source: string;
  max?: number;
  ignore?: 'optional' | 'mandatory';
  puppet?: boolean;
  immortal?: boolean;
  abilities: Ability[];
  supported: boolean;
}
export interface PlotDefinition {
  name: string;
  source: string;
  type: 'Y' | 'X';
  identities: Record<string, number>;
  pair?: [string, string];
  abilities: Ability[];
  supported: boolean;
}
export interface IncidentDefinition {
  afterIncidentSteps?: Step[];
  name: string;
  source: string;
  steps: Step[];
  supported: boolean;
  thresholdOffset?: number;
  thresholdCounter?: 'goodwill' | 'intrigue';
  exGain?: number;
  crowdThreshold?: number;
}
export interface AbilityAreaRule {
  actor: Actor;
  modes: ('actual' | 'territory')[];
  publicMarker: 'territory';
  selection: 'before-declaration' | 'first-step';
}
export type IncidentAreaMode = 'actual' | 'diagonal' | 'clockwise';
export interface IncidentBehavior {
  execution?: 'cancel' | 'repeat' | 'proxy';
  privateTrigger?: boolean;
  maySuppress?: boolean;
  totalThreshold?: boolean;
  thresholdMultiplier?: number;
}
export interface CharacterTraits {
  incident?: IncidentBehavior;
  loopShrineIntrigue?: true;
  mastermindGoodwill?: { ability?: string; minimum: number; overrideThreshold?: number };
  mandatoryFirstMastermindAbility?: true;
  forbiddenInitial?: 'civilian' | 'ignores-goodwill';
  abilityArea?: AbilityAreaRule;
  incidentAreaFromBase?: IncidentAreaMode;
  protects?: { characters: string[]; selectedTargetFlag: string };
}
export interface IdentityTraits {
  /** On actual death, each living holder of this identity receives the amount. */
  partnerReaction?: { survivor: string; paranoia: number };
  baseIncidentArea?: IncidentAreaMode;
  sameAreaIncidentTrigger?: Condition;
}
export interface RulePack {
  setupRules: { xSlots: 1 | 2; optionalQuota: string; attribute?: { plot: string; identity: string; attribute: string; except: string } };
  moduleAbilities: { owner: string; ability: Ability }[];
  schema: 1;
  semanticVersion: string;
  digest: string;
  module: Module;
  anniversary: boolean;
  characters: Record<string, CharacterDefinition>;
  identities: Record<string, IdentityDefinition>;
  plots: Record<string, PlotDefinition>;
  incidents: Record<string, IncidentDefinition>;
}
export type Ref = string;
export interface Selector {
  kind: 'alive' | 'dead' | 'cards' | 'boards' | 'alive-or-boards';
  where?: Condition;
}
export type Value =
  | number
  | string
  | boolean
  | null
  | { ref: string }
  | {
      field:
        | 'area'
        | 'initialArea'
        | 'identity'
        | 'character'
        | 'status'
        | 'paranoiaLimit'
        | 'rawTotal'
        | 'kinds';
      target: Ref;
    }
  | { counter: keyof Counters; target: Ref; raw?: boolean }
  | { game: 'loop' | 'day' | 'days' | 'loops' | 'ex' | 'world' }
  | { gameFlag: string }
  | { count: Selector }
  | { sum: Selector; value: Value }
  | { op: 'add' | 'subtract' | 'min' | 'max'; args: Value[] };
export type Condition =
  | boolean
  | { cmp: 'eq' | 'ne' | 'ge' | 'gt' | 'le' | 'lt'; left: Value; right: Value }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { attribute: string; target: Ref }
  | { hasAbility: string; target: Ref }
  | { flag: string; target?: Ref }
  | { incidentOccurred: string };
export interface ChoiceSpec {
  key: string;
  actor?: Actor | 'captain' | `$${string}`;
  options: string[] | Selector;
  optional?: boolean;
  allowEmpty?: boolean;
}
export type Effect =
  | { op: 'counter'; target: Ref; counter: keyof Counters | '$counter'; amount: Value }
  | { op: 'clear'; target: Ref; counter?: keyof Counters }
  | { op: 'kill' | 'revive' | 'remove' | 'reveal-identity'; target: Ref }
  | { op: 'move'; target: Ref; area: Ref }
  | { op: 'move-corpse'; target: Ref; area: Ref }
  | { op: 'flag'; key: string; target?: Ref; value?: string }
  | {
      op: 'schedule';
      timing: Phase;
      day: Value;
      effects: Effect[];
      target?: Ref;
      loop?: Value;
      onlyIfMoved?: Ref;
    }
  | { op: 'protect-protagonists' | 'protagonist-death' | 'fail' | 'end-loop' }
  | { op: 'world-move' }
  | { op: 'grant'; side: 'mastermind' | 'protagonists'; card: 'hope+1' | 'despair+1' }
  | { op: 'ex'; amount: Value }
  | { op: 'reveal-rule'; rule: Ref }
  | { op: 'reveal-culprit'; day: Ref }
  | { op: 'recover-card'; card: Ref }
  | { op: 'transfer'; from: Ref; to: Ref; counter: Ref }
  | { op: 'replace'; target: Ref; from: keyof Counters; to: keyof Counters }
  | { op: 'place'; target: Ref; area: Ref }
  | { op: 'curse'; target: Ref; id?: string }
  | { op: 'same-identity'; target: Ref }
  | { op: 'invoke-goodwill'; target: Ref; ability: Ref }
  | { op: 'invoke-incident'; name: Ref; culprit: Ref }
  | { op: 'when'; condition: Condition; effects: Effect[] }
  | { op: 'each'; selector: Selector; effects: Effect[] };
export interface Step {
  choices?: ChoiceSpec[];
  effects: Effect[];
  condition?: Condition;
  moveOthersFromEffectiveArea?: boolean;
}
export interface Ability {
  id: string;
  source: string;
  timing: Phase | 'death' | 'incident-completed' | 'goodwill-completed';
  mandatory?: boolean;
  threshold?: number;
  cannotRefuse?: boolean;
  loopLimit?: number;
  sharedKey?: string;
  declarationArea?: string;
  condition?: Condition;
  steps: Step[];
}
export interface CharacterState {
  id: string;
  character: string;
  initialIdentity: string;
  identity: string;
  area: Area;
  initialArea: Area;
  status: 'alive' | 'dead' | 'removed' | 'absent';
  counters: Counters;
  flags: Record<string, string>;
  forbidden: Board[];
  attributes: string[];
  paranoiaLimit: number;
  revealed: boolean;
}
export interface Card {
  id: string;
  owner: Actor;
  kind: CardKind;
  once: boolean;
  status: 'hand' | 'set' | 'used' | 'removed';
}
export interface Frame {
  id: string;
  source: string;
  owner: string;
  actor: Actor;
  kind: 'ability' | 'incident' | 'mandatory';
  steps: Step[];
  step: number;
  choices: Record<string, string>;
  bound: Record<string, string>;
  ability?: Ability;
  incident?: string;
  occurrence?: boolean;
  nestedIncident?: boolean;
  incidentAreas?: Record<string, Area>;
  /** Mandatory cleanup can run after a latched loop end. */
  cleanup: boolean;
  awaiting?: string[];
}
export interface BatchWork {
  frames: Frame[];
  snapshot: ResolutionSnapshot;
}
export interface ResolutionSnapshot {
  characters: Record<string, CharacterState>;
  boards: Record<Board, number>;
  ex: number;
}
export interface EngineState {
  schema: 1;
  ruleDigest: string;
  setup: GameSetup;
  revision: number;
  loop: number;
  day: number;
  phase: Phase;
  phaseEntered: boolean;
  captain: 'p0' | 'p1' | 'p2';
  characters: Record<string, CharacterState>;
  boards: Record<Board, number>;
  ex: number;
  cards: Card[];
  placements: { card: string; target: string }[];
  failed: boolean;
  protagonistDead: boolean;
  endRequested: boolean;
  protected: boolean;
  flags: Record<string, string>;
  uses: Record<string, number>;
  previousLoop: ResolutionSnapshot | null;
  incidents: { loop: number; day: number; name: string; publicName: string; culprit: string }[];
  revealedIdentities: { character: string; identity: string; loop: number }[];
  appeared: string[];
  publicTerritory?: Board;
  frames: Frame[];
  batch: BatchWork | null;
  pending: Decision | null;
  refusal: Frame | null;
  winner?: 'mastermind' | 'protagonists' | 'p0' | 'p1' | 'p2';
  winners?: Actor[];
  latchedWinner?: 'p0' | 'p1' | 'p2';
  ll?: {
    roles: Record<'p0' | 'p1' | 'p2', 'A' | 'B' | 'C'>;
    communicated: string[];
    died: string[];
    finalTraitorsDisabled: boolean;
    finalEligible?: ('p0' | 'p1' | 'p2')[];
    cAnswered?: boolean;
  };
  observations: Record<'public' | 'protagonists' | 'mastermind', Observation[]>;
  audit: { kind: string; data: unknown }[];
  choices: { actor: Actor; decisionId: string; choice: Choice }[];
  /** Complete receipt contents, not only ID, are retained for safe retries. */
  receipts: Record<string, { command: string; revision: number }>;
  serial: number;
  diagnostic?: string;
  delayed?: { loop: number; day: number; timing: Phase; effects: Effect[]; env: Environment }[];
  curses?: { id: string; target: string }[];
}
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}
export type Environment = Record<string, string>;
export const clone = <T>(value: T): T => structuredClone(value);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
