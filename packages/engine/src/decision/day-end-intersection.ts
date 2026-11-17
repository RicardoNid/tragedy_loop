import type { Observation } from '../../../contracts/src/game.js';
import type { DayEndPruning } from '../../../contracts/src/decision.js';
import { buildAbsenceSpace, type AbsenceSpace, type AbsenceWindow } from '../absence/index.js';
import { observeDayEnd } from '../absence/day-end-history.js';
import { absenceProgramIndex } from '../absence/programs.js';
import { canonical, type EngineState, type RulePack } from '../runtime/model.js';
import { visibleCharacters } from './position.js';

/** An optional intersection between two independent engines. The absence rule
 * only runs at a real queued mandatory batch. Hidden state identifies which
 * conditional rule applies to this candidate, never which world actually occurred. */
export class DayEndIntersection {
  private readonly last = new Map<number, number>();
  private readonly cache = new Map<string, AbsenceSpace>();
  private readonly sources: Set<string>;
  readonly stats: DayEndPruning = { checked: 0, compiled: 0, excluded: 0, windows: [] };
  constructor(
    private readonly pack: RulePack,
    private readonly reports: readonly Observation[],
  ) {
    // These profiles have public effects before their mandatory group. Preserve
    // the standalone checker's phase-window boundary for them.
    if (!['AHR', 'HSA'].includes(pack.module)) {
      let end: number | undefined;
      for (let i = reports.length - 1; i >= 0; i--) {
        const o = reports[i]!;
        if (o.type !== 'boundary') continue;
        if (o.phase === 'day-end' && end !== undefined) this.last.set(i, end);
        end = i;
      }
    }
    this.sources = new Set(
      (this.last.size ? (absenceProgramIndex(pack).byTiming.get('day-end') ?? []) : [])
        .filter(
          (p) =>
            p.activation === 'mandatory' &&
            (p.kind === 'identity' || p.kind === 'character') &&
            (p.effects.includes('kill') || p.effects.includes('reveal-identity')),
        )
        .map((p) => canonical([p.source, p.id])),
    );
  }
  excludes(s: EngineState, cursor: number): boolean {
    const start = cursor - 1,
      end = this.last.get(start);
    if (
      end === undefined ||
      !s.phaseEntered ||
      s.phase !== 'day-end' ||
      s.batch ||
      s.pending ||
      s.endRequested ||
      s.latchedWinner ||
      s.winner ||
      s.failed ||
      !s.frames.length ||
      s.setup.publicSpecialRules?.length
    )
      return false;
    const first = this.reports[start]!;
    if (
      first.loop !== s.loop ||
      first.day !== s.day ||
      s.observations.protagonists.length !== cursor ||
      canonical(s.observations.protagonists.at(-1)) !== canonical(first)
    )
      return false;
    const group = s.frames[0]!.bound.batchGroup;
    if (
      !group ||
      s.frames.some(
        (f) =>
          f.kind !== 'mandatory' ||
          f.ability?.timing !== 'day-end' ||
          f.step !== 0 ||
          f.bound.batchGroup !== group ||
          Object.keys(f.choices).length,
      )
    )
      return false;
    const active = s.frames.filter((f) => this.sources.has(canonical([f.source, f.ability!.id])));
    if (!active.length) return false;
    const entry: AbsenceWindow['entry'] = {
      module: s.setup.module,
      anniversary: s.setup.anniversary,
      days: s.setup.days,
      loops: s.setup.loops,
      loop: s.loop,
      day: s.day,
      phase: s.phase,
      characters: visibleCharacters(s),
      boards: s.boards,
      ex: s.ex,
    };
    const limited = active
      .filter((f) => f.ability!.loopLimit !== undefined)
      .map((f) => ({ owner: f.owner, ability: f.ability!.id }));
    const key = canonical([start, entry, limited]);
    let space = this.cache.get(key);
    if (!space) {
      const window = observeDayEnd(entry, this.reports.slice(start, end + 1));
      if (window.coverage !== 'complete') return false;
      space = buildAbsenceSpace(this.pack, { ...window, availableLimitedAbilities: limited });
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, space);
      this.stats.compiled++;
    }
    this.stats.checked++;
    const queued = (owner: string | undefined, source: string, ability: string) =>
      active.some((f) => f.owner === owner && f.source === source && f.ability!.id === ability);
    const pair = space.constraints.find(
      (c) =>
        queued(c.owner, c.source, c.ability) &&
        s.characters[c.owner]?.identity === c.identity &&
        c.targetIdentities.includes(s.characters[c.target]!.identity),
    );
    const choice = !pair
      ? space.choiceConflicts?.find(
          (c) =>
            queued(c.owner, c.source, c.ability) &&
            Object.entries(c.terms).every(([id, roles]) =>
              roles.includes(s.characters[id]!.identity),
            ),
        )
      : undefined;
    if (!pair && !choice) return false;
    this.stats.excluded++;
    const old = this.stats.windows.find((w) => w.firstReport === first.sequence);
    if (old) old.branches++;
    else {
      const example = pair
        ? {
            ability: pair.ability,
            owner: pair.owner,
            roles: {
              [pair.owner]: pair.identity,
              [pair.target]: s.characters[pair.target]!.identity,
            },
          }
        : {
            ability: choice!.ability,
            owner: choice!.owner!,
            roles: Object.fromEntries(
              Object.keys(choice!.terms).map((id) => [id, s.characters[id]!.identity]),
            ),
          };
      this.stats.windows.push({
        firstReport: first.sequence,
        lastReport: this.reports[end]!.sequence,
        loop: first.loop,
        day: first.day,
        branches: 1,
        example,
      });
    }
    return true;
  }
}
