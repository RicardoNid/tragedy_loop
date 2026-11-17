import { characterCounter } from './shared-lifecycle.js';
import type { Observation, PlayerView } from '../../../contracts/src/game.js';
import { BOARDS, type Ability, type RulePack, type Selector, type Step } from './model.js';
import { destination, goodwillCounter } from './expressions.js';
import {
  compileEffects as compile,
  directDeathEffect,
  matchesChange,
  type VisibleChange,
  type EffectSource,
} from './knowledge-effects.js';
import { distinctCounterPair } from './knowledge-pair.js';
import { publicCondition, publicNumber, type PublicContext } from './knowledge-conditions.js';

import { hasVirtualArea, traits } from './knowledge-traits.js';

// Closed FS/BTX trigger model. Additional identities/rules can alter thresholds or force/suppress incidents.
const ordinaryTriggerRoles = new Set([
  '关键人物',
  '杀手',
  '主谋',
  '邪教徒',
  '亲友',
  '暴徒',
  '杀人狂',
  '传谣人',
  '平民',
  '魔女',
  '时间旅者',
  '心上人',
  '求爱者',
  '不安定因子',
  '因果残片',
]);

/** Ordinary voluntary card effects require a public declaration. Delayed and
 * reactive consequences have their own timing and may outlive the declaration. */
export function requiresGoodwillDeclaration(s: EffectSource) {
  return (
    s.ability?.timing === 'protagonist-abilities' &&
    !s.ability.mandatory &&
    s.ability.threshold !== undefined &&
    !s.detached &&
    s.timing === 'protagonist-abilities'
  );
}
export interface GoodwillDeclaration {
  id: string;
  ability: string;
  choices: Record<string, string>;
}

/** Compiled from this game's machine rules. Entries with no matching public
 * effect keep their setup, trigger and quota constraints in the domain store. */
