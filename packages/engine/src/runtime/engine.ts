import type {
  Actor,
  Area,
  Board,
  Choice,
  Command,
  Decision,
  GameSetup,
  Phase,
  Protagonist,
} from '../../../contracts/src/game.js';
import {
  BOARDS,
  COUNTERS,
  canonical,
  clone,
  zeroCounters,
  type Ability,
  type CharacterState,
  type Diagnostic,
  type EngineState,
  type Environment,
  type Frame,
  type IncidentAreaMode,
  type RulePack,
  type Step,
} from './model.js';
import {
  checkSpecialVictory,
  destination,
  effective,
  identities,
  ref,
  refusal,
  select,
  test,
  traitors,
} from './expressions.js';
import {
  announce,
  grantCard,
  permitsMove,
  publishChanges,
  settle,
  type Intent,
} from './settlement.js';
import { acceptedIdentities } from './final-answers.js';
import { initialState, validateSetup } from './setup.js';
import { commandSchema } from '../../../contracts/src/validation.js';

const seats: Protagonist[] = ['p0', 'p1', 'p2'];
const nextPhase: Partial<Record<Phase, Phase>> = {
  'loop-start': 'day-start',
  'day-start': 'mastermind-cards',
  'mastermind-cards': 'protagonist-cards',
  'protagonist-cards': 'card-resolution',
  'card-resolution': 'mastermind-abilities',
  'mastermind-abilities': 'protagonist-abilities',
  'protagonist-abilities': 'incident',
  incident: 'captain-change',
  'captain-change': 'day-end',
};
export interface AdvanceResult {
  status: 'ok' | 'paused' | 'rejected';
  state: EngineState;
  reason?: string;
}
export function initialize(
  pack: RulePack,
  setup: GameSetup,
  budget = 10000,
) {
  return initializePhase(pack, setup, budget, 'briefing');
}
/** Reconstruct the first discussion for post-placement search roots and legacy replay logs. */
export function initializeDiscussion(pack: RulePack, setup: GameSetup, budget = 10000) {
  return initializePhase(pack, setup, budget, 'discussion');
}
function initializePhase(
  pack: RulePack,
  setup: GameSetup,
  budget: number,
  phase: 'discussion' | 'briefing',
): { state?: EngineState; diagnostics: Diagnostic[] } {
  const diagnostics = validateSetup(pack, setup);
  if (diagnostics.length) return { diagnostics };
  const state = initialState(pack, setup);
  state.phase = phase;
  if (phase === 'discussion') beginDiscussion(state);
  drive(pack, state, budget);
  return { state, diagnostics };
}
function beginDiscussion(state: EngineState) {
  enter(state, 'discussion');
  if (state.publicTerritory) announce(state, 'board', { territory: state.publicTerritory });
}
export function environment(state: EngineState, frame: Frame): Environment {
  const configuration = state.setup.characters.find((c) => c.id === frame.owner);
  const env: Environment = {
    ...frame.bound,
    ...frame.choices,
    self: frame.owner,
    actor: frame.actor,
    sourceId: frame.id,
    sourceKind: frame.kind,
    territory: configuration?.territory ?? '',
    x: String(configuration?.x ?? 0),
    // Detective and Divinity bind a chosen incident day. Other programs read
    // the current day, including frames resumed after a delayed effect.
    day: frame.choices.day ?? String(state.day),
    loop: String(state.loop),
  };
  if (frame.ability?.id === 'forensic-transfer') env.forensicTransfer = 'yes';
  for (const [key, id] of Object.entries(env)) {
    const c = state.characters[id];
    if (c) {
      env[`${key}.area`] = c.area;
      env[`${key}.initialArea`] = c.initialArea;
    }
  }
  const owner = state.characters[frame.owner];
  const incidentArea = frame.incidentAreas?.[env.areaMode ?? ''];
  if (incidentArea) env.effectiveArea = incidentArea;
  if (env.areaMode === 'territory')
    env.effectiveArea = configuration?.territory ?? owner?.area ?? '';
  if (env.areaMode === 'streamer')
    env.effectiveArea =
      state.characters[state.flags['streamer-target'] ?? '']?.area ?? owner?.area ?? '';
  if (env.effectiveArea) env['self.area'] = env.effectiveArea;
  return env;
}
function options(
  pack: RulePack,
  state: EngineState,
  frame: Frame,
  spec: NonNullable<Step['choices']>[number],
): string[] {
  const env = environment(state, frame);
  if (
    spec.key === 'areaMode' &&
    Array.isArray(spec.options) &&
    frame.ability?.condition &&
    !(
      frame.ability.mandatory &&
      pack.characters[state.characters[frame.owner]?.character ?? '']?.abilityArea
    )
  )
    return spec.options.filter((areaMode) =>
      test(
        pack,
        state,
        frame.ability!.condition,
        environment(state, { ...frame, choices: { ...frame.choices, areaMode } }),
      ),
    );
  if (
    frame.incident === '亵渎杀人' &&
    spec.key === 'branch' &&
    !Object.values(state.characters).some(
      (c) => c.status === 'alive' && c.id !== frame.owner && c.area === env['self.area'],
    )
  )
    return ['intrigue'];
  if (frame.ability?.id === 'forensic-transfer' && spec.key === 'counter') {
    const from = state.characters[env.from ?? ''],
      to = state.characters[env.to ?? ''];
    const present = COUNTERS.filter(
      (k) => (from?.counters[k] ?? 0) > 0 || (to?.counters[k] ?? 0) > 0,
    );
    // Both targets may be empty; only that case permits a no-effect transfer.
    return present.length ? present : ['goodwill'];
  }
  if (!Array.isArray(spec.options)) return select(pack, state, spec.options, env);
  return [
    ...new Set(
      spec.options.flatMap((o) => {
        if (o === '$incident-days') return state.setup.incidents.map((i) => String(i.day));
        if (o === '$occurred-days')
          return state.incidents.filter((i) => i.loop === state.loop).map((i) => String(i.day));
        if (o === '$public-incidents')
          return state.setup.incidents.map((i) => i.publicName ?? i.name);
        if (o === '$all-x')
          return Object.values(pack.plots)
            .filter((p) => p.type === 'X')
            .map((p) => p.name);
        if (o === '$other-selected-x') return state.setup.x.filter((x) => x !== env.excluded);
        if (o === '$ignore-goodwill-areas')
          return [
            ...new Set(
              Object.values(state.characters)
                .filter((c) => c.status === 'alive' && refusal(pack, state, c.id) !== 'none')
                .map((c) => c.area),
            ),
          ].filter((a) => a !== 'far');
        if (o === '$zombie-corpses')
          return select(
            pack,
            state,
            {
              kind: 'dead',
              where: { cmp: 'eq', left: { field: 'identity', target: '$it' }, right: '丧尸' },
            },
            env,
          );
        if (o === '$target-goodwill') {
          const target = env.target ?? '',
            c = state.characters[target];
          return c
            ? (pack.characters[c.character]?.abilities ?? [])
                .filter(
                  (a) =>
                    a.threshold !== undefined &&
                    available(
                      pack,
                      state,
                      target,
                      { ...a, threshold: 0, cannotRefuse: true },
                      frame.actor,
                    ),
                )
                .map((a) => a.id)
            : [];
        }
        if (o === '$used-captain-cards')
          return state.cards
            .filter(
              (c) =>
                c.owner === (frame.actor === 'mastermind' ? 'mastermind' : state.captain) &&
                c.status === 'used' &&
                c.once,
            )
            .map((c) => c.id);
        if (o === '$corpses-after-self-move') {
          if (!env.area) return [];
          const area = permitsMove(state, frame.owner, env.area as Area)
            ? env.area
            : state.characters[frame.owner]?.area;
          return select(
            pack,
            state,
            {
              kind: 'dead',
              where: {
                cmp: 'eq',
                left: { field: 'area', target: '$it' },
                right: area ?? '',
              },
            },
            env,
          );
        }
        if (
          ['$adjacent-self', '$adjacent-target', '$adjacent-any-self', '$adjacent-corpse'].includes(
            o,
          )
        ) {
          const self = o.endsWith('self');
          const c = state.characters[self ? frame.owner : (env.target ?? '')];
          if (!c && env.target?.startsWith('victim:')) {
            const area = env.target.split(':')[1] as Board;
            return [destination(area, ['horizontal']), destination(area, ['vertical'])];
          }
          const origin = (self ? env.effectiveArea : undefined) as Area | undefined;
          const area = origin ?? c?.area;
          return c && area && area !== 'far'
            ? [destination(area, ['horizontal']), destination(area, ['vertical'])].filter(
                (a) =>
                  o === '$adjacent-any-self' ||
                  o === '$adjacent-corpse' ||
                  c.flags['free-movement'] ||
                  !c.forbidden.includes(a as Board),
              )
            : [];
        }
        return [ref(o, env)];
      }),
    ),
  ];
}
function useKeys(state: EngineState, owner: string, ability: Ability, actor: Actor): string[] {
  const base = ability.sharedKey ?? `${owner}:${ability.id}`;
  return [
    `phase:${state.loop}:${state.day}:${state.phase}:${actor}:${base}`,
    `loop:${state.loop}:${base}`,
  ];
}
function available(
  pack: RulePack,
  state: EngineState,
  owner: string,
  ability: Ability,
  actor: Actor,
  allowEmpty = false,
): boolean {
  const [phaseKey, loopKey] = useKeys(state, owner, ability, actor);
  if (
    (!ability.mandatory && (state.uses[phaseKey!] ?? 0) >= 1) ||
    (ability.loopLimit !== undefined && (state.uses[loopKey!] ?? 0) >= ability.loopLimit)
  )
    return false;
  const frame = makeFrame(state, owner, ability, actor, false, false);
  const areaChoice = frame.steps[0]?.choices?.find((c) => c.key === 'areaMode');
  if (
    areaChoice
      ? !options(pack, state, frame, areaChoice).some((areaMode) =>
          test(
            pack,
            state,
            ability.condition,
            environment(state, { ...frame, choices: { areaMode } }),
          ),
        )
      : !test(pack, state, ability.condition, environment(state, frame))
  )
    return false;
  const counter =
    pack.module === 'AHR' &&
    state.ex % 2 === 1 &&
    !(actor === 'mastermind' && ['doctor-counter', 'higher-being'].includes(ability.id))
      ? 'paranoia'
      : 'goodwill';
  if (ability.threshold !== undefined && effective(state, owner, counter) < ability.threshold)
    return false;
  // Initial legal target is required to declare an optional ability. Later empty steps are skipped.
  return allowEmpty || canBind(pack, state, frame, 0);
}
function canBind(pack: RulePack, state: EngineState, frame: Frame, index: number): boolean {
  const spec = frame.steps[0]?.choices?.[index];
  if (!spec) return true;
  for (const option of options(pack, state, frame, spec)) {
    const candidate = clone(frame);
    candidate.choices[spec.key] = option;
    if (canBind(pack, state, candidate, index + 1)) return true;
  }
  return Boolean(spec.optional || spec.allowEmpty);
}
function makeFrame(
  state: EngineState,
  owner: string,
  ability: Ability,
  actor: Actor,
  cleanup = false,
  allocate = true,
): Frame {
  const steps = clone(ability.steps);
  if (ability.id === 'scholar-clear' && !['MC', 'WM', 'AHR'].includes(state.setup.module))
    steps.splice(1);
  return {
    id: allocate ? `source-${++state.serial}` : 'preview',
    source: ability.source,
    owner,
    actor,
    kind: ability.mandatory ? 'mandatory' : 'ability',
    steps,
    step: 0,
    choices: {},
    bound: ability.declarationArea ? { areaMode: ability.declarationArea } : {},
    ability,
    cleanup,
  };
}
function abilities(
  pack: RulePack,
  state: EngineState,
  timing: Ability['timing'],
  mandatory: boolean,
  actor: Actor,
  only?: string,
): { owner: string; ability: Ability }[] {
  const result: { owner: string; ability: Ability }[] = [];
  for (const c of Object.values(state.characters)) {
    if (only && c.id !== only) continue;
    const cardScope = ['death', 'incident-completed', 'loop-end'].includes(timing);
    if (
      !cardScope &&
      c.status !== 'alive' &&
      !(c.identity === '鬼魂' && c.status === 'dead' && timing === 'mastermind-abilities')
    )
      continue;
    const idAbilities = identities(state, c.id).flatMap(
      (id) => pack.identities[id]?.abilities ?? [],
    );
    const characterAbilities = pack.characters[c.character]?.abilities ?? [];
    for (const ability of [...idAbilities, ...characterAbilities]) {
      const mastermindGoodwill =
        timing === 'mastermind-abilities' &&
        ability.timing === 'protagonist-abilities' &&
        refusal(pack, state, c.id) !== 'none' &&
        ((c.character === '医生' &&
          ability.id === 'doctor-counter' &&
          effective(state, c.id, 'goodwill') >= 2) ||
          (c.character === '上位存在' && effective(state, c.id, 'goodwill') >= 1) ||
          pack.identities[c.identity]?.puppet ||
          (pack.module === 'AHR' && state.setup.x.includes('傀儡之线')));
      if (
        (ability.timing === timing || mastermindGoodwill) &&
        Boolean(ability.mandatory) === mandatory
      ) {
        let adjusted =
          mastermindGoodwill && c.character === '上位存在' ? { ...ability, threshold: 1 } : ability;
        const rule = pack.characters[c.character]?.abilityArea;
        const usesMarker =
          rule && actor === rule.actor && (c.status === 'alive' || timing === 'death');
        const virtualArea = usesMarker
          ? state.setup.characters.find((t) => t.id === c.id)?.[rule.publicMarker]
          : c.character === 'UP主'
            ? state.characters[state.flags['streamer-target'] ?? '']?.area
            : undefined;
        if (usesMarker && virtualArea && !mandatory && rule.selection === 'before-declaration') {
          const chosen = state.flags['ability-area:' + c.id];
          const modes = chosen ? [chosen] : rule.modes;
          for (const mode of modes) {
            const variant = { ...adjusted, declarationArea: mode };
            if (available(pack, state, c.id, variant, actor))
              result.push({ owner: c.id, ability: variant });
          }
          continue;
        }
        if (virtualArea && adjusted.steps[0])
          adjusted = {
            ...adjusted,
            steps: [
              {
                ...adjusted.steps[0],
                choices: [
                  {
                    key: 'areaMode',
                    options: usesMarker ? rule.modes : ['actual', 'streamer'],
                  },
                  ...(adjusted.steps[0].choices ?? []),
                ],
              },
              ...adjusted.steps.slice(1),
            ],
          };
        if (available(pack, state, c.id, adjusted, actor, mandatory))
          result.push({ owner: c.id, ability: adjusted });
      }
    }
  }
  if (!only)
    for (const name of [state.setup.y, ...state.setup.x])
      for (const a of pack.plots[name]?.abilities ?? []) {
        if (name === state.setup.y && state.flags['alternate-y'] && a.id === 'loss') continue;
        if (
          a.timing === timing &&
          Boolean(a.mandatory) === mandatory &&
          available(pack, state, `plot:${name}`, a, actor)
        )
          result.push({ owner: `plot:${name}`, ability: a });
      }
  if (!only && timing === 'loop-end' && mandatory && state.flags['alternate-y'])
    for (const a of pack.plots[state.flags['alternate-y']]?.abilities ?? [])
      if (a.id === 'loss') result.push({ owner: `plot:${state.flags['alternate-y']}`, ability: a });
  if (!only)
    for (const { owner, ability } of pack.moduleAbilities)
      if (
        ability.timing === timing &&
        Boolean(ability.mandatory) === mandatory &&
        available(pack, state, owner, ability, actor)
      )
        result.push({ owner, ability });
  return result;
}
function enqueueMandatory(
  pack: RulePack,
  state: EngineState,
  timing: Ability['timing'],
  owner?: string,
  cleanup = false,
): void {
  const frames = abilities(pack, state, timing, true, 'mastermind', owner).map((a) =>
    makeFrame(state, a.owner, a.ability, 'mastermind', cleanup),
  );
  if (frames.length)
    state.frames.unshift(
      ...frames.map((f) => ({
        ...f,
        bound: { ...f.bound, batchGroup: `mandatory:${state.serial}` },
      })),
    );
}
function decision(
  state: EngineState,
  actor: Actor,
  kind: Decision['kind'],
  choices: Choice[],
  binding?: string,
): void {
  state.pending = { id: `decision-${++state.serial}`, actor, kind, options: choices };
  if (binding) state.flags['pending-binding'] = binding;
  else delete state.flags['pending-binding'];
}
function clearAbilityAreas(state: EngineState): void {
  for (const key of Object.keys(state.flags))
    if (key.startsWith('ability-area:')) delete state.flags[key];
}

