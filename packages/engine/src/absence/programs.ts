import type { Ability, RulePack, Step, RuleProgram } from '../runtime/model.js';

import type { ProgramKind } from '../runtime/model.js';
export type { ProgramKind } from '../runtime/model.js';
export type AbsenceProgram = RuleProgram;

const compiled = new WeakMap<RulePack, ReturnType<typeof compile>>();
function compile(pack: RulePack) {
  const programs: AbsenceProgram[] = [];
  const byTiming = new Map<Ability['timing'], AbsenceProgram[]>();
  const byOwner = new Map<string, AbsenceProgram[]>();
  const unsupported: { kind: ProgramKind; owner: string; source: string }[] = [];
  function add(kind: ProgramKind, owner: string, ability: Ability) {
    const ops = new Set<string>();
    function visit(e: Step['effects'][number]) {
      ops.add(e.op);
      if ('effects' in e) for (const child of e.effects) visit(child);
    }
    for (const step of ability.steps) step.effects.forEach(visit);
    const p: AbsenceProgram = {
      kind,
      owner,
      id: ability.id,
      source: ability.source,
      timing: ability.timing,
      ability,
      activation: kind === 'incident' ? 'incident' : ability.mandatory ? 'mandatory' : 'optional',
      effects: [...ops].sort(),
    };
    programs.push(p);
    const key = JSON.stringify([ability.timing, kind, owner]);
    if (!byTiming.has(ability.timing)) byTiming.set(ability.timing, []);
    byTiming.get(ability.timing)!.push(p);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(p);
  }
  for (const [kind, defs] of [
    ['identity', pack.identities],
    ['character', pack.characters],
    ['plot', pack.plots],
  ] as const)
    for (const d of Object.values(defs)) {
      if (!d.supported) unsupported.push({ kind, owner: d.name, source: d.source });
      for (const a of d.abilities) add(kind, d.name, a);
    }
  for (const { owner, ability } of pack.moduleAbilities) add('module', owner, ability);
  for (const d of Object.values(pack.incidents)) {
    if (!d.supported) unsupported.push({ kind: 'incident', owner: d.name, source: d.source });
    add('incident', d.name, {
      id: 'incident',
      source: d.source,
      timing: 'incident',
      steps: d.steps,
    });
    if (d.afterIncidentSteps?.length)
      add('incident', d.name, {
        id: 'after-incident',
        source: d.source,
        timing: 'incident-completed',
        steps: d.afterIncidentSteps,
      });
  }
  return { programs, byTiming, byOwner, unsupported };
}
export function absenceProgramIndex(pack: RulePack) {
  let result = compiled.get(pack);
  if (!result) {
    result = compile(pack);
    compiled.set(pack, result);
  }
  return result;
}
