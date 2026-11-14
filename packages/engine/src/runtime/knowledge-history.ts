import type { Choice, GameSetup, Observation, PlayerView } from '../../../contracts/src/game.js';
import { advance, initializeDiscussion } from './engine.js';
import { canonical, type EngineState, type RulePack } from './model.js';
import { normalizeHistory } from './reference.js';
import { enumerateChoices } from './replay.js';
import { hasUnsupportedDiagnostic } from './setup.js';

interface Node {
  state: EngineState;
  normalized: string[];
  matched: number;
  choices?: Generator<Choice>;
  choicesVersion?: number;
  tried?: Set<string>;
}
export interface EvidenceLog {
  observations: Observation[];
  normalized: string[];
  version: number;
}

/** Absent characters remain in the public roster, with no observed initial area. */
export function matchesOpeningRoster(state: EngineState, opening: PlayerView) {
  const actual = Object.values(state.characters);
  const roster = opening.roster ?? opening.characters.filter((c) => c.character !== '临时工？');
  return (
    (!opening.territory || state.publicTerritory === opening.territory) &&
    actual.filter((c) => c.character !== '临时工？').length === roster.length &&
    roster.every((c) => actual.some((a) => a.id === c.id && a.character === c.character)) &&
    opening.characters.every((c) =>
      actual.some(
        (a) =>
          a.id === c.id &&
          a.character === c.character &&
          a.area === c.area &&
          a.status === c.status,
      ),
    ) &&
    actual.every(
      (c) =>
        c.character === '临时工？' ||
        c.status === 'absent' ||
        opening.characters.some((v) => v.id === c.id),
    )
  );
}

/** One setup, persistent alternative-action stack. A witness is not the entire belief frontier. */
export class HistorySearch {
  private active: Node[] = [];
  private witness?: Node;
  private version = -1;
  private uncertain = false;
  expansions = 0;
  compared = 0;
  constructor(
    private pack: RulePack,
    setup: GameSetup,
    private evidence: EvidenceLog,
    opening: PlayerView,
  ) {
    const result = initializeDiscussion(pack, setup);
    if (!result.state) {
      this.uncertain = hasUnsupportedDiagnostic(result.diagnostics);
      return;
    }
    if (!matchesOpeningRoster(result.state, opening)) return;
    this.active.push({
      state: result.state,
      normalized: normalizeHistory(result.state.observations.protagonists),
      matched: 0,
    });
  }
  private sync() {
    if (this.version === this.evidence.version) return;
    // One engine action can emit several observations. If the saved witness
    // already spans the new prefix, only compare its previously unseen suffix.
    const node = this.witness;
    if (node && node.normalized.length >= this.evidence.normalized.length) {
      while (node.matched < this.evidence.normalized.length) {
        this.compared++;
        if (node.normalized[node.matched] !== this.evidence.normalized[node.matched]) break;
        node.matched++;
      }
      if (node.matched === this.evidence.normalized.length) {
        this.version = this.evidence.version;
        return;
      }
    }
    if (this.witness) this.active.push(this.witness);
    this.witness = undefined;
    this.version = this.evidence.version;
  }
  get result(): 'possible' | 'excluded' | 'unknown' {
    this.sync();
    return this.witness
      ? 'possible'
      : this.active.length || this.uncertain
        ? 'unknown'
        : 'excluded';
  }
  get blocked() {
    return this.uncertain && !this.active.length;
  }
  step() {
    this.sync();
    if (this.witness) return;
    const node = this.active.at(-1);
    if (!node) return;
    const end = Math.min(node.normalized.length, this.evidence.normalized.length);
    while (node.matched < end) {
      this.compared++;
      if (node.normalized[node.matched] !== this.evidence.normalized[node.matched]) {
        this.active.pop();
        return;
      }
      node.matched++;
    }
    if (node.normalized.length >= this.evidence.normalized.length) {
      this.witness = this.active.pop();
      return;
    }
    const pending = node.state.pending;
    if (!pending || node.state.winner) {
      if (!node.state.winner) this.uncertain = true;
      this.active.pop();
      return;
    }
    if (!node.choices || node.choicesVersion !== this.evidence.version) {
      const known = this.evidence.observations
        .slice(node.normalized.length)
        .find((o) => o.type === 'own-choice');
      node.choices =
        pending.actor !== 'mastermind' && known
          ? (function* () {
              if (known.data.actor === pending.actor) yield known.data.choice as Choice;
            })()
          : this.hiddenChoices(node.state, node.normalized.length);
      if (pending.kind === 'guess' && !known) this.uncertain = true;
      node.choicesVersion = this.evidence.version;
      node.tried ??= new Set();
    }
    const choice = node.choices.next();
    if (choice.done) {
      this.active.pop();
      return;
    }
    const choiceKey = canonical(choice.value);
    if (node.tried!.has(choiceKey)) return;
    node.tried!.add(choiceKey);
    this.expansions++;
    const next = advance(this.pack, node.state, pending.actor, {
      id: `knowledge-${node.state.revision}`,
      expectedRevision: node.state.revision,
      decisionId: pending.id,
      choice: choice.value,
    });
    if (next.status === 'rejected') return;
    if (next.status === 'paused') this.uncertain = true;
    const observations = next.state.observations.protagonists;
    this.active.push({
      state: next.state,
      matched: node.matched,
      normalized: [
        ...node.normalized,
        ...normalizeHistory(observations.slice(node.normalized.length)),
      ],
    });
  }
  private *hiddenChoices(state: EngineState, offset: number): Generator<Choice> {
    if (state.pending?.kind !== 'cards' || state.pending.actor !== 'mastermind') {
      yield* enumerateChoices(state);
      return;
    }
    const records = this.evidence.observations
      .slice(offset)
      .filter((o) => o.type === 'cards' && o.loop === state.loop && o.day === state.day);
    const known = records.find(
      (o) =>
        Array.isArray(o.data.placements) &&
        o.data.placements.every((p) => p.owner === 'mastermind'),
    );
    if (!Array.isArray(known?.data.placements)) {
      yield* enumerateChoices(state);
      return;
    }
    const targets: string[] = known.data.placements.map((p) => p.target);
    const revealed = records.find((o) => o.phase === 'card-resolution');
    const reveal = Array.isArray(revealed?.data.placements) ? revealed.data.placements : [];
    const cards = state.cards.filter((c) => c.owner === 'mastermind' && c.status === 'hand');
    function* place(i: number, placements: { card: string; target: string }[]): Generator<Choice> {
      if (i === targets.length) {
        yield {
          kind: 'cards',
          placements: placements
            .slice()
            .sort(
              (a, b) =>
                cards.findIndex((c) => c.id === a.card) - cards.findIndex((c) => c.id === b.card),
            ),
        };
        return;
      }
      const target = targets[i]!;
      const face = reveal.find((p) => p.owner === 'mastermind' && p.target === target)?.kind;
      for (const card of cards)
        if ((!face || card.kind === face) && !placements.some((p) => p.card === card.id))
          yield* place(i + 1, [...placements, { card: card.id, target }]);
    }
    yield* place(0, []);
  }
  get nodes() {
    return this.active.length + (this.witness ? 1 : 0);
  }
}