function requestAbilityArea(
  pack: RulePack,
  state: EngineState,
  list: ReturnType<typeof abilities>,
): boolean {
  const pending = list.find(
    (a) => a.ability.declarationArea && !state.flags['ability-area:' + a.owner],
  );
  if (!pending) return false;
  const rule = pack.characters[state.characters[pending.owner]!.character]!.abilityArea!;
  decision(
    state,
    rule.actor,
    'choice',
    rule.modes.map((value) => ({ kind: 'select', value })),
    'flag:ability-area:' + pending.owner,
  );
  return true;
}

function enter(state: EngineState, phase: Phase): void {
  clearAbilityAreas(state);
  state.phase = phase;
  state.phaseEntered = false;
  announce(state, 'boundary', { phase, captain: state.captain });
}
function visibleBoard(state: EngineState): string {
  return canonical({
    characters: Object.values(state.characters).map((c) => [c.id, c.area, c.status, c.counters]),
    boards: state.boards,
    ex: state.ex,
  });
}
function incidentAreaFrom(origin: Area, mode: IncidentAreaMode): Area {
  if (origin === 'far' || mode === 'actual') return origin;
  if (mode === 'diagonal') return destination(origin, ['diagonal']);
  return ({ hospital: 'shrine', shrine: 'school', school: 'city', city: 'hospital' } as const)[
    origin
  ];
}
function enqueueIncident(
  pack: RulePack,
  state: EngineState,
  name: string,
  culprit: string,
  actor: Actor,
  occurrence = false,
  nested = false,
): string | null {
  const definition = pack.incidents[name];
  if (!definition) return null; // AI: a forged public name with no matching entry has no effect.
  // Lockdown attaches only when its incident occurs; invoking its effect cannot seal a board.
  if (name === '封锁' && !occurrence) return null;
  if (!definition.supported) {
    state.diagnostic = `Unsupported incident: ${name}`;
    return null;
  }
  if (definition.crowdThreshold !== undefined && state.characters[culprit]?.character === 'AI')
    culprit = 'city';
  const c = state.characters[culprit];
  const steps = c?.character === '黑猫' ? [] : clone(definition.steps);
  if (c?.character === '教主' && !nested) steps.push(...clone(steps));
  const id = `source-${++state.serial}`;
  const bound: Environment = {
    beforeVisible: visibleBoard(state),
    firstOccurrence:
      occurrence &&
      state.incidents.filter((i) => i.name === name && i.day === state.day).length === 1
        ? 'yes'
        : '',
  };
  if (definition.afterIncidentSteps) steps.push(...clone(definition.afterIncidentSteps));
  let incidentAreas: Frame['incidentAreas'];
  if (c && c.area !== 'far' && steps[0]) {
    const baseMode = pack.identities[c.identity]?.baseIncidentArea ?? 'actual';
    const offset = pack.characters[c.character]?.incidentAreaFromBase;
    const base = incidentAreaFrom(c.area, baseMode);
    const alternative = offset && incidentAreaFrom(base, offset);
    if (offset && alternative && alternative !== base) {
      const baseKey = baseMode === offset ? 'base' : baseMode;
      incidentAreas = { [baseKey]: base, [offset]: alternative };
      steps[0].choices = [
        { key: 'areaMode', options: Object.keys(incidentAreas), actor: 'mastermind' },
        ...(steps[0].choices ?? []),
      ];
    } else if (base !== c.area) {
      incidentAreas = { [baseMode]: base };
      bound.areaMode = baseMode;
    }
  }
  state.frames.unshift({
    id,
    source: definition.source,
    owner: culprit,
    actor,
    kind: 'incident',
    steps,
    step: 0,
    choices: {},
    bound,
    incident: name,
    incidentAreas,
    occurrence,
    nestedIncident: nested,
    cleanup: false,
  });
  return id;
}
function incidentHadPublicEffect(state: EngineState): boolean {
  // Invoked text shares the day's occurrence and never announces a second incident.
  const reports = state.observations.public;
  for (let i = reports.length - 1; i >= 0; i--) {
    const o = reports[i]!;
    if (o.type === 'incident' || o.type === 'boundary') break;
    // MC raises EX for the occurrence before applying even a black cat's empty text.
    if (
      state.setup.module === 'MC' &&
      o.type === 'board' &&
      'ex' in o.data &&
      reports[i - 1]?.type === 'incident'
    )
      continue;
    if (
      [
        'character',
        'board',
        'failure',
        'identity',
        'rule',
        'culprit',
        'card-grant',
        'victory',
      ].includes(o.type)
    )
      return true;
  }
  return false;
}
function complete(pack: RulePack, state: EngineState, frame: Frame): void {
  state.flags[`completed:${frame.id}`] = 'yes';
  if (frame.ability)
    for (const key of useKeys(state, frame.owner, frame.ability, frame.actor))
      state.uses[key] = (state.uses[key] ?? 0) + 1;
  state.audit.push({
    kind: 'source-completed',
    data: {
      id: frame.id,
      source: frame.source,
      ability: frame.ability?.id,
      ...(state.traceOutcomes && { owner: frame.owner, choices: { ...frame.choices } }),
      incident: frame.incident,
    },
  });
  if (frame.kind === 'incident') {
    if (
      frame.occurrence &&
      frame.bound.beforeVisible === visibleBoard(state) &&
      !incidentHadPublicEffect(state)
    )
      announce(state, 'no-effect', { day: state.day });
    if (!frame.nestedIncident)
      enqueueMandatory(pack, state, 'incident-completed', frame.owner, true);
  }
  if (frame.ability?.threshold !== undefined) {
    const previousFrames = new Set(state.frames);
    enqueueMandatory(pack, state, 'goodwill-completed', frame.owner, true);
    const c = state.characters[frame.owner];
    if (c?.status === 'alive' && c.identity === '童谣') {
      const ids = JSON.parse(frame.bound.targets ?? '[]') as string[];
      enqueueFlow(
        state,
        'fairytale-target-deaths',
        [{ effects: ids.map((target) => ({ op: 'kill', target })) }],
        c.id,
      );
      state.frames.at(-1)!.cleanup = true;
    }
    if (pack.module === 'AHR' && frame.ability.loopLimit === 1) {
      enqueueFlow(state, 'ahr-goodwill-world-move', [{ effects: [{ op: 'world-move' }] }]);
      state.frames.at(-1)!.cleanup = true;
    }
    const group = `completion:${frame.id}`;
    for (const child of state.frames.filter(
      (f) => !previousFrames.has(f) && f.cleanup && !f.awaiting,
    ))
      child.bound.batchGroup = group;
  }
}
function stageBatch(state: EngineState): void {
  const first = state.frames.shift();
  if (!first) return;
  const frames = [first];
  while (
    !first.awaiting &&
    !state.frames[0]?.awaiting &&
    first.bound.batchGroup &&
    state.frames[0]?.bound.batchGroup === first.bound.batchGroup
  )
    frames.push(state.frames.shift()!);
  state.batch = {
    frames,
    snapshot: { characters: clone(state.characters), boards: clone(state.boards), ex: state.ex },
  };
}
function bindChoices(
  pack: RulePack,
  state: EngineState,
  frame: Frame,
  specs: NonNullable<Step['choices']>,
): boolean {
  for (const spec of specs) {
    if (frame.choices[spec.key] !== undefined) continue;
    const choices = options(pack, state, frame, spec);
    if (spec.optional && choices.length) choices.push('~skip');
    if (!choices.length) {
      frame.choices[spec.key] = '';
      continue;
    }
    const actor: Actor =
      spec.actor === 'captain'
        ? state.captain
        : spec.actor?.startsWith('$')
          ? (ref(spec.actor, environment(state, frame)) as Actor)
          : ((spec.actor as Actor) ?? frame.actor);
    if (choices.length === 1) frame.choices[spec.key] = choices[0]!;
    else {
      decision(
        state,
        actor,
        'choice',
        choices.map((value) => ({ kind: 'select', value })),
        `frame:${frame.id}:${spec.key}`,
      );
      if (spec.key === 'areaMode') {
        state.pending!.areas = Object.fromEntries(
          choices.map((mode) => [
            mode,
            environment(state, { ...frame, choices: { ...frame.choices, areaMode: mode } })[
              'self.area'
            ] as Area,
          ]),
        );
      }
      return false;
    }
  }
  return true;
}

