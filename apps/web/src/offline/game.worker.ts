import {
  openGame,
  inspectMastermind,
  gameTurn,
  fixtureStep,
  engineTrace,
  reviewSetup,
  btxReviewSetup,
  type Session,
} from '../../../server/src/review-game';
import { compileOfficial } from '../../../../packages/content/src/official/compile';
import { LiveKnowledge, waitingForCharacters } from '../../../../packages/engine/src/runtime/knowledge-live';
import { observedRoster } from '../../../../packages/engine/src/runtime/knowledge-domain';
import type { Actor, PlayerView } from '../../../../packages/contracts/src/game';
import type { Call, Request, Reply } from './messages';

let active: { id: string; game: Session } | undefined;
let solver: LiveKnowledge | undefined;
let rosterKey = '';
let revision = -1;
let timer: ReturnType<typeof setTimeout> | undefined;
let searchError: unknown;
function search() {
  timer = undefined;
  try {
    if (!solver || solver.paused) return;
    solver.tick(15);
    if (!solver.paused) timer = setTimeout(search, 15);
  } catch (error) {
    searchError = error;
  }
}
function knowledge(opening: PlayerView, view: PlayerView, verify: boolean) {
  const roster = observedRoster(opening, view);
  const key = JSON.stringify(roster);
  if (!solver || key !== rosterKey) {
    clearTimeout(timer);
    timer = undefined;
    solver = new LiveKnowledge(compileOfficial(opening.module, opening.anniversary), {
      ...opening,
      roster,
    });
    rosterKey = key;
    revision = -1;
    searchError = undefined;
  }
  if (searchError) throw searchError;
  if (revision !== view.revision) {
    const after = solver.observationCount;
    solver.append(view.observations.slice(after), after, view.revision);
    revision = view.revision;
  }
  if (verify) solver.verifyCombinations();
  if (timer === undefined && !solver.paused) timer = setTimeout(search, 0);
  return solver.snapshot();
}
function dispatch(call: Call) {
  if (call.method === 'create') {
    const [custom, profile] = call.args;
    const game = openGame(custom ?? (profile === 'BTX' ? btxReviewSetup : reviewSetup));
    if (game.status !== 'ready') throw new Error('剧本未通过规则校验。');
    const opening = game.protagonists.p0.view();
    active = { id: crypto.randomUUID(), game };
    clearTimeout(timer);
    timer = undefined;
    solver = undefined;
    return { id: active.id, view: opening };
  }
  if (!active || active.id !== call.args[0]) throw new Error('对局不存在，请重新开局。');
  const { game } = active;
  const port = (seat: Actor) => (seat === 'mastermind' ? game.mastermind : game.protagonists[seat]);
  switch (call.method) {
    case 'engineTrace':
      return engineTrace(game);
    case 'view':
      return call.args[1] === 'mastermind' ? inspectMastermind(game) : port(call.args[1]).view();
    case 'turn':
      return gameTurn(game);
    case 'fixture':
      return fixtureStep(game, call.args[1], call.args[2]);
    case 'submit': {
      const result = port(call.args[1]).submit(call.args[2]);
      if (result.status === 'rejected') throw new Error('操作未提交：' + result.reason);
      return call.args[1] === 'mastermind' ? inspectMastermind(game) : result.view;
    }
    case 'knowledge':
    case 'verifyKnowledge': {
      const view = game.protagonists.p0.view();
      if (view.phase === 'briefing') return waitingForCharacters(view.revision);
      return knowledge(game.host.publicOpening(), view, call.method === 'verifyKnowledge');
    }
  }
}
self.onmessage = ({ data }: MessageEvent<Request>) => {
  let reply: Reply;
  try {
    reply = { sequence: data.sequence, value: dispatch(data) };
  } catch (error) {
    reply = {
      sequence: data.sequence,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(reply);
};
