import { completeObservationGroups, type Observation } from '../../../contracts/src/game.js';
import { canonical } from './model.js';

export function observationKey({ sequence: _sequence, ...observation }: Observation): string {
  return canonical(observation);
}

/** Canonical member order is used for comparison only. Preserve multiplicity and batch boundaries. */
export function orderedSettlement(group: Observation[]): Observation[] {
  if (group.length === 1) return group;
  return group
    .map((report) => {
      const o =
        report.simultaneousSize === undefined
          ? { ...report, simultaneousSize: group.length }
          : report;
      return { o, key: observationKey(o) };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ o }) => o);
}

export function normalizeHistory(history: Observation[]): string[] {
  return completeObservationGroups(history).flatMap((group) =>
    orderedSettlement(group).map(observationKey),
  );
}

/** Historical unframed reports can still be replayed in their recorded delivery order. */
export function matchesObservation(
  actual: string,
  expected: string,
  delivered: Observation,
): boolean {
  if (actual === expected) return true;
  if (delivered.simultaneousGroup === undefined && delivered.simultaneousSize === undefined)
    return false;
  const {
    sequence: _sequence,
    simultaneousGroup: _group,
    simultaneousSize: _size,
    ...legacy
  } = delivered;
  return canonical(legacy) === expected;
}