function processBatch(pack: RulePack, state: EngineState): void {
  const batch = state.batch!;
  if (batch.frames[0]?.awaiting) {
    const frame = batch.frames[0];
    state.batch = null;
    if (frame.awaiting!.every((id) => state.flags[`completed:${id}`])) {
      delete frame.awaiting;
      if (frame.step >= frame.steps.length) complete(pack, state, frame);
      else if (!state.endRequested || frame.cleanup) state.frames.unshift(frame);
    } else if (state.frames.some((child) => frame.awaiting!.includes(child.id)))
      state.frames.push(frame);
    return;
  }
  for (const frame of batch.frames) {
    const step = frame.steps[frame.step];
    if (!step) continue;
    if (!test(pack, state, step.condition, environment(state, frame))) {
      frame.bound.skipStep = 'yes';
      continue;
    }
    const specs = step.choices ?? [];
    if (
      !bindChoices(
        pack,
        state,
        frame,
        specs.filter((s) => s.key === 'areaMode'),
      )
    )
      return;
    if (
      frame.step === 0 &&
      frame.ability?.mandatory &&
      frame.choices.areaMode &&
      !test(pack, state, frame.ability.condition, environment(state, frame))
    ) {
      frame.bound.inactive = 'yes';
      frame.bound.skipStep = 'yes';
      continue;
    }
    if (step.moveOthersFromEffectiveArea) {
      const origin = environment(state, frame)['self.area'];
      const targets = Object.values(state.characters).filter(
        (c) => c.status === 'alive' && c.id !== frame.owner && c.area === origin,
      );
      step.choices = [
        ...specs,
        ...targets.map((c) => ({
          key: 'area_' + c.id,
          options: BOARDS.filter((b) => b !== origin),
        })),
      ];
      step.effects = targets.map((c) => ({ op: 'move', target: c.id, area: '$area_' + c.id }));
      delete step.moveOthersFromEffectiveArea;
    }
    if (
      !bindChoices(
        pack,
        state,
        frame,
        (step.choices ?? []).filter((s) => s.key !== 'areaMode'),
      )
    )
      return;
    if (Object.values(frame.choices).includes('~skip')) frame.bound.skipStep = 'yes';
    frame.bound.targets = JSON.stringify([
      ...new Set([
        ...(JSON.parse(frame.bound.targets ?? '[]') as string[]),
        ...Object.values(frame.choices).filter((id) => state.characters[id]?.status === 'alive'),
      ]),
    ]);
    if (
      frame.step === 0 &&
      frame.ability?.threshold !== undefined &&
      (frame.actor !== 'mastermind' ||
        (pack.module === 'AHR' &&
          state.phase === 'mastermind-abilities' &&
          (pack.identities[state.characters[frame.owner]?.identity ?? '']?.puppet ||
            state.setup.x.includes('傀儡之线')))) &&
      !frame.bound.refusalChecked &&
      !frame.bound.skipStep
    ) {
      if (!frame.bound.declared) {
        announce(state, 'declaration', {
          character: frame.owner,
          ability: frame.ability.id,
          choices: frame.choices,
        });
        frame.bound.declared = 'yes';
      }
      const mode =
        frame.actor === 'mastermind' || frame.ability.cannotRefuse
          ? 'none'
          : refusal(pack, state, frame.owner);
      if (mode === 'mandatory') {
        rejectAbility(pack, state, frame);
        frame.bound.refused = 'yes';
      } else if (mode === 'optional') {
        state.refusal = frame;
        decision(state, 'mastermind', 'refusal', [
          { kind: 'refuse', refuse: false },
          { kind: 'refuse', refuse: true },
        ]);
        return;
      }
      frame.bound.refusalChecked = 'yes';
    }
    if (
      frame.step === 0 &&
      frame.ability?.threshold !== undefined &&
      !frame.bound.refused &&
      !frame.bound.skipStep &&
      !frame.bound.communicated
    ) {
      frame.bound.communicated = 'yes';
      if (state.ll && !state.ll.communicated.includes(frame.owner)) {
        state.ll.communicated.push(frame.owner);
        announce(state, 'board', { communicatedMarker: frame.owner });
        checkSpecialVictory(state);
      }
      if (state.latchedWinner) {
        frame.bound.refused = 'game-interrupted';
      }
    }
  }
  const intents: Intent[] = batch.frames.flatMap((f) =>
    f.bound.skipStep || f.bound.refused
      ? []
      : (f.steps[f.step]?.effects ?? []).map((effect) => ({ effect, env: environment(state, f) })),
  );
  const result = settle(pack, state, intents, state.flags);
  if (result.followChoices?.length) {
    const follow = result.followChoices[0]!;
    decision(
      state,
      follow.key.startsWith('reveal:') ? 'mastermind' : state.captain,
      'choice',
      follow.options.map((value) => ({ kind: 'select', value })),
      `flag:${follow.key}`,
    );
    return;
  }
  state.batch = null;
  const continuations: Frame[] = [];
  const children = new Map<string, string[]>();
  const addChild = (parent: string, child: string) =>
    children.set(parent, [...(children.get(parent) ?? []), child]);
  for (const invocation of result.invoked.reverse()) {
    const child = enqueueIncident(
      pack,
      state,
      invocation.name,
      invocation.culprit,
      invocation.actor as Actor,
      false,
      invocation.nested,
    );
    if (child) addChild(invocation.parent, child);
  }
  for (const invocation of result.goodwill ?? []) {
    const c = state.characters[invocation.target];
    const ability =
      c && pack.characters[c.character]?.abilities.find((a) => a.id === invocation.ability);
    if (ability) {
      const frame = makeFrame(
        state,
        invocation.target,
        { ...ability, threshold: 0, cannotRefuse: true },
        invocation.actor as Actor,
      );
      state.frames.unshift(frame);
      addChild(invocation.parent, frame.id);
    }
  }
  for (const f of batch.frames) {
    if (f.bound.refused || f.bound.inactive) continue;
    f.step++;
    delete f.bound.skipStep;
    // Keep earlier named bindings, but require fresh choices for subsequent steps.
    for (const spec of f.steps[f.step]?.choices ?? []) delete f.choices[spec.key];
    if (children.has(f.id)) {
      f.awaiting = children.get(f.id)!;
      continuations.push(f);
    } else if (f.step < f.steps.length) continuations.push(f);
    else complete(pack, state, f);
  }
  // Subsequent source steps wait behind all due mandatory cleanup.
  state.frames.push(...continuations);
  const deathFrames: Frame[] = [];
  for (const id of result.died) {
    deathFrames.push(
      ...abilities(pack, state, 'death', true, 'mastermind', id).map((a) =>
        makeFrame(state, a.owner, a.ability, 'mastermind', true),
      ),
    );
    const dead = state.characters[id]!;
    const counterpart =
      dead.identity === '求爱者' ? '心上人' : dead.identity === '心上人' ? '求爱者' : '';
    if (counterpart)
      for (const c of Object.values(state.characters).filter(
        (c) => c.status === 'alive' && c.identity === counterpart,
      ))
        deathFrames.push({
          id: `source-${++state.serial}`,
          source: pack.identities[counterpart]!.source,
          owner: c.id,
          actor: 'mastermind',
          kind: 'mandatory',
          steps: [{ effects: [{ op: 'counter', target: c.id, counter: 'paranoia', amount: 6 }] }],
          step: 0,
          choices: {},
          bound: {},
          cleanup: true,
        });
  }
  if (deathFrames.length) {
    const group = `death:${++state.serial}`;
    state.frames.unshift(
      ...deathFrames.map((f) => ({ ...f, bound: { ...f.bound, batchGroup: group } })),
    );
  }
  const due = (state.delayed ?? []).filter(
    (t) => t.loop === state.loop && t.day === state.day && t.timing === state.phase,
  );
  state.delayed = (state.delayed ?? []).filter((t) => !due.includes(t));
  for (const task of due) {
    const f: Frame = {
      id: `source-${++state.serial}`,
      source: 'immediate-due',
      owner: '',
      actor: 'mastermind',
      kind: 'mandatory',
      steps: [{ effects: task.effects }],
      step: 0,
      choices: {},
      bound: task.env,
      cleanup: true,
    };
    state.frames.unshift(f);
  }
}
function rejectAbility(pack: RulePack, state: EngineState, frame: Frame): void {
  announce(state, 'refused', { character: frame.owner, ability: frame.ability!.id });
  frame.bound.refused = 'yes';
  frame.bound.refusalChecked = 'yes';
  if (pack.module === 'WM') {
    state.ex++;
    state.flags['ex-increased'] = 'yes';
    announce(state, 'board', { ex: state.ex });
  }
}
function resetLoop(pack: RulePack, state: EngineState): void {
  const before = clone(state);
  for (const config of state.setup.characters) {
    const c = state.characters[config.id]!,
      def = pack.characters[c.character]!;
    c.status = config.enterDay || (config.enterLoop ?? 1) > state.loop ? 'absent' : 'alive';
    c.area = c.initialArea = config.initialArea ?? def.initial[0] ?? 'hospital';
    c.counters = zeroCounters();
    c.flags = {};
    c.forbidden = [...def.forbidden];
    c.identity = c.character === '临时工' ? '平民' : c.initialIdentity;
    if (
      state.setup.y === '虚幻世界' &&
      c.initialIdentity === '强迫症' &&
      !config.reverseIdentity &&
      !['局外人', '模仿犯'].includes(c.character)
    )
      c.flags['y-obsessive'] = 'yes';
  }
  for (const c of Object.values(state.characters).filter((c) => c.character === '临时工？')) {
    c.status = 'absent';
    c.area = 'city';
    c.counters = zeroCounters();
    c.flags = {};
    c.identity = c.initialIdentity;
  }
  state.boards = { hospital: 0, shrine: 0, city: 0, school: 0 };
  state.cards = state.cards.map((c) => ({
    ...c,
    status: c.status === 'removed' ? 'removed' : 'hand',
  }));
  state.day = 1;
  state.failed = false;
  state.protagonistDead = false;
  state.endRequested = false;
  state.protected = false;
  state.flags = {};
  state.uses = {};
  state.placements = [];
  state.curses = [];
  state.delayed = (state.delayed ?? []).filter((t) => t.loop >= state.loop);
  if (pack.module !== 'WM') state.ex = 0;
  if (pack.module === 'AHR') {
    for (const actor of seats)
      if (!state.cards.some((c) => c.owner === actor && c.kind === 'paranoia+2'))
        state.cards.push({
          id: `${actor}-paranoia+2`,
          owner: actor,
          kind: 'paranoia+2',
          once: true,
          status: 'hand',
        });
    if (!state.cards.some((c) => c.owner === 'mastermind' && c.kind === 'goodwill+1'))
      state.cards.push({
        id: 'mastermind-goodwill+1',
        owner: 'mastermind',
        kind: 'goodwill+1',
        once: false,
        status: 'hand',
      });
    if (state.loop === 1) grantCard(state, 'mastermind', 'despair+1');
  }
  publishChanges(before, state);
}
function startLoop(state: EngineState): void {
  const effects: Intent[] = [];
  for (const c of Object.values(state.characters)) {
    if (c.status !== 'alive') continue;
    if (!state.appeared.includes(c.id)) state.appeared.push(c.id);
    if (c.character === '黑猫')
      effects.push({
        effect: { op: 'counter', target: 'shrine', counter: 'intrigue', amount: 1 },
        env: {},
      });
    if (c.identity === '亲友' && c.revealed)
      effects.push({
        effect: { op: 'counter', target: c.id, counter: 'goodwill', amount: 1 },
        env: {},
      });
    const previous = state.previousLoop?.characters[c.id];
    if (c.identity === '因果残片' && previous) {
      if (previous.status === 'dead') grantCard(state, 'mastermind', 'despair+1');
      if (previous.status === 'alive' && previous.counters.goodwill + previous.counters.hope >= 2)
        for (const actor of seats) grantCard(state, actor, 'hope+1');
    }
    if (c.identity === '叙述者' && state.previousLoop && state.previousLoop.ex >= 3)
      for (const actor of seats) grantCard(state, actor, 'hope+1');
    if (
      state.setup.x.includes('因果线') &&
      previous &&
      previous.counters.goodwill + previous.counters.hope > 0
    )
      effects.push({
        effect: { op: 'counter', target: c.id, counter: 'paranoia', amount: 2 },
        env: {},
      });
  }
  if (state.setup.x.includes('超越世界线')) {
    if (state.loop % 2 === 0) grantCard(state, 'mastermind', 'despair+1');
    if (state.loop === state.setup.loops)
      for (const actor of seats) grantCard(state, actor, 'hope+1');
  }
  if (effects.length)
    enqueueFlow(state, 'loop-start-base', [{ effects: effects.map((i) => i.effect) }]);
  for (const c of Object.values(state.characters).filter(
    (c) => c.status === 'alive' && c.character === '学者',
  ))
    enqueueFlow(
      state,
      'scholar-start',
      [
        {
          choices: [{ key: 'counter', options: ['goodwill', 'paranoia', 'intrigue'] }],
          effects: [{ op: 'counter', target: c.id, counter: '$counter', amount: 1 }],
        },
      ],
      c.id,
    );
  if ((state.setup.y === '因果之绊' || state.setup.x.includes('诸神之骰')) && state.previousLoop) {
    const targets = Object.values(state.characters)
      .filter(
        (c) => c.status === 'alive' && state.previousLoop!.characters[c.id]?.status === 'dead',
      )
      .map((c) => c.id);
    if (targets.length)
      enqueueFlow(state, 'previous-death-ex', [
        {
          choices: [{ key: 'target', options: targets }],
          effects: [{ op: 'flag', target: '$target', key: 'causal-ex' }],
        },
      ]);
  }
  if (state.setup.x.includes('隔离病房惊魂记') && state.previousLoop && state.previousLoop.ex <= 2)
    enqueueFlow(state, 'quarantine', [{ effects: [{ op: 'ex', amount: 1 }] }]);
  if (state.setup.x.includes('疯狂的真相') && state.ex >= 2)
    state.flags['alternate-y'] = state.setup.alternateY ?? '';
}
function enqueueFlow(
  state: EngineState,
  source: string,
  steps: Step[],
  owner = '',
  actor: Actor = 'mastermind',
): void {
  state.frames.push({
    id: `source-${++state.serial}`,
    source,
    owner,
    actor,
    kind: 'mandatory',
    steps,
    step: 0,
    choices: {},
    bound: {},
    cleanup: false,
  });
}
export function legalCardTargets(state: EngineState, actor: Actor): string[] {
  const ownSide = (owner: Actor) =>
    actor === 'mastermind' ? owner === 'mastermind' : owner !== 'mastermind';
  const placed = state.placements
    .filter((p) => ownSide(state.cards.find((c) => c.id === p.card)!.owner))
    .map((p) => p.target);
  return [
    ...BOARDS,
    ...Object.values(state.characters)
      .filter(
        (c) =>
          c.status === 'alive' &&
          c.character !== '幻想' &&
          (actor !== 'mastermind' || !['预言家', '狼人'].includes(c.identity)) &&
          (actor === 'mastermind' ||
            (!c.flags['no-protagonist-cards'] &&
              !(
                state.flags['ex-cards-restricted'] &&
                (c.flags['causal-ex'] || state.flags['streamer-target'] === c.id)
              ))),
      )
      .map((c) => c.id),
  ].filter((t) => !placed.includes(t));
}
export function cardCount(state: EngineState, actor: Actor): number {
  return actor === 'mastermind' ? Number(state.flags[`mastermind-cards:${state.day}`] ?? 3) : 1;
}
function resolveCards(pack: RulePack, state: EngineState, part: number): void {
  const intents: Intent[] = [];
  const placements = state.placements.map((p) => ({
    ...p,
    card: state.cards.find((c) => c.id === p.card)!,
  }));
  const globalBlocks = placements.filter((p) => p.card.kind === 'block-intrigue').length;
  const hopes = placements.filter((p) => p.card.kind === 'hope+1').length;
  for (const target of [
    ...BOARDS,
    ...Object.values(state.characters)
      .filter((c) => c.status === 'alive')
      .map((c) => c.id),
  ]) {
    const c = state.characters[target];
    const group = placements.filter(
      (p) => p.target === target || (c?.character === '幻想' && p.target === c.area),
    );
    const ignoresBlock =
      c && identities(state, target).some((i) => ['时间旅者', '次元旅者'].includes(i));
    const kinds = group
      .filter((p) => !(ignoresBlock && p.target === target && p.card.kind === 'block-goodwill'))
      .map((p) => p.card.kind);
    if (
      part === 0 &&
      c &&
      !kinds.includes('block-movement') &&
      !(state.setup.x.includes('心无灵犀') && kinds.includes('block-goodwill'))
    ) {
      const area = destination(
        c.area,
        kinds.filter((k) => ['horizontal', 'vertical', 'diagonal'].includes(k)),
      );
      if (area !== c.area) intents.push({ effect: { op: 'move', target, area }, env: {} });
    }
    if (part > 0)
      for (const original of kinds) {
        const kind = original === 'hope+1' && hopes >= 2 ? 'goodwill+1' : original;
        const [counter, magnitude] = kind.split(/(?=[+-])/);
        if (
          !['goodwill', 'paranoia', 'intrigue', 'hope', 'despair'].includes(counter!) ||
          !magnitude
        )
          continue;
        const n = Number(magnitude);
        if ((part === 1 && n < 0) || (part === 2 && n > 0)) continue;
        if (counter === 'goodwill' && kinds.includes('block-goodwill')) continue;
        if (counter === 'paranoia' && kinds.includes('block-paranoia')) continue;
        const cultist = Object.values(state.characters).some(
          (t) =>
            t.status === 'alive' &&
            t.flags.cultist &&
            (t.flags['cultist-area'] ?? t.area) === (c?.area ?? target),
        );
        if (
          counter === 'intrigue' &&
          kinds.includes('block-intrigue') &&
          (globalBlocks < 2 || (pack.module === 'WM' && state.ex >= 3)) &&
          !cultist
        )
          continue;
        intents.push({
          effect: {
            op: 'counter',
            target,
            counter: counter as 'goodwill' | 'paranoia' | 'intrigue',
            amount: n,
          },
          env: {},
        });
      }
  }
  const result = settle(pack, state, intents, state.flags);
  if (result.followChoices?.length) {
    const follow = result.followChoices[0]!;
    decision(
      state,
      state.captain,
      'choice',
      follow.options.map((value) => ({ kind: 'select', value })),
      `flag:${follow.key}`,
    );
    return;
  }
  state.flags['cards-part'] = String(part + 1);
}
function hasSameAreaTrigger(pack: RulePack, state: EngineState, owner: CharacterState): boolean {
  const condition = pack.identities[owner.identity]?.sameAreaIncidentTrigger;
  return (
    owner.status === 'alive' &&
    condition !== undefined &&
    test(pack, state, condition, { self: owner.id })
  );
}