export class PruningCatalog {
  private identities = new Map<string, EffectSource[]>();
  private rules = new Map<string, EffectSource[]>();
  private cards = new Map<string, EffectSource[]>();
  private readonly ambientCards = new Map<string, EffectSource[]>();
  readonly modules = new Map<string, EffectSource[]>();
  readonly events = new Map<string, EffectSource[]>();
  private indirect = new Map<EffectSource, EffectSource[]>();
  private readonly effectIndex = new Map<
    string,
    {
      modules: Map<string, EffectSource[]>;
      identities: Map<string, EffectSource[]>;
      cards: Map<string, EffectSource[]>;
      rules: Map<string, EffectSource[]>;
      events: Map<string, EffectSource[]>;
    }
  >();
  readonly publicTriggerModel: boolean;
  readonly failureRoles: string[];
  readonly extraDeathReaction: boolean;
  readonly completionRoles: string[];
  readonly completionCards: Set<string>;
  readonly dayEndKills: { identity: string; ability: Ability; step: Step; selector: Selector }[] =
    [];
  readonly otherDayEndObligations: number;
  readonly scheduledDayEnd: boolean;
  readonly pairPrograms = new Map<string, NonNullable<ReturnType<typeof distinctCounterPair>>>();
  constructor(
    private readonly pack: RulePack,
    opening: Pick<PlayerView, 'incidents'>,
    roster: { id: string; character: string }[],
  ) {
    this.publicTriggerModel = Object.keys(pack.identities).every((i) =>
      ordinaryTriggerRoles.has(i),
    );
    const definitions = [
      ...Object.values(pack.identities),
      ...Object.values(pack.plots),
      ...roster.map((c) => pack.characters[c.character]!).filter(Boolean),
    ];
    const outstanding = new Set(
      definitions.flatMap((d) => d.abilities.filter((a) => a.mandatory && a.timing === 'day-end')),
    );
    for (const [identity, definition] of Object.entries(pack.identities)) {
      for (const a of definition.abilities) {
        if (
          !a.mandatory ||
          a.timing !== 'day-end' ||
          a.loopLimit !== undefined ||
          a.steps.length !== 1
        )
          continue;
        const step = a.steps[0]!,
          e = step.effects[0];
        if (
          step.choices?.length ||
          step.effects.length !== 1 ||
          e?.op !== 'each' ||
          e.selector.kind !== 'alive' ||
          e.effects.length !== 1 ||
          e.effects[0]?.op !== 'kill' ||
          e.effects[0].target !== '$it'
        )
          continue;
        this.dayEndKills.push({ identity, ability: a, step, selector: e.selector });
        outstanding.delete(a);
      }
    }
    this.otherDayEndObligations = outstanding.size;
    const scheduled = (e: import('./model.js').Effect): boolean =>
      'effects' in e &&
      ((e.op === 'schedule' && e.timing === 'day-end') || e.effects.some(scheduled));
    const incidentSteps = new Map<string, Step[]>();
    for (const [name, incident] of Object.entries(pack.incidents))
      incidentSteps.set(name, [...incident.steps, ...(incident.afterIncidentSteps ?? [])]);
    this.scheduledDayEnd = [
      ...definitions.flatMap((d) => d.abilities.flatMap((a) => a.steps)),
      ...[...incidentSteps.values()].flat(),
    ].some((s) => s.effects.some(scheduled));
    this.failureRoles = Object.values(pack.identities)
      .filter((identity) =>
        identity.abilities.some(
          (a) =>
            a.timing === 'death' &&
            a.mandatory &&
            a.condition === undefined &&
            a.threshold === undefined &&
            a.loopLimit === undefined &&
            a.steps.length === 1 &&
            !a.steps[0]!.choices?.length &&
            a.steps[0]!.condition === undefined &&
            a.steps[0]!.effects.length === 1 &&
            a.steps[0]!.effects[0]!.op === 'fail',
        ),
      )
      .map((i) => i.name);
    const deathReactions = [
      ...Object.values(pack.identities),
      ...roster.map((c) => pack.characters[c.character]!),
    ]
      .filter(Boolean)
      .flatMap((d) => d.abilities)
      .filter((a) => a.timing === 'death');
    this.extraDeathReaction = deathReactions.some((a) =>
      a.steps.some((s) => s.effects.some((e) => e.op !== 'fail')),
    );
    const completion = (a: Ability) => a.mandatory && a.timing === 'incident-completed';
    this.completionRoles = Object.values(pack.identities)
      .filter((d) => d.abilities.some(completion))
      .map((d) => d.name);
    this.completionCards = new Set(
      roster
        .filter((c) => pack.characters[c.character]?.abilities.some(completion))
        .map((c) => c.id),
    );
    const puppet = !!pack.plots['傀儡之线'] || Object.values(pack.identities).some((i) => i.puppet);
    const abilities = (list: Ability[]) => list.flatMap((a) => compile(a.steps, a.timing, a));
    for (const { owner, ability } of pack.moduleAbilities)
      this.modules.set(owner, [...(this.modules.get(owner) ?? []), ...abilities([ability])]);
    for (const [name, d] of Object.entries(pack.identities))
      this.identities.set(name, abilities(d.abilities));
    for (const [name, d] of Object.entries(pack.plots))
      this.rules.set(name, abilities(d.abilities));
    for (const c of roster) {
      const list = pack.characters[c.character]?.abilities ?? [];
      const sources = abilities(list);
      // Engine can let the mastermind use these goodwill abilities; higher-being has a special threshold.
      const alternate = pack.characters[c.character]?.mastermindGoodwill;
      if (puppet || alternate)
        for (const a of list.filter(
          (a) =>
            a.timing === 'protagonist-abilities' &&
            (puppet || !alternate?.ability || alternate.ability === a.id),
        ))
          sources.push(
            ...compile(
              a.steps,
              'mastermind-abilities',
              alternate?.overrideThreshold !== undefined
                ? { ...a, threshold: alternate.overrideThreshold }
                : a,
            ),
          );
      if (pack.characters[c.character]?.mandatoryFirstMastermindAbility && list[0])
        sources.push(
          ...compile(list[0].steps, 'mastermind-abilities', { ...list[0], mandatory: true }),
        );
      this.cards.set(c.id, sources);
    }
    for (const [name, steps] of incidentSteps) {
      this.events.set(name, compile(steps, 'incident'));
      const pair = distinctCounterPair(steps);
      if (pair) this.pairPrograms.set(name, pair);
    }
    const indirectOutputs = (source: EffectSource, seen: Set<string>): EffectSource[] => {
      const e = source.invocation;
      if (!e) return [source];
      const key = JSON.stringify(e);
      if (seen.has(key)) return [source];
      const next = new Set([...seen, key]);
      const at = source.invocationTiming ?? '*';
      const lists =
        e.op === 'invoke-goodwill'
          ? roster.flatMap((c) =>
              (pack.characters[c.character]?.abilities ?? [])
                .filter((a) => a.threshold !== undefined)
                .map((a) => a.steps),
            )
          : (e.name.startsWith('$')
              ? e.name === '$incident' && source.ability?.id === 'ai'
                ? opening.incidents.map((i) => i.name)
                : Object.keys(pack.incidents)
              : [e.name]
            ).flatMap((n) => (incidentSteps.has(n) ? [incidentSteps.get(n)!] : []));
      if (!lists.length) return [source];
      return lists.flatMap((steps) =>
        compile(steps, at).flatMap((child) => indirectOutputs(child, next)),
      );
    };
    for (const table of [this.rules, this.cards, this.events, this.identities, this.modules])
      for (const sources of table.values())
        for (const source of sources)
          if (source.invocation) this.indirect.set(source, indirectOutputs(source, new Set()));
    for (const [owner, sources] of this.cards) {
      const ambient = sources.filter((s) => !this.requiresDeclaration(s));
      if (ambient.length) this.ambientCards.set(owner, ambient);
    }
  }
  private requiresDeclaration(s: EffectSource) {
    if (requiresGoodwillDeclaration(s)) return true;
    // An invocation can schedule a later effect. Keep a possible past invocation
    // when its children are delayed or cannot be completely resolved.
    return (
      !!s.invocation &&
      s.invocationTiming === 'protagonist-abilities' &&
      s.ability?.timing === 'protagonist-abilities' &&
      !s.ability.mandatory &&
      s.ability.threshold !== undefined &&
      !!this.indirect.get(s)?.every((child) => !child.delay && !child.invocation)
    );
  }
  permitsOccurrence(
    name: string,
    c: PlayerView['characters'][number] | undefined,
    occurred: boolean,
  ) {
    const definition = this.pack.incidents[name];
    const character = c?.character;
    if (
      !definition ||
      definition.crowdThreshold !== undefined ||
      traits(this.pack, character).privateTrigger
    )
      return true;
    if (!c) return true; // Missing public state is not proof of absence.
    if (c.status !== 'alive') return occurred === false;
    // A hidden successful goodwill activation may suppress the henchman's incident.
    if (traits(this.pack, character).maySuppress && !occurred) return true;
    const counter = definition.thresholdCounter ?? 'paranoia';
    const amount =
      traits(this.pack, character).totalThreshold && !definition.thresholdCounter
        ? Object.values(c.counters).reduce((a, b) => a + b, 0)
        : characterCounter(c.counters, counter);
    const threshold =
      this.pack.characters[c.character]!.paranoia +
      (definition.thresholdOffset ?? 0) * (traits(this.pack, character).thresholdMultiplier ?? 1);
    return amount >= threshold === occurred;
  }
  outputsFor(source: EffectSource): readonly EffectSource[] | undefined {
    return this.indirect.get(source);
  }
  sourcesFor(
    group: 'characters' | 'identities' | 'plots' | 'incidents' | 'modules',
    id: string,
  ): readonly EffectSource[] {
    const table = {
      modules: this.modules,
      characters: this.cards,
      identities: this.identities,
      plots: this.rules,
      incidents: this.events,
    }[group];
    return table.get(id) ?? [];
  }
  forChange(
    phase: Observation['phase'],
    change: VisibleChange,
    declaration?: GoodwillDeclaration | null,
  ) {
    const fixed = declaration !== undefined && phase === 'protagonist-abilities';
    const key = [phase, change.kind, change.counter, change.sign, fixed].join('/');
    let result = this.effectIndex.get(key);
    if (!result) {
      const select = (table: Map<string, EffectSource[]>) => {
        const result = new Map<string, EffectSource[]>();
        for (const [name, list] of table) {
          const sources = list.filter(
            (s) =>
              (s.timing === phase || s.timing === '*') &&
              matchesChange(s, change) &&
              (this.indirect
                .get(s)
                ?.some(
                  (out) =>
                    (out.timing === phase || out.timing === '*' || out.invocation) &&
                    matchesChange(out, change),
                ) ??
                true),
          );
          if (sources.length) result.set(name, sources);
        }
        return result;
      };
      result = {
        modules: select(this.modules),
        identities: select(this.identities),
        cards: select(fixed ? this.ambientCards : this.cards),
        rules: select(this.rules),
        events: select(this.events),
      };
      this.effectIndex.set(key, result);
    }
    if (fixed && declaration) {
      const { id, ability, choices } = declaration;
      const selected = (this.cards.get(id) ?? []).filter((s) => {
        if (!this.requiresDeclaration(s) || s.ability?.id !== ability || !matchesChange(s, change))
          return false;
        if (s.invocation)
          return (
            this.indirect
              .get(s)
              ?.some(
                (child) =>
                  (child.timing === phase || child.timing === '*' || child.invocation) &&
                  matchesChange(child, change),
              ) ?? true
          );
        // Only bind a named direct target of the declared first step. Later steps
        // can ask for fresh choices, including the same choice key.
        const target = s.entryStep && s.selection && choices[s.selection.key];
        if (target && target !== change.target) return false;
        const counter = s.entryStep && s.counterSelection && choices[s.counterSelection];
        return !counter || counter === change.counter;
      });
      if (selected.length) {
        const cards = new Map(result.cards);
        cards.set(id, [...(cards.get(id) ?? []), ...selected]);
        return { ...result, cards };
      }
    }
    return result;
  }
}
type Roster = ReadonlyArray<{ id: string; character: string }>;

