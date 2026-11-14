/** Wire values only. Full engine state and audit records are never player responses. */
export type Protagonist = 'p0' | 'p1' | 'p2';
export type Actor = 'mastermind' | Protagonist;
export type Observer = Actor | 'protagonists';
export type Board = 'hospital' | 'shrine' | 'city' | 'school';
export type Area = Board | 'far';
export type Counter = 'goodwill' | 'paranoia' | 'intrigue' | 'guard' | 'hope' | 'despair';
export type Counters = Record<Counter, number>;
export type Module = 'FS' | 'BTX' | 'MZ' | 'MC' | 'HSA' | 'WM' | 'AHR' | 'LL';
export type Phase =
  | 'briefing'
  | 'discussion'
  | 'loop-start'
  | 'day-start'
  | 'mastermind-cards'
  | 'protagonist-cards'
  | 'card-resolution'
  | 'mastermind-abilities'
  | 'protagonist-abilities'
  | 'incident'
  | 'captain-change'
  | 'day-end'
  | 'loop-end'
  | 'final-guess'
  | 'finished';
export type CardKind =
  | 'horizontal'
  | 'vertical'
  | 'diagonal'
  | 'block-movement'
  | 'goodwill+1'
  | 'goodwill+2'
  | 'block-goodwill'
  | 'paranoia+1'
  | 'paranoia+2'
  | 'paranoia-1'
  | 'block-paranoia'
  | 'intrigue+1'
  | 'intrigue+2'
  | 'block-intrigue'
  | 'hope+1'
  | 'despair+1';
export interface CharacterSetup {
  id: string;
  character: string;
  identity: string;
  initialArea?: Area;
  enterDay?: number;
  enterLoop?: number;
  x?: number;
  territory?: Board;
  copiedFrom?: string;
  reverseIdentity?: string;
}
export interface ScheduledIncident {
  day: number;
  name: string;
  publicName?: string;
  culprit: string;
}
export interface GameSetup {
  module: Module;
  anniversary: boolean;
  loops: number;
  days: number;
  y: string;
  x: string[];
  characters: CharacterSetup[];
  incidents: ScheduledIncident[];
  captain: Protagonist;
  discussion: 'allowed' | 'between-loops';
  /** Public scenario sheet text, displayed verbatim. */
  publicSpecialRules?: string[];
  alternateY?: string;
  /** After ordinary allocation, this civilian receives the anniversary identity. */
  anniversaryFragment?: string;
  /** Trusted host input: recorded shuffle outcome, never returned to the mastermind. */
  privateRoles?: Record<Protagonist, 'A' | 'B' | 'C'>;
  secretAddition?: '杀手' | '主谋' | '因果残片';
}
export interface PublicCharacter {
  id: string;
  character: string;
  area: Area;
  status: 'alive' | 'dead' | 'absent' | 'removed';
  counters: Counters;
}
export interface CardPlacement {
  owner: Actor;
  target: string;
  card?: string;
  kind?: CardKind;
}
export interface Decision {
  id: string;
  actor: Actor;
  kind: 'cards' | 'ability' | 'choice' | 'refusal' | 'continue' | 'guess';
  /** Only menus that the recipient is entitled to see are projected. */
  options: Choice[];
  cardPlacement?: { count: number; cards: string[]; targets: string[] };
  areas?: Record<string, Area>;
  answerKind?: 'identities' | 'culprits';
}
export type Choice =
  | { kind: 'start' }
  | { kind: 'continue' }
  | { kind: 'request-final-guess' }
  | { kind: 'vote-final-guess'; agree: boolean }
  | { kind: 'pass' }
  | { kind: 'cards'; placements: { card: string; target: string }[] }
  | { kind: 'ability'; ability: string; owner?: string; choices?: Record<string, string> }
  | { kind: 'select'; value: string }
  | { kind: 'refuse'; refuse: boolean }
  | { kind: 'guess'; character: string; identity: string; reverseIdentity?: string }
  | { kind: 'guess-culprits'; answers: Record<string, string> };
export interface Command {
  id: string;
  expectedRevision: number;
  decisionId: string;
  choice: Choice;
}
export interface Observation {
  /** Observer-local ordering; never an index into secret audit events. */
  sequence: number;
  loop: number;
  day: number;
  phase: Phase;
  type:
    | 'boundary'
    | 'board'
    | 'character'
    | 'cards'
    | 'incident'
    | 'refused'
    | 'identity'
    | 'rule'
    | 'culprit'
    | 'failure'
    | 'victory'
    | 'card-grant'
    | 'no-effect'
    | 'declaration'
    | 'own-choice';
  data: Record<string, unknown>;
}
export interface PlayerView {
  revision: number;
  module: Module;
  anniversary: boolean;
  loops: number;
  days: number;
  loop: number;
  day: number;
  phase: Phase;
  captain: Protagonist;
  discussionAllowed: boolean;
  publicSpecialRules?: string[];
  characters: PublicCharacter[];
  /** Optional roster explicitly supplied as public scenario information. */
  roster?: { id: string; character: string }[];
  boards: Record<Board, number>;
  territory?: Board;
  ex?: number;
  curses?: { id: string; target: string }[];
  markers?: { communicated: string[]; died: string[] };
  incidents: { day: number; name: string }[];
  placements: CardPlacement[];
  hands: Partial<
    Record<Actor, { id: string; kind: CardKind; status: 'hand' | 'set' | 'used' | 'removed' }[]>
  >;
  observations: Observation[];
  decision?: Decision;
  winner?: 'mastermind' | 'protagonists' | Protagonist;
  winners?: Actor[];
  personalRole?: 'A' | 'B' | 'C';
}
export interface MastermindView extends PlayerView {
  secret: {
    y: string;
    x: string[];
    characters: CharacterSetup[];
    incidents: ScheduledIncident[];
    alternateY?: string;
    anniversaryFragment?: string;
    secretAddition?: string;
  };
}
export type PlayerResult<V extends PlayerView> =
  | { status: 'ok' | 'paused'; view: V }
  | { status: 'rejected'; reason: 'invalid-command' | 'stale-revision' | 'not-your-decision' };
/** Authentication binds a port to its actor; caller-supplied actor fields are never trusted. */
export interface ProtagonistPort {
  view(): PlayerView;
  submit(command: Command): PlayerResult<PlayerView>;
}
export interface MastermindPort {
  view(): MastermindView;
  submit(command: Command): PlayerResult<MastermindView>;
}