function triggerAreaKey(state: EngineState, owner: CharacterState): string {
  return `incident-trigger-area:${state.loop}:${state.day}:${owner.id}`;
}

function incidentCulprits(state: EngineState, original: EngineState['characters'][string]) {
  return original.character === '临时工'
    ? [original, ...Object.values(state.characters).filter((c) => c.character === '临时工？')]
    : [original];
}
function occur(pack: RulePack, state: EngineState): void {
  const i = state.setup.incidents.find((i) => i.day === state.day);
  if (!i) return;
  const original = state.characters[i.culprit]!;
  if (pack.incidents[i.name]?.crowdThreshold !== undefined) {
    const corpses = select(
      pack,
      state,
      {
        kind: 'dead',
        where: { cmp: 'eq', left: { field: 'area', target: '$it' }, right: i.culprit },
      },
      {},
    ).length;
    const occurred = corpses >= pack.incidents[i.name]!.crowdThreshold!;
    announce(state, 'incident', { day: i.day, name: i.publicName ?? i.name, occurred });
    if (occurred) {
      state.incidents.push({
        loop: state.loop,
        day: i.day,
        name: i.name,
        publicName: i.publicName ?? i.name,
        culprit: i.culprit,
      });
      enqueueIncident(pack, state, i.name, i.culprit, 'mastermind', true);
    }
    return;
  }
  const culprits = incidentCulprits(state, original);
  const triggered: string[] = [];
  for (const c of culprits) {
    const definition = pack.incidents[i.name]!;
    let threshold =
      c.paranoiaLimit + (definition.thresholdOffset ?? 0) * (c.character === '教主' ? 2 : 1);
    if (
      state.setup.x.includes('灭亡讴歌') &&
      c.identity === '平民' &&
      Object.values(state.characters).some((t) => t.identity === '预言家' && t.status === 'alive')
    )
      threshold--;
    const prophet = Object.values(state.characters).some(
      (t) => t.id !== c.id && t.status === 'alive' && t.identity === '预言家' && t.area === c.area,
    );
    const sameAreaTrigger = Object.values(state.characters).some(
      (owner) =>
        hasSameAreaTrigger(pack, state, owner) &&
        (state.flags[triggerAreaKey(state, owner)] === 'territory'
          ? state.setup.characters.find((s) => s.id === owner.id)?.territory
          : owner.area) === c.area,
    );
    const watcher =
      c.counters.despair > 0 &&
      Object.values(state.characters).some(
        (t) => t.status === 'alive' && t.identity === '监视者' && t.area === c.area,
      );
    let paranoia = effective(
      state,
      c.id,
      definition.thresholdCounter ??
        (pack.module === 'AHR' && state.ex % 2 === 1 ? 'goodwill' : 'paranoia'),
    );
    const ordinaryParanoia =
      !definition.thresholdCounter && !(pack.module === 'AHR' && state.ex % 2 === 1);
    if (ordinaryParanoia && c.character === 'AI')
      paranoia = COUNTERS.reduce((n, k) => n + c.counters[k], 0);
    else if (
      ordinaryParanoia &&
      (c.identity === '祭品' ||
        (state.setup.y === '士的宁毒液' && ['连续杀人', '自杀'].includes(i.name)))
    )
      paranoia += c.counters.intrigue;
    const occurred =
      c.status === 'alive' &&
      !c.flags['no-incidents'] &&
      !prophet &&
      (c.identity === '强迫症' ||
        i.name === '次元转换' ||
        sameAreaTrigger ||
        watcher ||
        paranoia >= threshold);
    if (occurred) triggered.push(c.id);
  }
  announce(state, 'incident', {
    day: i.day,
    name: i.publicName ?? i.name,
    occurred: triggered.length > 0,
  });
  if (!triggered.length) return;
  const definition = pack.incidents[i.name]!;
  const first = !state.incidents.some((t) => t.name === i.name && t.day === i.day);
  state.flags['first-occurrence'] = first ? 'yes' : '';
  state.incidents.push({
    loop: state.loop,
    day: i.day,
    name: i.name,
    publicName: i.publicName ?? i.name,
    culprit: i.culprit,
  });
  if (state.flags.hound) state.flags['hound-due'] = 'yes';
  if (pack.module === 'MC') {
    state.ex += original.character === '黑猫' ? 1 : (definition.exGain ?? 1);
    announce(state, 'board', { ex: state.ex });
  }
  const group = `incident:${++state.serial}`;
  for (const culprit of triggered) {
    enqueueIncident(pack, state, i.name, culprit, 'mastermind', true);
    if (state.frames[0]) state.frames[0].bound.batchGroup = group;
  }
}
function finalizeLoop(pack: RulePack, state: EngineState): void {
  state.previousLoop = {
    characters: clone(state.characters),
    boards: clone(state.boards),
    ex: state.ex,
  };
  if (!state.failed && !state.protagonistDead) {
    win(state, 'protagonists');
    return;
  }
  if (state.loop < state.setup.loops && !(pack.module === 'WM' && state.ex >= 4)) {
    state.loop++;
    enter(state, 'discussion');
    return;
  }
  if (pack.module === 'FS') {
    win(state, 'mastermind');
    return;
  }
  prepareFinalGuess(state);
}
function prepareFinalGuess(state: EngineState): void {
  if (state.ll) {
    if (
      state.setup.y === '最终计划' &&
      state.phase === 'loop-end' &&
      state.loop === state.setup.loops &&
      Object.values(state.characters).some((c) => c.identity === '关键人物' && c.counters.hope > 0)
    )
      state.ll.finalTraitorsDisabled = true;
  }
  for (const c of Object.values(state.characters)) {
    c.counters = zeroCounters();
    if (state.appeared.includes(c.id)) c.status = 'alive';
    c.identity = c.initialIdentity;
    c.area = c.initialArea;
  }
  state.boards = { hospital: 0, shrine: 0, city: 0, school: 0 };
  state.ex = 0;
  // The ordinary suppression from hope expires on cleanup. Only the special
  // carry-over from the completed final loop remains during the final guesses.
  if (state.ll) state.ll.finalEligible = seats.filter((p) => !traitors(state).includes(p));
  state.flags['guessed'] = '[]';
  enter(state, 'final-guess');
}
function win(state: EngineState, winner: NonNullable<EngineState['winner']>): void {
  state.winner = winner;
  state.winners =
    winner === 'protagonists'
      ? (state.ll?.finalEligible ?? seats.filter((p) => !traitors(state).includes(p)))
      : [winner];
  enter(state, 'finished');
  announce(state, 'victory', { winner, winners: state.winners });
}
/** Resume performs bounded work. Budget exhaustion is paused, never a game result. */
export function drive(pack: RulePack, state: EngineState, budget: number): 'ok' | 'paused' {
  if (!Number.isSafeInteger(budget) || budget < 0)
    throw new Error('Budget must be a nonnegative integer.');
  if (pack.digest !== state.ruleDigest) throw new Error('Rule pack mismatch.');
  for (let n = 0; n < budget; n++) {
    if (state.diagnostic) return 'paused';
    if (state.pending || state.winner) return 'ok';
    if (state.phase === 'briefing') {
      decision(state, state.captain, 'continue', [{ kind: 'start' }]);
      return 'ok';
    }
    if (state.latchedWinner && !state.batch) {
      state.frames = state.frames.filter((f) => f.cleanup);
      if (!state.frames.length) {
        win(state, state.latchedWinner);
        continue;
      }
    }
    if (state.batch) {
      processBatch(pack, state);
      continue;
    }
    if (state.endRequested && state.phase !== 'loop-end' && state.phase !== 'final-guess')
      state.frames = state.frames.filter((f) => f.cleanup || f.awaiting);
    if (state.frames.length) {
      stageBatch(state);
      continue;
    }
    if (
      state.endRequested &&
      state.phase !== 'loop-end' &&
      state.phase !== 'final-guess' &&
      state.phase !== 'discussion'
    ) {
      enter(state, 'loop-end');
      continue;
    }
    if (!state.phaseEntered) {
      if (state.phase === 'day-end' && pack.module === 'AHR' && state.flags['world-moved']) {
        delete state.flags['world-moved'];
        settle(pack, state, [{ effect: { op: 'ex', amount: 1 }, env: {} }]);
      }
      if (
        state.phase === 'day-end' &&
        pack.module === 'HSA' &&
        !state.flags[`curses:${state.day}`]
      ) {
        state.flags[`curses:${state.day}`] = 'yes';
        delete state.flags['curse-no-target'];
        const group = `curses:${++state.serial}`;
        for (const curse of state.curses ?? []) {
          if (BOARDS.includes(curse.target as Board)) {
            const targets = Object.values(state.characters)
              .filter((c) => c.status === 'alive' && c.area === curse.target)
              .map((c) => c.id);
            if (targets.length)
              enqueueFlow(state, 'curse-attach', [
                {
                  choices: [{ key: 'target', options: targets }],
                  effects: [{ op: 'curse', id: curse.id, target: '$target' }],
                },
              ]);
            else state.flags['curse-no-target'] = 'yes';
          } else {
            const c = state.characters[curse.target];
            if (!c || ['removed', 'absent'].includes(c.status)) continue;
            enqueueFlow(
              state,
              'curse-death',
              [
                { effects: [{ op: 'kill', target: c.id }] },
                { effects: [{ op: 'curse', id: curse.id, target: c.area }] },
              ],
              c.id,
            );
          }
        }
        for (const f of state.frames) f.bound.batchGroup = group;
        if (state.frames.length) continue;
      }
      if (state.phase === 'loop-start' && !state.flags['placements-done']) {
        state.flags['placements-done'] = 'yes';
        for (const c of Object.values(state.characters).filter((c) => c.character === '手下'))
          enqueueFlow(
            state,
            'henchman-placement',
            [
              {
                choices: [{ key: 'area', options: { kind: 'boards' } }],
                effects: [{ op: 'place', target: c.id, area: '$area' }],
              },
            ],
            c.id,
          );
        if (state.frames.length) continue;
      }
      if (state.phase === 'incident') {
        const scheduled = state.setup.incidents.find((i) => i.day === state.day);
        const culprit = scheduled && state.characters[scheduled.culprit];
        if (culprit) {
          const culprits = incidentCulprits(state, culprit);
          for (const owner of Object.values(state.characters)) {
            const rule = pack.characters[owner.character]?.abilityArea;
            if (!rule || !hasSameAreaTrigger(pack, state, owner)) continue;
            const key = triggerAreaKey(state, owner);
            const territory = state.setup.characters.find((c) => c.id === owner.id)?.[
              rule.publicMarker
            ];
            if (
              !state.flags[key] &&
              territory &&
              territory !== owner.area &&
              culprits.some(
                (c) => c.status === 'alive' && (owner.area === c.area || territory === c.area),
              )
            ) {
              decision(
                state,
                rule.actor,
                'choice',
                rule.modes.map((value) => ({ kind: 'select', value })),
                'flag:' + key,
              );
              return 'ok';
            }
          }
        }
      }
      state.phaseEntered = true;
      checkSpecialVictory(state);
      if (state.latchedWinner) continue;
      if (state.phase === 'loop-start') startLoop(state);
      if (state.phase === 'day-start') {
        const before = clone(state);
        for (const c of Object.values(state.characters)) delete c.flags.immobile;
        delete state.flags['mad-night-today'];
        for (const c of state.setup.characters)
          if (
            c.enterDay === state.day &&
            (c.enterLoop ?? 1) <= state.loop &&
            state.characters[c.id]!.status === 'absent'
          )
            state.characters[c.id]!.status = 'alive';
        const parttimer = Object.values(state.characters).find((c) => c.character === '临时工');
        const replacement = Object.values(state.characters).find((c) => c.character === '临时工？');
        if (parttimer?.status === 'dead' && replacement?.status === 'absent') {
          replacement.status = 'alive';
          replacement.area = 'city';
        }
        for (const c of Object.values(state.characters))
          if (c.status === 'alive' && !state.appeared.includes(c.id)) state.appeared.push(c.id);
        publishChanges(before, state);
        if (pack.module === 'WM' && state.day === 1 && state.ex >= 1)
          enqueueFlow(
            state,
            'wm-invocation',
            [
              {
                choices: [{ key: 'target', options: { kind: 'alive' }, optional: true }],
                effects: [{ op: 'counter', target: '$target', counter: 'goodwill', amount: 2 }],
              },
            ],
            '',
            state.captain,
          );
      }
      if (state.phase === 'incident') occur(pack, state);
      if (state.phase === 'captain-change')
        state.captain = seats[(seats.indexOf(state.captain) + 1) % 3]!;
      if (state.phase === 'card-resolution') {
        announce(state, 'cards', {
          placements: state.placements.map((p) => ({
            owner: state.cards.find((c) => c.id === p.card)!.owner,
            target: p.target,
            kind: state.cards.find((c) => c.id === p.card)!.kind,
          })),
        });
        state.flags['cards-part'] = '0';
      }
      if (
        state.phase === 'loop-end' &&
        state.revealedIdentities.some(
          (r) => r.loop === state.loop && ['主谋', '不安定因子', '魔术师'].includes(r.identity),
        )
      )
        state.flags['classified-revealed'] = 'yes';
      enqueueMandatory(pack, state, state.phase);
      const due = (state.delayed ?? []).filter(
        (t) => t.loop === state.loop && t.day === state.day && t.timing === state.phase,
      );
      state.delayed = (state.delayed ?? []).filter((t) => !due.includes(t));
      for (const task of due) {
        enqueueFlow(state, 'delayed', [{ effects: task.effects }], task.env.self ?? '');
        Object.assign(state.frames.at(-1)!.bound, task.env);
      }
      if (state.phase === 'loop-end' && pack.module === 'WM' && state.ex >= 2)
        enqueueFlow(state, 'wm-ancestral-memory', [
          { effects: [{ op: 'reveal-rule', rule: state.setup.x[0]! }] },
        ]);
      if (state.phase === 'day-end' && pack.module === 'WM' && state.ex >= 4)
        enqueueFlow(state, 'wm-madness', [{ effects: [{ op: 'protagonist-death' }] }]);
      if (state.phase === 'mastermind-abilities')
        for (const c of Object.values(state.characters).filter(
          (c) =>
            c.status === 'alive' &&
            c.character === '御神木' &&
            refusal(pack, state, c.id) !== 'none',
        )) {
          const a = pack.characters[c.character]!.abilities[0]!;
          state.frames.push(makeFrame(state, c.id, { ...a, mandatory: true }, 'mastermind'));
        }
      if (state.phase === 'day-end') {
        if (pack.module === 'HSA') {
          const boards = BOARDS.filter((board) => {
            const zombies = select(
              pack,
              state,
              {
                kind: 'dead',
                where: {
                  all: [
                    { cmp: 'eq', left: { field: 'area', target: '$it' }, right: board },
                    { cmp: 'eq', left: { field: 'identity', target: '$it' }, right: '丧尸' },
                  ],
                },
              },
              {},
            ).length;
            const alive = Object.values(state.characters).filter(
              (c) => c.status === 'alive' && c.area === board,
            );
            return (
              alive.length > 0 &&
              zombies + alive.filter((c) => c.identity === '丧尸').length >
                alive.filter((c) => c.identity !== '丧尸').length
            );
          });
          if (boards.length)
            enqueueFlow(state, 'zombie-kill', [
              {
                choices: [
                  { key: 'area', options: boards },
                  {
                    key: 'target',
                    options: {
                      kind: 'alive',
                      where: {
                        cmp: 'eq',
                        left: { field: 'area', target: '$it' },
                        right: { ref: '$area' },
                      },
                    },
                  },
                ],
                effects: [{ op: 'kill', target: '$target' }],
              },
            ]);
        }
        const firstIncident = state.incidents.find((i) => i.loop === state.loop);
        const streamer = Object.values(state.characters).find(
          (c) => c.character === 'UP主' && c.status === 'alive',
        );
        if (streamer && firstIncident?.day === state.day)
          enqueueFlow(
            state,
            'streamer-first-incident',
            [
              {
                choices: [
                  {
                    key: 'target',
                    options: {
                      kind: 'alive',
                      where: {
                        any: [
                          { attribute: '少年', target: '$it' },
                          { attribute: '少女', target: '$it' },
                        ],
                      },
                    },
                  },
                ],
                effects: [{ op: 'flag', key: 'streamer-target', value: '$target' }],
              },
            ],
            streamer.id,
          );
        const specials: Intent[] = Object.values(state.characters)
          .filter(
            (c) =>
              c.status === 'alive' &&
              c.character === '临时工' &&
              COUNTERS.reduce((n, k) => n + c.counters[k], 0) >= 3,
          )
          .map((c) => ({ effect: { op: 'kill', target: c.id }, env: {} }));
        // These belong to the same established day-end mandatory batch.
        if (specials.length)
          state.frames.push({
            id: `source-${++state.serial}`,
            source: 'character.parttimer',
            owner: '',
            actor: 'mastermind',
            kind: 'mandatory',
            steps: [{ effects: specials.map((i) => i.effect) }],
            step: 0,
            bound: { batchGroup: state.frames[0]?.bound.batchGroup ?? `mandatory:${state.serial}` },
            choices: {},
            cleanup: false,
          });
      }
      if (
        state.frames.length > 1 &&
        ['loop-start', 'mastermind-abilities', 'day-end'].includes(state.phase)
      ) {
        const group = `phase:${++state.serial}`;
        for (const f of state.frames) f.bound.batchGroup = group;
      }
      continue;
    }
    if (state.phase === 'discussion') {
      if (state.flags['final-guess-votes']) {
        const votes = JSON.parse(state.flags['final-guess-votes']) as string[];
        const actor = seats.find((p) => !votes.includes(p));
        if (!actor) {
          delete state.flags['final-guess-votes'];
          prepareFinalGuess(state);
          continue;
        }
        decision(state, actor, 'choice', [
          { kind: 'vote-final-guess', agree: true },
          { kind: 'vote-final-guess', agree: false },
        ]);
        return 'ok';
      }
      decision(state, state.captain, 'continue', [
        { kind: 'continue' },
        ...(pack.module === 'FS' ? [] : [{ kind: 'request-final-guess' as const }]),
      ]);
      return 'ok';
    }
    if (state.phase === 'mastermind-cards' || state.phase === 'protagonist-cards') {
      const protagonistCount = state.placements.filter(
        (p) => state.cards.find((c) => c.id === p.card)!.owner !== 'mastermind',
      ).length;
      if (
        (state.phase === 'mastermind-cards' &&
          state.placements.some(
            (p) => state.cards.find((c) => c.id === p.card)!.owner === 'mastermind',
          )) ||
        protagonistCount === 3
      ) {
        enter(state, nextPhase[state.phase]!);
        continue;
      }
      const actor =
        state.phase === 'mastermind-cards'
          ? 'mastermind'
          : seats[(seats.indexOf(state.captain) + protagonistCount) % 3]!;
      decision(state, actor, 'cards', []);
      return 'ok';
    }
    if (state.phase === 'card-resolution') {
      const part = Number(state.flags['cards-part']);
      if (part === 1 && !state.flags['cultist-done']) {
        const availableCultists = abilities(pack, state, 'card-resolution', false, 'mastermind');
        if (requestAbilityArea(pack, state, availableCultists)) return 'ok';
        if (availableCultists.length) {
          decision(state, 'mastermind', 'ability', [
            { kind: 'pass' },
            ...availableCultists.map((a) => ({
              kind: 'ability' as const,
              owner: a.owner,
              ability: a.ability.id,
            })),
          ]);
          return 'ok';
        }
        state.flags['cultist-done'] = 'yes';
      }
      if (part < 3) {
        resolveCards(pack, state, part);
        continue;
      }
      const hopeCount = state.cards.filter((c) => c.status === 'set' && c.kind === 'hope+1').length;
      for (const c of state.cards.filter((c) => c.status === 'set'))
        c.status =
          c.kind === 'hope+1' ? (hopeCount >= 2 ? 'hand' : 'removed') : c.once ? 'used' : 'hand';
      if (hopeCount === 1)
        for (const c of state.cards.filter((c) => c.kind === 'hope+1')) c.status = 'removed';
      state.placements = [];
      delete state.flags['cultist-done'];
      for (const c of Object.values(state.characters)) {
        delete c.flags.cultist;
        delete c.flags['cultist-area'];
      }
      enter(state, 'mastermind-abilities');
      continue;
    }
    if (
      [
        'mastermind-abilities',
        'protagonist-abilities',
        'day-end',
        'loop-start',
        'loop-end',
      ].includes(state.phase)
    ) {
      const actor = state.phase === 'protagonist-abilities' ? state.captain : 'mastermind';
      const list = abilities(pack, state, state.phase, false, actor);
      if (!state.flags[`passed:${state.phase}`] && requestAbilityArea(pack, state, list))
        return 'ok';
      if (list.length && !state.flags[`passed:${state.phase}`]) {
        decision(state, actor, 'ability', [
          { kind: 'pass' },
          ...list.map((a) => ({ kind: 'ability' as const, owner: a.owner, ability: a.ability.id })),
        ]);
        return 'ok';
      }
    }
    if (state.phase === 'loop-end') {
      finalizeLoop(pack, state);
      continue;
    }
    if (state.phase === 'final-guess') {
      if (state.ll && !state.ll.cAnswered) {
        const c = traitors(state).find((p) => state.ll!.roles[p] === 'C');
        if (c) {
          decision(state, c, 'guess', []);
          state.flags['c-guess'] = 'yes';
          return 'ok';
        }
        state.ll.cAnswered = true;
      }
      const actor = state.ll?.finalEligible?.includes(state.captain)
        ? state.captain
        : (state.ll?.finalEligible?.[0] ?? state.captain);
      decision(state, actor, 'guess', []);
      return 'ok';
    }
    if (state.phase === 'day-end') {
      if (state.day === state.setup.days) enter(state, 'loop-end');
      else {
        state.day++;
        for (const k of Object.keys(state.flags).filter(
          (k) => k.startsWith('passed:') || k.startsWith('follow:'),
        ))
          delete state.flags[k];
        enter(state, 'day-start');
      }
      continue;
    }
    if (state.phase === 'incident' && state.flags['hound-due']) {
      delete state.flags['hound-due'];
      enqueueFlow(state, 'hound-death', [{ effects: [{ op: 'protagonist-death' }] }]);
      continue;
    }
    if (state.phase === 'incident' && state.flags['end-after-incident']) {
      state.endRequested = true;
      continue;
    }
    const next = nextPhase[state.phase];
    if (!next) {
      state.diagnostic = `No transition from ${state.phase}`;
      return 'paused';
    }
    enter(state, next);
  }
  return state.pending || state.winner ? 'ok' : 'paused';
}
function applyChoice(pack: RulePack, state: EngineState, choice: Choice): boolean {
  const pending = state.pending!;
  if (pending.kind === 'cards') {
    if (choice.kind !== 'cards' || choice.placements.length !== cardCount(state, pending.actor))
      return false;
    const targets = legalCardTargets(state, pending.actor);
    if (
      new Set(choice.placements.map((p) => p.target)).size !== choice.placements.length ||
      new Set(choice.placements.map((p) => p.card)).size !== choice.placements.length
    )
      return false;
    if (
      choice.placements.some(
        (p) =>
          !targets.includes(p.target) ||
          !state.cards.some(
            (c) => c.id === p.card && c.owner === pending.actor && c.status === 'hand',
          ),
      )
    )
      return false;
    for (const p of choice.placements) state.cards.find((c) => c.id === p.card)!.status = 'set';
    const ordered = clone(choice.placements).sort((a, b) => a.target.localeCompare(b.target));
    state.placements.push(...ordered);
    announce(state, 'cards', {
      placements: ordered.map((p) => ({ owner: pending.actor, target: p.target })),
    });
    announce(
      state,
      'cards',
      {
        placements: choice.placements.map((p) => ({
          ...p,
          kind: state.cards.find((c) => c.id === p.card)!.kind,
        })),
      },
      pending.actor === 'mastermind' ? 'mastermind' : 'protagonists',
    );
    return true;
  }
  if (pending.kind === 'guess') {
    if (state.flags['c-guess']) {
      if (
        choice.kind !== 'guess-culprits' ||
        Object.keys(choice.answers).length !== state.setup.incidents.length ||
        state.setup.incidents.some((i) => !state.characters[choice.answers[String(i.day)] ?? ''])
      )
        return false;
      const correct = state.setup.incidents.every(
        (i) => choice.answers[String(i.day)] === i.culprit,
      );
      announce(state, 'culprit', { guesses: choice.answers, correct });
      delete state.flags['c-guess'];
      state.ll!.cAnswered = true;
      if (correct) win(state, pending.actor as Protagonist);
      return true;
    }
    if (
      choice.kind !== 'guess' ||
      !pack.identities[choice.identity] ||
      !state.characters[choice.character]
    )
      return false;
    const guessed = JSON.parse(state.flags.guessed ?? '[]') as string[];
    if (
      guessed.includes(choice.character) ||
      state.characters[choice.character]!.status === 'absent'
    )
      return false;
    const config = state.setup.characters.find((c) => c.id === choice.character);
    const correct =
      acceptedIdentities(pack, state.characters[choice.character]!.initialIdentity).includes(
        choice.identity,
      ) && config?.reverseIdentity === choice.reverseIdentity;
    announce(state, 'identity', { character: choice.character, guess: choice.identity, correct });
    if (!correct) win(state, 'mastermind');
    else {
      guessed.push(choice.character);
      state.flags.guessed = JSON.stringify(guessed);
      if (
        Object.values(state.characters)
          .filter((c) => c.status !== 'absent')
          .every((c) => guessed.includes(c.id))
      )
        win(state, 'protagonists');
    }
    return true;
  }
  if (pending.kind === 'ability') {
    if (choice.kind === 'pass') {
      if (state.phase === 'card-resolution') state.flags['cultist-done'] = 'yes';
      else state.flags[`passed:${state.phase}`] = 'yes';
      return true;
    }
    if (choice.kind !== 'ability') return false;
    const candidate = abilities(pack, state, state.phase, false, pending.actor).find(
      (a) => a.owner === choice.owner && a.ability.id === choice.ability,
    );
    if (
      !candidate ||
      (candidate.ability.declarationArea &&
        candidate.ability.declarationArea !== state.flags['ability-area:' + candidate.owner])
    )
      return false;
    const frame = makeFrame(state, candidate.owner, candidate.ability, pending.actor);
    const supplied = { ...choice.choices };
    if (
      candidate.ability.declarationArea &&
      supplied.areaMode === candidate.ability.declarationArea
    )
      delete supplied.areaMode;
    for (const spec of frame.steps[0]?.choices ?? []) {
      const chosen = supplied[spec.key];
      if (chosen === undefined) continue;
      if (!options(pack, state, frame, spec).includes(chosen)) return false;
      frame.choices[spec.key] = chosen;
      delete supplied[spec.key];
    }
    if (Object.keys(supplied).length) return false;
    clearAbilityAreas(state);
    state.frames.push(frame);
    return true;
  }
  if (!pending.options.some((o) => canonical(o) === canonical(choice))) return false;
  if (choice.kind === 'start') {
    beginDiscussion(state);
    return true;
  }
  if (choice.kind === 'request-final-guess') {
    state.flags['final-guess-votes'] = '[]';
    return true;
  }
  if (choice.kind === 'vote-final-guess') {
    if (!choice.agree) delete state.flags['final-guess-votes'];
    else
      state.flags['final-guess-votes'] = JSON.stringify([
        ...(JSON.parse(state.flags['final-guess-votes'] ?? '[]') as string[]),
        pending.actor,
      ]);
    return true;
  }
  if (choice.kind === 'continue') {
    resetLoop(pack, state);
    enter(state, 'loop-start');
    return true;
  }
  if (choice.kind === 'refuse' && state.refusal) {
    if (choice.refuse) rejectAbility(pack, state, state.refusal);
    state.refusal.bound.refusalChecked = 'yes';
    state.refusal = null;
    return true;
  }
  if (choice.kind === 'select') {
    const binding = state.flags['pending-binding'] ?? '';
    if (binding.startsWith('flag:')) state.flags[binding.slice(5)] = choice.value;
    else {
      const [, id, key] = binding.split(':');
      const frame = state.batch?.frames.find((f) => f.id === id);
      if (!frame || !key) return false;
      frame.choices[key] = choice.value;
    }
    return true;
  }
  return false;
}
export function advance(
  pack: RulePack,
  input: EngineState,
  actor: Actor,
  command: Command,
  budget = 10000,
): AdvanceResult {
  if (!commandSchema.safeParse(command).success)
    return { status: 'rejected', state: input, reason: 'invalid-command' };
  if (input.ruleDigest !== pack.digest)
    return { status: 'rejected', state: input, reason: 'invalid-command' };
  const encoded = canonical({ actor, command });
  const receipt = input.receipts[command.id];
  if (receipt)
    return receipt.command === encoded
      ? { status: 'ok', state: input }
      : { status: 'rejected', state: input, reason: 'invalid-command' };
  if (command.expectedRevision !== input.revision)
    return { status: 'rejected', state: input, reason: 'stale-revision' };
  if (!input.pending || input.pending.actor !== actor)
    return { status: 'rejected', state: input, reason: 'not-your-decision' };
  if (
    command.decisionId !== input.pending.id ||
    !command.id ||
    ['__proto__', 'constructor', 'prototype'].includes(command.id)
  )
    return { status: 'rejected', state: input, reason: 'invalid-command' };
  const state = clone(input);
  // structuredClone preserves the shared reference between refusal and batch frame.
  if (!applyChoice(pack, state, command.choice))
    return { status: 'rejected', state: input, reason: 'invalid-command' };
  // The briefing ends before the gameplay observation log used for replay begins.
  if (actor !== 'mastermind' && command.choice.kind !== 'start')
    announce(state, 'own-choice', { actor, choice: command.choice }, 'protagonists');
  state.choices.push({ actor, decisionId: command.decisionId, choice: clone(command.choice) });
  state.pending = null;
  state.revision++;
  state.receipts[command.id] = { command: encoded, revision: state.revision };
  return { status: drive(pack, state, budget), state };
}
export function resume(pack: RulePack, input: EngineState, budget: number): AdvanceResult {
  if (input.ruleDigest !== pack.digest || !Number.isSafeInteger(budget) || budget < 0)
    return { status: 'rejected', state: input, reason: 'invalid-command' };
  const state = clone(input);
  return { status: drive(pack, state, budget), state };
}
export const snapshot = (state: EngineState): EngineState => clone(state);
export const fork = snapshot;