/** Reuse a public area bucket across all identities in this observation. Unknown
 * positions and virtual positions stay eligible. Targets on fixed boards do not
 * restrict the owner unless the program explicitly relates them. */
export function indexOwners(
  roster: Roster,
  characters: PublicContext['characters'],
  change: VisibleChange,
  virtualIdentities: boolean,
  pack: RulePack,
) {
  const board = BOARDS.includes(change.target as (typeof BOARDS)[number]);
  const targetArea = board ? change.target : characters.get(change.target)?.area;
  let self: Roster | undefined, local: Roster | undefined;
  return (source: EffectSource): Roster => {
    if (source.ownerRange === 'self')
      return (self ??= roster.filter((c) => c.id === change.target));
    if (
      !source.safeSnapshot ||
      source.choices.has('areaMode') ||
      virtualIdentities ||
      !targetArea ||
      (source.ownerRange !== 'same-area' && source.ownerRange !== 'self-board')
    )
      return roster;
    return (local ??= roster.filter((c) => {
      const area = characters.get(c.id)?.area;
      return !area || area === targetArea || hasVirtualArea(pack, c.character);
    }));
  };
}
function reaches(source: EffectSource, change: VisibleChange, context: PublicContext) {
  if (!source.target || source.detached) return true;
  const id = change.target;
  const { owner } = context;
  const phase = context.clock.phase;
  const area =
    context.virtualArea ||
    source.choices.has('areaMode') ||
    (!source.safeSnapshot &&
      !(phase === 'incident' && source.target === '$self.area' && !source.ability))
      ? undefined
      : context.characters.get(owner ?? '')?.area;
  const board = BOARDS.includes(id as (typeof BOARDS)[number]);
  const to = source.destination;
  if (to && change.destination) {
    if (!to.startsWith('$') && to !== change.destination) return false;
    const options = source.choices.get(to.slice(1));
    if (
      Array.isArray(options) &&
      !options.some((v) => v.startsWith('$') || v === change.destination)
    )
      return false;
    if (
      area &&
      Array.isArray(options) &&
      options.length === 1 &&
      options[0] === '$adjacent-self' &&
      !['horizontal', 'vertical'].some((dir) => destination(area, [dir]) === change.destination)
    )
      return false;
  }
  const target = source.target;
  if (!target.startsWith('$')) return target === id;
  if (target === '$self') return owner === undefined || owner === id;
  if (target.endsWith('.area')) return board && (target !== '$self.area' || !area || area === id);
  const options = source.choices.get(target.slice(1));
  if (!options) return true;
  if (Array.isArray(options)) return options.some((v) => v.startsWith('$') || v === id);
  if (board && !['boards', 'alive-or-boards'].includes(options.kind)) return false;
  if (!board && options.kind === 'boards') return false;
  const targetArea = board ? id : context.characters.get(id)?.area;
  return source.ownerRange !== 'same-area' || !area || !targetArea || area === targetArea;
}

