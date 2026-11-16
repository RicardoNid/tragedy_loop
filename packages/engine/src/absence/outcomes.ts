import type {
  Actor,
  Area,
  CardKind,
  Board,
  Counter,
  Observation,
  PublicCharacter,
} from '../../../contracts/src/game.js';
import type { EngineState } from '../runtime/model.js';
import { canonical } from '../runtime/model.js';

export interface ShownCard {
  owner: Actor;
  target: string;
  kind: CardKind;
}
export function cardSignature(cards: readonly ShownCard[]) {
  return canonical(cards.map(({ owner, target, kind }) => canonical([owner, target, kind])).sort());
}

/** Each rule applies to exactly one closed interval between phase boundaries. */
export type OutcomeRule =
  | { kind: 'cards'; placements: readonly ShownCard[] }
  | { kind: 'no-death'; character: string }
  | { kind: 'winner'; winner: NonNullable<EngineState['winner']> }
  | { kind: 'incident'; name: string; occurred: boolean }
  | {
      kind: 'report';
      type: Observation['type'];
      fields?: Readonly<Record<string, unknown>>;
      min?: number;
      max?: number;
    }
  | {
      kind: 'ability-completed';
      character: string;
      ability: string;
      choices?: Readonly<Record<string, string>>;
    }
  | {
      kind: 'character';
      character: string;
      area?: Area;
      status?: PublicCharacter['status'];
      counters?: Partial<Record<Counter, number>>;
    }
  | { kind: 'board'; board: Board; intrigue: number }
  | { kind: 'ex'; value: number };

export interface MissingReport {
  type: Observation['type'];
  fields?: Readonly<Record<string, unknown>>;
}

function matches(value: unknown, fields: Readonly<Record<string, unknown>>) {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(fields).every(
    ([k, v]) =>
      Object.hasOwn(value, k) && canonical((value as Record<string, unknown>)[k]) === canonical(v),
  );
}

export function compileOutcomes(absent: readonly MissingReport[], rules: readonly OutcomeRule[]) {
  const admissions: ((state: EngineState, phase: Observation['phase'], day: number) => boolean)[] =
    [];
  const reports: {
    type: Observation['type'];
    fields?: Readonly<Record<string, unknown>>;
    test?: (o: Observation) => boolean;
    min: number;
    max: number;
  }[] = [];
  const close: ((state: EngineState, auditStart: number) => boolean)[] = [];
  for (const p of absent) reports.push({ ...p, min: 0, max: 0 });
  for (const r of rules) {
    switch (r.kind) {
      case 'cards': {
        const signature = cardSignature(r.placements);
        reports.push({
          type: 'cards',
          min: 1,
          max: Infinity,
          test: (o) =>
            o.phase === 'card-resolution' &&
            Array.isArray(o.data.placements) &&
            cardSignature(o.data.placements as ShownCard[]) === signature,
        });
        admissions.push((_s, phase) => phase === 'card-resolution');
        break;
      }
      case 'no-death':
        close.push(
          (s, start) =>
            !s.audit
              .slice(start)
              .some((a) => a.kind === 'character-died' && a.data === r.character),
        );
        break;
      case 'winner':
        close.push((s) => s.winner === r.winner);
        break;
      case 'incident':
        admissions.push(
          (s, phase, day) =>
            phase === 'incident' &&
            s.setup.incidents.some((i) => i.day === day && (i.publicName ?? i.name) === r.name),
        );
        reports.push({
          type: 'incident',
          fields: { name: r.name, occurred: !r.occurred },
          min: 0,
          max: 0,
        });
        reports.push({
          type: 'incident',
          fields: { name: r.name, occurred: r.occurred },
          min: 1,
          max: Infinity,
        });
        break;
      case 'report': {
        const min = r.min ?? (r.max === undefined ? 1 : 0),
          max = r.max ?? Infinity;
        if (
          !Number.isSafeInteger(min) ||
          min < 0 ||
          (r.max !== undefined && !Number.isSafeInteger(max)) ||
          min > max
        )
          throw Error('Invalid report count');
        reports.push({ type: r.type, fields: r.fields, min, max });
        break;
      }
      case 'ability-completed':
        close.push((s, start) =>
          s.audit
            .slice(start)
            .some(
              (a) =>
                a.kind === 'source-completed' &&
                matches(a.data, { owner: r.character, ability: r.ability }) &&
                matches((a.data as { choices: unknown }).choices, r.choices ?? {}),
            ),
        );
        break;
      case 'character':
        close.push((s) => {
          const c = s.characters[r.character];
          return (
            !!c &&
            (r.area === undefined || c.area === r.area) &&
            (r.status === undefined || c.status === r.status) &&
            matches(c.counters, r.counters ?? {})
          );
        });
        break;
      case 'board':
        close.push((s) => s.boards[r.board] === r.intrigue);
        break;
      case 'ex':
        close.push((s) => s.ex === r.value);
        break;
    }
  }
  const byType = new Map<Observation['type'], number[]>();
  reports.forEach((p, i) => {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type)!.push(i);
  });
  return {
    admits: (s: EngineState, phase: Observation['phase'], day: number) =>
      admissions.every((test) => test(s, phase, day)),
    initial: () => reports.map(() => 0),
    accept(o: Observation, counts: number[]) {
      for (const i of byType.get(o.type) ?? []) {
        const p = reports[i]!;
        if (matches(o.data, p.fields ?? {}) && (!p.test || p.test(o))) {
          counts[i] = counts[i]! + 1;
          if (counts[i]! > p.max) return false;
        }
      }
      return true;
    },
    closed(s: EngineState, auditStart: number, counts: number[]) {
      return (
        reports.every((p, i) => counts[i]! >= p.min) && close.every((test) => test(s, auditStart))
      );
    },
  };
}
