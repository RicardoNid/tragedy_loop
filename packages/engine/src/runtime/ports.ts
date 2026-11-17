import { awaitingFirstPlacement } from '../../../contracts/src/game.js';
import { createHash } from 'node:crypto';
import type {
  Actor,
  Command,
  MastermindPort,
  MastermindView,
  Observer,
  PlayerResult,
  PlayerView,
  Protagonist,
  ProtagonistPort,
} from '../../../contracts/src/game.js';
import { canonical, clone, type EngineState, type RulePack } from './model.js';
import { advance, cardCount, initialize, legalCardTargets, resume } from './engine.js';
import type { GameSetup } from '../../../contracts/src/game.js';
import { commandSchema } from '../../../contracts/src/validation.js';

export function project(state: EngineState, observer: Observer): PlayerView | MastermindView {
  return projectView(state, observer, observer !== 'mastermind' && awaitingFirstPlacement(state));
}

/** Initial pieces used by the solver to reconstruct play once placement is public. */
export function initialPlacementView(state: EngineState): PlayerView {
  return projectView(state, 'protagonists', false);
}

function projectView(state: EngineState, observer: Observer, hidePieces: boolean): PlayerView | MastermindView {
  const mastermind = observer === 'mastermind';
  const beforeArrival = state.phase === 'briefing' && !mastermind;
  const history = state.observations[mastermind ? 'mastermind' : 'protagonists'];
  const ownChoices = state.choices.filter(
    (c) =>
      c.choice.kind !== 'start' && (mastermind ? c.actor === observer : c.actor !== 'mastermind'),
  ).length;
  const view: PlayerView = {
    revision: history.length + ownChoices,
    module: state.setup.module,
    anniversary: state.setup.anniversary,
    loops: state.setup.loops,
    days: state.setup.days,
    loop: state.loop,
    day: state.day,
    phase: state.phase,
    captain: state.captain,
    ...(state.setup.publicSpecialRules && {
      publicSpecialRules: [...state.setup.publicSpecialRules],
    }),
    discussionAllowed:
      state.setup.discussion === 'allowed' ||
      state.phase === 'discussion' ||
      state.phase === 'final-guess',
    characters: Object.values(state.characters)
      .filter(
        (c) =>
          !hidePieces && (mastermind || c.status !== 'absent' || state.appeared.includes(c.id)),
      )
      .map((c) => ({
        id: c.id,
        character: c.character,
        area: c.area,
        status: c.status,
        counters: clone(c.counters),
      })),
    boards: clone(state.boards),
    territory: hidePieces ? undefined : state.publicTerritory,
    ex: ['MC', 'WM', 'AHR'].includes(state.setup.module) ? state.ex : undefined,
    curses: state.curses ? clone(state.curses) : undefined,
    markers: state.ll
      ? { communicated: [...state.ll.communicated], died: [...state.ll.died] }
      : undefined,
    incidents: state.setup.incidents.map((i) => ({ day: i.day, name: i.publicName ?? i.name })),
    placements: state.placements.map((p) => {
      const c = state.cards.find((c) => c.id === p.card)!;
      const known =
        state.phase === 'card-resolution' ||
        (mastermind ? c.owner === 'mastermind' : c.owner !== 'mastermind');
      return { owner: c.owner, target: p.target, ...(known ? { card: c.id, kind: c.kind } : {}) };
    }),
    hands: Object.fromEntries(
      (beforeArrival ? [] : mastermind ? ['mastermind'] : ['p0', 'p1', 'p2']).map((actor) => [
        actor,
        state.cards
          .filter((c) => c.owner === actor)
          .map(({ id, kind, status }) => ({ id, kind, status })),
      ]),
    ),
    observations: clone(history),
    winner: state.winner,
    winners: state.winners ? [...state.winners] : undefined,
  };
  if (
    state.pending &&
    (state.pending.actor === observer ||
      (observer === 'protagonists' && state.pending.actor !== 'mastermind'))
  ) {
    const pending = clone(state.pending);
    if (pending.kind === 'guess')
      pending.answerKind = state.flags['c-guess'] ? 'culprits' : 'identities';
    if (pending.kind === 'cards')
      pending.cardPlacement = {
        count: cardCount(state, pending.actor),
        cards: state.cards
          .filter((c) => c.owner === pending.actor && c.status === 'hand')
          .map((c) => c.id),
        targets: legalCardTargets(state, pending.actor),
      };
    pending.id = createHash('sha256')
      .update(
        canonical({
          observer,
          revision: view.revision,
          phase: state.phase,
          kind: pending.kind,
          options: pending.options,
        }),
      )
      .digest('hex')
      .slice(0, 24);
    view.decision = pending;
  }
  if (
    state.ll &&
    state.phase !== 'briefing' &&
    observer !== 'mastermind' &&
    observer !== 'protagonists' &&
    (state.loop > 1 || state.phase !== 'discussion')
  )
    view.personalRole = state.ll.roles[observer];
  if (mastermind)
    return {
      ...view,
      secret: {
        y: state.setup.y,
        x: clone(state.setup.x),
        characters: clone(state.setup.characters),
        incidents: clone(state.setup.incidents),
        alternateY: state.setup.alternateY,
        anniversaryFragment: state.setup.anniversaryFragment,
        secretAddition: state.setup.secretAddition,
      },
    };
  return view;
}
/** Server-side owner. Only the returned actor-bound ports should cross a service boundary. */
export function createSession(pack: RulePack, setup: GameSetup, budget = 10000) {
  const created = initialize(pack, setup, budget);
  if (!created.state) return { status: 'invalid' as const, diagnostics: created.diagnostics };
  let state = created.state;
  let opening = project(state, 'protagonists');
  const receipts = new Map<string, { payload: string; actor: Actor }>();
  function submit<V extends PlayerView>(actor: Actor, command: Command): PlayerResult<V> {
    if (!commandSchema.safeParse(command).success)
      return { status: 'rejected', reason: 'invalid-command' };
    const view = project(state, actor) as V;
    const payload = canonical(command);
    const receiptKey = `${actor}:${command.id}`;
    const prior = receipts.get(receiptKey);
    if (prior)
      return prior.payload === payload
        ? { status: 'ok', view }
        : { status: 'rejected', reason: 'invalid-command' };
    if (command.expectedRevision !== view.revision)
      return { status: 'rejected', reason: 'stale-revision' };
    if (!view.decision) return { status: 'rejected', reason: 'not-your-decision' };
    if (command.decisionId !== view.decision.id)
      return { status: 'rejected', reason: 'invalid-command' };
    try {
      const result = advance(
        pack,
        state,
        actor,
        {
          ...command,
          id: receiptKey,
          expectedRevision: state.revision,
          decisionId: state.pending!.id,
        },
        budget,
      );
      if (result.status === 'rejected') return { status: 'rejected', reason: 'invalid-command' };
      state = result.state;
      if (command.choice.kind === 'start') opening = initialPlacementView(state);
      receipts.set(receiptKey, { payload, actor });
      return { status: result.status, view: project(state, actor) as V };
    } catch {
      return { status: 'rejected', reason: 'invalid-command' };
    }
  }
  const mastermind: MastermindPort = {
    view: () => project(state, 'mastermind') as MastermindView,
    submit: (c) => submit<MastermindView>('mastermind', c),
  };
  const protagonists = Object.fromEntries(
    (['p0', 'p1', 'p2'] as Protagonist[]).map((actor) => [
      actor,
      { view: () => project(state, actor), submit: (c: Command) => submit<PlayerView>(actor, c) },
    ]),
  ) as Record<Protagonist, ProtagonistPort>;
  return {
    status: 'ready' as const,
    mastermind,
    protagonists,
    /** Trusted host-only methods, not included in either player port. */
    host: {
      publicOpening: () => awaitingFirstPlacement(state) ? project(state, 'protagonists') : clone(opening),
      snapshot: () => clone(state),
      resume: (limit: number) => {
        const r = resume(pack, state, limit);
        state = r.state;
        return r.status;
      },
      legalCardTargets: (actor: Actor) => legalCardTargets(state, actor),
    },
  };
}
