import type { CharacterSetup, Observation } from '../../../contracts/src/game.js';

type Grant = 'hope+1' | 'despair+1';
export interface LoopGrantFact {
  kind: 'missing-loop-grant';
  character: string;
  grant: Grant;
  loop: number;
  endReport: number;
  report: number;
}

export interface PlotGrantFact {
  kind: 'missing-plot-grant';
  plot: '超越世界线';
  grant: Grant;
  loop: number;
  endReport: number;
  report: number;
}
type GrantEvidence = LoopGrantFact | PlotGrantFact;

/** The next discussion precedes the board reset. Freeze the previous board
 * there and count grants until normal entry into day one. Other sources can
 * satisfy the same once-per-recipient grant, so presence proves no identity. */
export function loopGrantEvidence(reports: readonly Observation[]): LoopGrantFact[];
export function loopGrantEvidence(
  reports: readonly Observation[],
  finalLoop: number,
): GrantEvidence[];
export function loopGrantEvidence(
  reports: readonly Observation[],
  finalLoop?: number,
): GrantEvidence[] {
  const facts: GrantEvidence[] = [];
  if (
    !reports.some(
      (o) => o.type === 'boundary' && o.phase === 'discussion' && (o.loop > 1 || finalLoop === 1),
    )
  )
    return facts;
  const pieces = new Map<string, Grant>();
  let loop = 0;
  let last: Observation | undefined;
  let window:
    | {
        loop: number;
        endReport: number;
        prior: Map<string, Grant>;
        seen: Set<string>;
        started: boolean;
      }
    | undefined;
  for (const [i, o] of reports.entries()) {
    if (o.sequence !== i + 1 || !o.data) return [];
    const d = o.data;
    if (o.type === 'boundary') {
      if (o.phase !== d.phase) return [];
      if (o.phase === 'discussion') {
        window =
          (last?.phase === 'loop-end' && last.loop === loop && loop + 1 === o.loop) ||
          (o.loop === 1 && loop === 0 && (!last || last.phase === 'briefing'))
            ? {
                loop: o.loop,
                endReport: o.sequence,
                prior: new Map(pieces),
                seen: new Set(),
                started: false,
              }
            : undefined;
      } else if (o.phase === 'loop-start') {
        if (window?.loop === o.loop && last?.phase === 'discussion' && o.day === 1)
          window.started = true;
        else window = undefined;
        loop = o.loop;
        pieces.clear();
      } else {
        if (window?.started && window.loop === o.loop && o.phase === 'day-start' && o.day === 1) {
          const { prior, seen } = window;
          const missing = (grant: Grant) =>
            (grant === 'hope+1' ? ['p0', 'p1', 'p2'] : ['mastermind']).some(
              (owner) => !seen.has(owner + '/' + grant),
            );
          if (finalLoop !== undefined) {
            const expected: Grant[] = [];
            if (loop % 2 === 0) expected.push('despair+1');
            if (loop === finalLoop) expected.push('hope+1');
            for (const grant of expected)
              if (missing(grant))
                facts.push({
                  kind: 'missing-plot-grant',
                  plot: '超越世界线',
                  loop,
                  grant,
                  endReport: window.endReport,
                  report: o.sequence,
                });
          }
          for (const [character, grant] of prior) {
            if (missing(grant))
              facts.push({
                kind: 'missing-loop-grant',
                loop,
                endReport: window.endReport,
                report: o.sequence,
                character,
                grant,
              });
          }
        }
        window = undefined;
      }
      last = o;
    }
    if (window && window.loop === o.loop) {
      if (o.type === 'failure' || o.type === 'victory') window = undefined;
      else if (o.type === 'card-grant') {
        if (typeof d.owner !== 'string' || typeof d.kind !== 'string') window = undefined;
        else window.seen.add(d.owner + '/' + d.kind);
      }
    }
    if (o.loop !== loop || o.type !== 'character' || typeof d.character !== 'string') continue;
    pieces.delete(d.character);
    if (d.status === 'dead') pieces.set(d.character, 'despair+1');
    if (d.status !== 'alive') continue;
    const n = d.counters as { goodwill?: number; hope?: number } | undefined;
    const g = n?.goodwill,
      h = n?.hope;
    if (
      typeof g === 'number' &&
      typeof h === 'number' &&
      Number.isSafeInteger(g) &&
      Number.isSafeInteger(h) &&
      g >= 0 &&
      h >= 0 &&
      g + h >= 2
    )
      pieces.set(d.character, 'hope+1');
  }
  return facts;
}

export function allowsLoopGrants(
  facts: readonly LoopGrantFact[],
  roster: readonly CharacterSetup[],
  fragment?: string,
) {
  if (!facts.length || roster.some((c) => c.character === '手下')) return true;
  return !facts.some((f) =>
    roster.some(
      (c) =>
        c.id === f.character &&
        (c.id === fragment || c.identity === '因果残片') &&
        c.character !== '临时工' &&
        !c.enterDay &&
        (c.enterLoop ?? 1) <= f.loop,
    ),
  );
}
