import type {
  Area,
  Board,
  CharacterSetup,
  Counters,
  Observation,
  PublicCharacter,
  ScheduledIncident,
} from '../../../contracts/src/game.js';
import { BOARDS, COUNTERS, type IncidentDefinition, type RulePack } from '../runtime/model.js';
import { incidentPressure, incidentThreshold } from '../runtime/incident-threshold.js';
import type { IncidentConflict } from '../../../contracts/src/decision.js';
import { absenceProgramIndex } from '../absence/programs.js';
import type { Effect } from '../runtime/model.js';

type Piece = Pick<PublicCharacter, 'area' | 'status' | 'counters'>;
export type IncidentFact = {
  kind: 'incident-outcome';
  day: number;
  loop: number;
  report: number;
  occurred: boolean;
};
interface AtIncident {
  fact: IncidentFact;
  pieces: Map<string, Piece>;
  boards: Map<Board, number>;
}

/** Keep only full public character updates from this loop. A later update
 * supersedes the earlier one; an unreported piece may occupy any legal state. */
export function incidentEvidence(
  reports: readonly Observation[],
  schedule: readonly { day: number; name: string }[],
) {
  const windows: AtIncident[] = [];
  let loop = 0,
    incidentDay = 0;
  const pieces = new Map<string, Piece>(),
    boards = new Map<Board, number>();
  if (!reports.some((o) => o.type === 'incident' && typeof o.data?.occurred === 'boolean'))
    return windows;
  for (const [i, o] of reports.entries()) {
    if (o.sequence !== i + 1 || !o.data) return [];
    if (o.type === 'boundary') {
      incidentDay = o.phase === 'incident' && o.data.phase === 'incident' ? o.day : 0;
      if (o.phase === 'loop-start' && o.data.phase === 'loop-start') {
        loop = o.loop;
        pieces.clear();
        boards.clear();
        for (const b of BOARDS) boards.set(b, 0);
      }
    }
    if (!loop || loop !== o.loop) continue;
    const d = o.data;
    if (o.type === 'character' && typeof d.character === 'string') {
      const n = d.counters as Counters | undefined;
      if (
        ['alive', 'absent', 'dead', 'removed'].includes(String(d.status)) &&
        [...BOARDS, 'far'].includes(String(d.area)) &&
        n &&
        COUNTERS.every((k) => Number.isSafeInteger(n[k]) && n[k] >= 0)
      )
        pieces.set(d.character, {
          status: d.status as Piece['status'],
          area: d.area as Area,
          counters: n,
        });
      else pieces.delete(d.character);
    }
    if (o.type === 'board' && BOARDS.includes(d.board as Board)) {
      if (typeof d.intrigue === 'number' && Number.isSafeInteger(d.intrigue) && d.intrigue >= 0)
        boards.set(d.board as Board, d.intrigue);
      else boards.delete(d.board as Board);
    }
    if (
      o.type === 'incident' &&
      o.phase === 'incident' &&
      o.day === incidentDay &&
      d.day === o.day &&
      typeof d.occurred === 'boolean' &&
      schedule.some((entry) => entry.day === o.day && entry.name === d.name)
    ) {
      windows.push({
        fact: {
          kind: 'incident-outcome',
          day: o.day,
          loop: o.loop,
          report: o.sequence,
          occurred: d.occurred,
        },
        pieces: new Map(pieces),
        boards: new Map(boards),
      });
      incidentDay = 0;
    }
  }
  return windows;
}

const profiles = new WeakMap<
  RulePack,
  { blocked: Set<string>; anyBlock: boolean; areaTrigger: boolean }
>();
function incidentProfile(pack: RulePack) {
  let profile = profiles.get(pack);
  if (profile) return profile;
  const blocked = new Set<string>();
  let anyBlock = false;
  for (const p of absenceProgramIndex(pack).programs) {
    if (!p.effects.includes('flag')) continue;
    function visit(effect: Effect) {
      if (effect.op === 'flag' && effect.key === 'no-incidents') {
        if (p.kind === 'character' && effect.target === '$self') blocked.add(p.owner);
        else anyBlock = true;
      }
      if ('effects' in effect) effect.effects.forEach(visit);
    }
    for (const step of p.ability.steps) step.effects.forEach(visit);
  }
  profile = {
    blocked,
    anyBlock,
    areaTrigger: Object.values(pack.identities).some((id) => id.sameAreaIncidentTrigger),
  };
  profiles.set(pack, profile);
  return profile;
}

/** Lower and upper bounds span all active identities, exceptional thresholds
 * and both AHR worlds. An unknown falls through to correlated forward replay. */
