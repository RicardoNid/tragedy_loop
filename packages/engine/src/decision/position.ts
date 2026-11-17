import type { Choice, Observation, Protagonist } from '../../../contracts/src/game.js';
import { advance, legalCardTargets } from '../runtime/engine.js';
import { canonical, type EngineState, type RulePack } from '../runtime/model.js';

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Curse markers of the same type are interchangeable. Their internal serials
 * can advance during a private action and carry no game information. */
export function visibleReport(o: Observation): Observation {
  if (o.type !== 'board' || !Array.isArray(o.data.curses)) return o;
  return {
    ...o,
    data: {
      ...o.data,
      curses: o.data.curses
        .map((c) => ({ target: c.target as string }))
        .sort((a, b) => byText(a.target, b.target)),
    },
  };
}

export function rulesSupported(pack: RulePack, s: EngineState) {
  const roles = Object.values(s.characters).flatMap((c) => [c.identity, c.initialIdentity]);
  for (const c of s.setup.characters) if (c.reverseIdentity) roles.push(c.reverseIdentity);
  return (
    !s.setup.publicSpecialRules?.length &&
    !s.diagnostic &&
    roles.every((r) => pack.identities[r]?.supported) &&
    Object.values(s.characters).every((c) => pack.characters[c.character]?.supported) &&
    [s.setup.y, ...s.setup.x, s.setup.alternateY].every((p) => !p || pack.plots[p]?.supported) &&
    s.setup.incidents.every((i) => pack.incidents[i.name]?.supported)
  );
}

export interface PolicyCandidates {
  exhaustive: boolean;
  states: readonly EngineState[];
}
/** Information used by the joint protagonist observer. Opaque runtime IDs
 * and characters that have not appeared do not identify a public position. */
export function observedMenu(s: EngineState, since: number, seat?: Protagonist) {
  const menu = s.pending!;
  const briefing = s.phase === 'briefing';
  return {
    loop: s.loop,
    day: s.day,
    phase: s.phase,
    captain: s.captain,
    ...(s.ll && {
      markers: { communicated: [...s.ll.communicated].sort(), died: [...s.ll.died].sort() },
    }),
    ...(seat &&
      s.ll &&
      (s.loop > 1 ||
        s.observations.public.some((o) => o.type === 'boundary' && o.phase === 'loop-start')) && {
        personalRole: s.ll.roles[seat],
      }),
    reports: s.observations.protagonists.slice(since).map(visibleReport),
    menu: {
      actor: menu.actor,
      kind: menu.kind,
      areas: menu.areas,
      options: [...menu.options].sort((a, b) => byText(canonical(a), canonical(b))),
    },
    ...(menu.kind === 'cards' && {
      targets: legalCardTargets(s, menu.actor).sort(),
    }),
    ...(menu.kind === 'guess' && { answerKind: s.flags['c-guess'] ? 'culprits' : 'identities' }),
    territory: briefing ? undefined : s.publicTerritory,
    boards: s.boards,
    ex: s.ex,
    ownCards: (briefing ? [] : s.cards)
      .filter((c) => c.owner !== 'mastermind')
      .map((c) => ({ id: c.id, owner: c.owner, kind: c.kind, status: c.status }))
      .sort((a, b) => byText(a.id, b.id)),
    placements: s.placements
      .map((p) => {
        const card = s.cards.find((c) => c.id === p.card)!;
        return {
          owner: card.owner,
          target: p.target,
          ...(card.owner !== 'mastermind' && { card: card.id }),
        };
      })
      .sort((a, b) => byText(canonical(a), canonical(b))),
    ...(s.curses?.length && { curses: s.curses.map((c) => c.target).sort() }),
    characters: (briefing ? [] : Object.values(s.characters))
      .filter((c) => c.status !== 'absent' || s.appeared.includes(c.id))
      .map((c) => ({
        id: c.id,
        character: c.character,
        area: c.area,
        status: c.status,
        counters: c.counters,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export function submitChoice(pack: RulePack, s: EngineState, choice: Choice) {
  const d = s.pending!;
  let id = 'policy-' + s.revision;
  while (Object.hasOwn(s.receipts, id)) id += '-';
  return advance(
    pack,
    s,
    d.actor,
    { id, decisionId: d.id, expectedRevision: s.revision, choice },
    0,
  );
}

export function publicSheet(setup: EngineState['setup']) {
  return {
    module: setup.module,
    anniversary: setup.anniversary,
    days: setup.days,
    loops: setup.loops,
    discussion: setup.discussion,
    specialRules: setup.publicSpecialRules ?? [],
    incidents: setup.incidents
      .map((i) => ({ day: i.day, name: i.publicName ?? i.name }))
      .sort((a, b) => a.day - b.day),
  };
}

export function observeQuestion(s: EngineState, seat?: Protagonist) {
  if (
    !s.pending ||
    s.pending.actor === 'mastermind' ||
    (seat && s.pending.actor !== seat) ||
    s.winner
  )
    throw Error('Expected a protagonist decision');
  return {
    version: 1 as const,
    coverage: 'complete' as const,
    ...(seat && { seat }),
    sheet: publicSheet(s.setup),
    view: observedMenu(s, 0, seat),
  };
}
export function publicQuestion(s: EngineState, seat?: Protagonist) {
  return canonical(observeQuestion(s, seat));
}
