import type { GameSetup, Protagonist, ScheduledIncident } from '../../../contracts/src/game.js';
import { acceptedIdentities } from '../runtime/final-answers.js';
import type { EngineState, RulePack } from '../runtime/model.js';
import type { DecisionEvidence } from './observed-worlds.js';

type DayFact = { kind: 'culprit'; day: number; culprit: string; report: number };
type TupleFact = {
  kind: 'culprit-answers';
  answers: Record<string, string>;
  correct: boolean;
  report: number;
};
type GuessFact = {
  kind: 'initial-answer';
  character: string;
  answer: string;
  reverseChecked: boolean;
  reverse?: string;
  correct: boolean;
  report: number;
};
type SeatFact = { kind: 'personal-role'; seat: Protagonist; role: 'A' | 'B' | 'C' };
type Fact = DayFact | TupleFact | GuessFact | SeatFact;

/** Only assertions about immutable script fields belong here. An ordinary
 * identity announcement may be a Ninja declaration or an effective identity
 * in a later loop. Same-identity reports also concern living effective roles. */
export function compileScriptEvidence(evidence: DecisionEvidence): ScriptEvidence {
  const facts: Fact[] = [];
  if (evidence.coverage !== 'complete' || evidence.sheet.specialRules.length)
    return new ScriptEvidence(facts);
  const reports = evidence.view.reports;
  const days = evidence.sheet.incidents.map((i) => String(i.day));
  for (const [i, o] of reports.entries()) {
    const d = o.data;
    if (!d) continue;
    if (
      o.type === 'culprit' &&
      typeof d.day === 'number' &&
      days.includes(String(d.day)) &&
      typeof d.culprit === 'string'
    )
      facts.push({ kind: 'culprit', day: d.day, culprit: d.culprit, report: o.sequence });
    if (
      o.phase === 'final-guess' &&
      o.type === 'culprit' &&
      typeof d.correct === 'boolean' &&
      d.guesses &&
      typeof d.guesses === 'object' &&
      !Array.isArray(d.guesses)
    ) {
      const entries = Object.entries(d.guesses);
      if (
        entries.length === days.length &&
        entries.every(([key, v]) => days.includes(key) && typeof v === 'string')
      )
        facts.push({
          kind: 'culprit-answers',
          answers: Object.fromEntries(entries),
          correct: d.correct,
          report: o.sequence,
        });
    }
    if (
      o.phase === 'final-guess' &&
      o.type === 'identity' &&
      typeof d.character === 'string' &&
      typeof d.guess === 'string' &&
      typeof d.correct === 'boolean'
    ) {
      // The engine publishes the verdict, then confirms the actor's command.
      // Without a matching command a negative verdict may concern the reverse.
      const follow = reports[i + 1];
      const choice = follow?.type === 'own-choice' ? follow.data.choice : undefined;
      const guess =
        choice &&
        typeof choice === 'object' &&
        'kind' in choice &&
        choice.kind === 'guess' &&
        'character' in choice &&
        choice.character === d.character &&
        'identity' in choice &&
        choice.identity === d.guess
          ? choice
          : undefined;
      const reverse = guess && 'reverseIdentity' in guess ? guess.reverseIdentity : undefined;
      if (typeof reverse === 'string' || reverse === undefined)
        facts.push({
          kind: 'initial-answer',
          character: d.character,
          answer: d.guess,
          correct: d.correct,
          report: o.sequence,
          reverseChecked: !!guess,
          ...(typeof reverse === 'string' && { reverse }),
        });
    }
  }
  if (evidence.sheet.module === 'LL' && evidence.seat && evidence.view.personalRole)
    facts.push({ kind: 'personal-role', seat: evidence.seat, role: evidence.view.personalRole });
  return new ScriptEvidence(facts);
}

export class ScriptEvidence {
  private readonly fixedDays = new Map<number, Set<string>>();
  private readonly guesses = new Map<string, GuessFact[]>();
  private readonly tuples: TupleFact[] = [];
  private readonly seats: SeatFact[] = [];
  constructor(readonly facts: readonly Fact[]) {
    const record = (day: number, who: string) => {
      const found = this.fixedDays.get(day) ?? new Set<string>();
      found.add(who);
      this.fixedDays.set(day, found);
    };
    for (const f of facts) {
      if (f.kind === 'culprit') record(f.day, f.culprit);
      else if (f.kind === 'culprit-answers') {
        if (f.correct) for (const [day, who] of Object.entries(f.answers)) record(Number(day), who);
        else this.tuples.push(f);
      } else if (f.kind === 'personal-role') this.seats.push(f);
      else {
        const rows = this.guesses.get(f.character) ?? [];
        rows.push(f);
        this.guesses.set(f.character, rows);
      }
    }
  }
  allowsCulprit(day: number, who: string) {
    const fixed = this.fixedDays.get(day);
    return !fixed || (fixed.size === 1 && fixed.has(who));
  }
  allowsTuple(schedule: readonly ScheduledIncident[]) {
    return !this.tuples.some((f) => schedule.every((i) => f.answers[String(i.day)] === i.culprit));
  }
  allowsShuffle(shuffle: GameSetup['privateRoles']) {
    return this.seats.every((f) => shuffle?.[f.seat] === f.role);
  }
  allowsIdentity(pack: RulePack, id: string, front: string, back?: string) {
    return (this.guesses.get(id) ?? []).every((f) => {
      const frontRight = acceptedIdentities(pack, front).includes(f.answer);
      if (!f.reverseChecked) return !f.correct || frontRight;
      return (frontRight && back === f.reverse) === f.correct;
    });
  }
  allowsBaseRole(pack: RulePack, id: string, role: string | [string, string]) {
    const [front, back] = typeof role === 'string' ? [role, undefined] : role;
    return (
      this.allowsIdentity(pack, id, front!, back) ||
      (pack.anniversary && front === '平民' && this.allowsIdentity(pack, id, '因果残片', back))
    );
  }
  allowsState(pack: RulePack, s: EngineState) {
    if (!this.facts.length) return true;
    if (
      !this.allowsShuffle(s.setup.privateRoles) ||
      !this.allowsTuple(s.setup.incidents) ||
      s.setup.incidents.some((i) => !this.allowsCulprit(i.day, i.culprit))
    )
      return false;
    for (const id of this.guesses.keys()) {
      const c = s.characters[id],
        setup = s.setup.characters.find((row) => row.id === id);
      if (!c || !this.allowsIdentity(pack, id, c.initialIdentity, setup?.reverseIdentity))
        return false;
    }
    return true;
  }
}
