import { completeObservationGroups, type Observation } from '../../../contracts/src/game.js';
import type { AbsenceWindow } from './index.js';

/** Entry is the full public position at the supplied day-end boundary.
 * The slice begins at that boundary and ends at the next boundary (or delivery cutoff).
 * Only a normally completed day certifies silence. Reaction windows can be supplied separately. */
export function observeDayEnd(
  entry: AbsenceWindow['entry'],
  reports: readonly Observation[],
): AbsenceWindow {
  const window: AbsenceWindow = {
    entry,
    timing: { kind: 'day-end' },
    coverage: 'partial',
    absent: [],
  };
  const first = reports[0],
    last = reports.at(-1);
  if (
    !first ||
    !last ||
    reports.length < 2 ||
    entry.phase !== 'day-end' ||
    first.type !== 'boundary' ||
    first.phase !== 'day-end' ||
    first.data.phase !== first.phase ||
    last.type !== 'boundary' ||
    last.data.phase !== last.phase ||
    reports.some((o, i) => o.sequence !== first.sequence + i) ||
    completeObservationGroups(reports, false).flat().length !== reports.length
  )
    return window;
  // World movement and curses can change effective identities or the board before the mandatory batch.
  if (entry.module === 'AHR' || entry.module === 'HSA') return window;
  const day = reports.slice(0, -1);
  if (
    day.some(
      (o, i) =>
        o.phase !== entry.phase ||
        o.day !== entry.day ||
        o.loop !== entry.loop ||
        (i > 0 && o.type === 'boundary'),
    )
  )
    return window;
  if (
    day.some((o) => o.type === 'failure' || o.type === 'victory') ||
    last.loop !== entry.loop ||
    (entry.day === entry.days
      ? last.phase !== 'loop-end' || last.day !== entry.day
      : last.phase !== 'day-start' || last.day !== entry.day + 1)
  ) {
    return { ...window, coverage: 'interrupted' };
  }
  const survived = new Set(entry.characters.filter((c) => c.status === 'alive').map((c) => c.id));
  const concealed = new Set(entry.characters.map((c) => c.id));
  for (const o of day) {
    if (o.type === 'board' && typeof o.data.diedMarker === 'string')
      survived.delete(o.data.diedMarker);
    if (o.type !== 'character' && o.type !== 'identity') continue;
    const id = o.data.character;
    if (typeof id !== 'string') return window;
    if (o.type === 'identity') concealed.delete(id);
    else if (o.data.status !== 'alive') survived.delete(id);
  }
  return {
    ...window,
    coverage: 'complete',
    absent: [
      ...Array.from(survived, (character) => ({ phenomenon: 'death' as const, character })),
      ...Array.from(concealed, (character) => ({
        phenomenon: 'identity-reveal' as const,
        character,
      })),
    ],
  };
}