export const gateLabels = {
  reach: '目标种类、固定目标、区域或移动目的地与观察相容',
  death: '直接死亡反应在已知的同阶段死亡窗口内有发动者死亡记录',
  amount: '在可用的单效果快照中，加减并截断后的值等于报告值',
  entry: '强制日末／轮末首步读取阶段入口快照（若有）',
  condition: '能力与步骤的公开条件没有被证伪',
  alive: '需要存活的发动者在可用快照中没有确定死亡或离场',
  goodwill: '已知有效友好达到能力门槛',
  selector: '把观察目标绑定到选择器后，公开选择条件没有被证伪',
  calendar: '至少存在一个与事件日期、发生记录及到期日相容的安排时点',
} as const;
type Gate = keyof typeof gateLabels;
interface EvidenceWindow {
  phase?: string;
  deaths: ReadonlySet<string>;
  endEntry?: Pick<PublicContext, 'characters' | 'boards'>;
  occurrence: ReadonlyMap<string, boolean>;
}
const plans = new WeakMap<EffectSource, readonly Gate[]>();
/** Compile once per immutable catalog source. Only these gates run for that source. */
export function necessaryConditions(s: EffectSource): readonly Gate[] {
  const cached = plans.get(s);
  if (cached) return cached;
  const plan: Gate[] = [];
  if (s.target && !s.detached) plan.push('reach');
  if (directDeathEffect(s)) plan.push('death');
  if (s.amount !== undefined && s.safeSnapshot && !s.detached && s.ability) plan.push('amount');
  if (
    s.entryStep &&
    !s.detached &&
    s.ability?.mandatory &&
    (s.timing === 'day-end' || s.timing === 'loop-end')
  )
    plan.push('entry');
  if (s.conditions.length) plan.push('condition');
  if (!s.detached) {
    if (s.ability && !['loop-end', 'incident-completed', 'death'].includes(s.ability.timing))
      plan.push('alive');
    if (s.ability?.threshold !== undefined) plan.push('goodwill');
    const selector = s.choices.get((s.target ?? '').slice(1));
    if (selector && !Array.isArray(selector) && selector.where !== undefined) plan.push('selector');
  }
  if (s.delay?.day !== undefined) plan.push('calendar');
  plans.set(s, Object.freeze(plan));
  return plan;
}
/** Undefined means admissible as a local explanation, never a complete witness. */
export function rejectedCondition(
  source: EffectSource,
  change: VisibleChange,
  context: PublicContext,
  window: EvidenceWindow,
  eventDay?: number,
): Gate | undefined {
  for (const gate of necessaryConditions(source)) {
    switch (gate) {
      case 'reach':
        if (!reaches(source, change, context)) return gate;
        break;
      case 'death':
        if (
          window.phase === context.clock.phase &&
          context.owner &&
          !window.deaths.has(context.owner)
        )
          return gate;
        break;
      case 'amount': {
        if (
          change.before === undefined ||
          change.after === undefined ||
          !['mastermind-abilities', 'protagonist-abilities'].includes(context.clock.phase)
        )
          break;
        const cap = BOARDS.includes(change.target as (typeof BOARDS)[number]) ? 3 : Infinity;
        if (Math.min(cap, Math.max(0, change.before + source.amount!)) !== change.after)
          return gate;
        break;
      }
      case 'entry':
        if (window.endEntry) context = { ...context, ...window.endEntry, staticOnly: false };
        break;
      case 'condition':
        if (source.conditions.some((c) => publicCondition(c, context) === false)) return gate;
        break;
      case 'alive': {
        const actor = context.characters.get(context.owner ?? '');
        if (!context.staticOnly && actor && actor.status !== 'alive' &&
            !(actor.status === 'dead' && context.clock.phase === 'mastermind-abilities' && context.pack.identities['鬼魂'])) return gate;
        break;
      }
      case 'goodwill': {
        if (context.declaredGoodwill) break;
        if (context.pack.module === 'AHR' && context.ex === undefined) break;
        const meter = goodwillCounter(context.pack.module, context.ex ?? 0,
          context.clock.phase === 'mastermind-abilities' ? 'mastermind' : 'protagonist',source.ability!.id);
        const n = publicNumber({ counter: meter, target: '$self' }, context);
        if (n !== undefined && n < source.ability!.threshold!) return gate;
        break;
      }
      case 'selector': {
        const selector = source.choices.get((source.target ?? '').slice(1)) as Selector;
        if (
          publicCondition(selector.where, {
            ...context,
            bindings: { ...context.bindings, it: change.target },
          }) === false
        )
          return gate;
        break;
      }
      case 'calendar':
        if (!calendarAllows(source, context, window, eventDay)) return gate;
        break;
    }
  }
}
export function eligibleSource(
  source: EffectSource,
  change: VisibleChange,
  context: PublicContext,
  window: EvidenceWindow,
  eventDay?: number,
) {
  return rejectedCondition(source, change, context, window, eventDay) === undefined;
}
function calendarAllows(
  source: EffectSource,
  context: PublicContext,
  window: EvidenceWindow,
  eventDay?: number,
) {
  const o = context.clock;
  if (source.delay?.day === undefined) return true;
  const phases = [
    'discussion',
    'loop-start',
    'day-start',
    'mastermind-cards',
    'protagonist-cards',
    'card-resolution',
    'mastermind-abilities',
    'protagonist-abilities',
    'incident',
    'captain-change',
    'day-end',
    'loop-end',
  ];
  // Existential calendar check. Unknown scheduling dates are retained, never guessed.
  for (let loop = 1; loop <= o.loop; loop++)
    for (let day = 1; day <= context.days; day++) {
      if (
        eventDay !== undefined &&
        (day !== eventDay || window.occurrence.get(loop + ':' + day) === false)
      )
        continue;
      if (
        loop === o.loop &&
        (day > o.day ||
          (day === o.day &&
            source.delay.origin !== '*' &&
            phases.indexOf(source.delay.origin) > phases.indexOf(o.phase)))
      )
        continue;
      const origin = { ...context, staticOnly: true, clock: { ...o, loop, day } };
      if (source.delay.conditions.some((c) => publicCondition(c, origin) === false)) continue;
      const dueDay = publicNumber(source.delay.day, origin);
      const dueLoop =
        source.delay.loop === undefined ? loop : publicNumber(source.delay.loop, origin);
      if (
        (dueDay === undefined || dueDay === o.day) &&
        (dueLoop === undefined || dueLoop === o.loop)
      )
        return true;
    }
  return false;
}
