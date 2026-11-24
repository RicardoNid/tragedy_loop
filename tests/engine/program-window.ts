import type { Module } from '../../packages/contracts/src/game.js';
import type { AbsenceProgram } from '../../packages/engine/src/absence/programs.js';
import { clone } from '../../packages/engine/src/runtime/model.js';
import { character, lab } from '../comprehensive/harness.js';

/** Isolate an already admitted rule body from its trigger and the next phase. */
export function programWindow(module: Module, anniversary: boolean, p: AbsenceProgram) {
  const l = lab(module, anniversary);
  const s = l.state;
  s.pending = null;
  s.phase = 'day-end';
  s.loop = s.day = 1;
  s.phaseEntered = true;
  const owner =
    p.kind === 'identity' || p.kind === 'character' || p.kind === 'incident'
      ? 'a'
      : p.kind === 'plot'
        ? 'plot:' + p.owner
        : p.owner;
  if (p.kind === 'identity') character(l, 'a', '男学生', p.owner, 'school');
  if (p.kind === 'character') character(l, 'a', p.owner, '平民', 'school');
  if (p.timing === 'death') s.characters.a!.status = 'dead';
  s.frames = [
    {
      id: 'probe',
      owner,
      actor: 'mastermind',
      kind:
        p.activation === 'incident'
          ? 'incident'
          : p.activation === 'mandatory'
            ? 'mandatory'
            : 'ability',
      source: p.source,
      steps: clone(p.ability.steps),
      step: 0,
      choices: {},
      bound: {},
      cleanup: true,
      ability: p.activation === 'incident' ? undefined : p.ability,
      incident: p.activation === 'incident' ? p.owner : undefined,
    },
  ];
  return s;
}
