import type {
  Actor,
  Choice,
  GameSetup,
  Observation,
  PlayerView,
  CharacterSetup,
  MastermindView,
  PublicCharacter,
  Protagonist,
  ScheduledIncident,
} from './game.js';

export interface ReviewEngineTrace
  extends Pick<PlayerView, 'revision' | 'loop' | 'day' | 'phase' | 'winner'> {
  setup: GameSetup;
  ruleDigest: string;
  choices: { actor: Actor; decisionId: string; choice: Choice }[];
  audit: { kind: string; data: unknown }[];
  observations: Observation[];
}

/** Full board for the local test UI. Normal player ports keep their seat-specific projections. */
export interface MastermindReviewView extends MastermindView {
  secret: MastermindView['secret'] & {
    roster: (PublicCharacter & CharacterSetup & { initialIdentity: string; appeared: boolean })[];
    occurred: (ScheduledIncident & { loop: number })[];
    activeAlternateY?: string;
    seatRoles?: Record<Protagonist, 'A' | 'B' | 'C'>;
  };
}