function ordinary(
  pack: RulePack,
  piece: Piece | undefined,
  character: string,
  limit: number,
  def: IncidentDefinition,
): boolean | undefined {
  if (!piece) return;
  if (piece.status !== 'alive') return false;
  const threshold = incidentThreshold(limit, character, def);
  const counters = piece.counters;
  const base = incidentPressure(counters, character, def, false, false);
  const added =
    pack.identities['祭品'] ||
    (pack.plots['士的宁毒液'] && ['连续杀人', '自杀'].includes(def.name));
  const alternate =
    pack.module === 'AHR' ? incidentPressure(counters, character, def, true, false) : base;
  const low = Math.min(base, alternate);
  const high = Math.max(
    alternate,
    added ? incidentPressure(counters, character, def, false, true) : base,
  );
  const dimensional = def.name === '次元转换';
  const profile = incidentProfile(pack);
  if (
    !pack.identities['预言家'] &&
    !profile.anyBlock &&
    !profile.blocked.has(character) &&
    (dimensional || low >= threshold)
  )
    return true;
  const specialTrigger =
    dimensional ||
    pack.identities['强迫症'] ||
    (pack.identities['监视者'] && counters.despair > 0) ||
    profile.areaTrigger;
  if (!specialTrigger && high < threshold - Number(!!pack.plots['灭亡讴歌'])) return false;
}

function verdict(
  pack: RulePack,
  w: AtIncident,
  roster: readonly CharacterSetup[],
  incident: ScheduledIncident,
) {
  const def = pack.incidents[incident.name];
  if (!def?.supported) return;
  if (def.crowdThreshold !== undefined) {
    const area = incident.culprit as Board;
    if (!BOARDS.includes(area)) return;
    // In HSA each board intrigue is itself a victim in the dead selector.
    const victims = pack.module === 'HSA' ? w.boards.get(area) : 0;
    let low = victims ?? 0,
      high = victims ?? Infinity;
    const count = (id: string) => {
      const p = w.pieces.get(id);
      if (!p) high++;
      else if (p.status === 'dead' && p.area === area) {
        low++;
        high++;
      }
    };
    for (const c of roster) {
      count(c.id);
      if (c.character === '临时工') count(c.id + '_replacement');
    }
    if (low >= def.crowdThreshold) return true;
    if (high < def.crowdThreshold) return false;
    return;
  }
  const c = roster.find((c) => c.id === incident.culprit);
  const character = c && pack.characters[c.character];
  if (!c || !character) return;
  const primary = ordinary(pack, w.pieces.get(c.id), c.character, c.x ?? character.paranoia, def);
  if (c.character !== '临时工' || primary === true) return primary;
  const replacement = ordinary(pack, w.pieces.get(c.id + '_replacement'), '临时工？', 3, def);
  if (replacement === true) return true;
  if (primary === false && replacement === false) return false;
}

export class IncidentEvidence {
  private readonly byDay = new Map<number, AtIncident[]>();
  private readonly memo = new Map<string, boolean>();
  private memoPack?: RulePack;
  readonly examples: IncidentConflict[] = [];
  constructor(windows: AtIncident[]) {
    for (const w of windows) {
      const day = w.fact.day;
      const group = this.byDay.get(day) ?? [];
      group.push(w);
      this.byDay.set(day, group);
    }
  }
  allows(pack: RulePack, roster: readonly CharacterSetup[], incident: ScheduledIncident) {
    const group = this.byDay.get(incident.day);
    if (!group) return true;
    if (this.memoPack !== pack) {
      this.memo.clear();
      this.memoPack = pack;
    }
    // Verdicts do not use the roster's hidden role assignments. Share the
    // calculation across permutations, retaining the physical replacement slot.
    const actor = roster.find((c) => c.id === incident.culprit);
    const config =
      pack.incidents[incident.name]?.crowdThreshold === undefined
        ? [actor?.character, actor?.x]
        : roster.map((c) => [c.id, c.character === '临时工']);
    const key = JSON.stringify([incident.day, incident.name, incident.culprit, config]);
    const previous = this.memo.get(key);
    if (previous !== undefined) return previous;
    const allowed = group.every((w) => {
      const predicted = verdict(pack, w, roster, incident);
      if (predicted === undefined || predicted === w.fact.occurred) return true;
      if (
        this.examples.length < 6 &&
        !this.examples.some((e) => e.report === w.fact.report && e.culprit === incident.culprit)
      )
        this.examples.push({
          report: w.fact.report,
          loop: w.fact.loop,
          day: w.fact.day,
          culprit: incident.culprit,
          predicted,
        });
      return false;
    });
    if (this.memo.size >= 512) this.memo.delete(this.memo.keys().next().value!);
    this.memo.set(key, allowed);
    return allowed;
  }
}
