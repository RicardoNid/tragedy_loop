import type { Choice, Observation } from '../../../contracts/src/game.js';
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
export function observedMenu(s: EngineState, since: number) {
  const menu = s.pending!;
  return {
    loop: s.loop,
    day: s.day,
    phase: s.phase,
    captain: s.captain,
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
    territory: s.publicTerritory,
    boards: s.boards,
    ex: s.ex,
    ownCards: s.cards
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
    characters: Object.values(s.characters)
      .filter((c) => c.status !== 'absent')
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

export function publicQuestion(s: EngineState) {
  return canonical([
    s.setup.days,
    s.setup.loops,
    s.setup.discussion,
    s.setup.incidents
      .map((i) => ({ day: i.day, name: i.publicName ?? i.name }))
      .sort((a, b) => a.day - b.day),
    observedMenu(s, 0),
  ]);
}
