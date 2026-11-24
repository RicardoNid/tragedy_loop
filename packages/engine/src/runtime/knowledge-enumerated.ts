import { lifecycle } from './shared-lifecycle.js';
import type { Choice, GameSetup, PlayerView } from '../../../contracts/src/game.js';
import type { KnowledgeView } from '../../../contracts/src/knowledge.js';
import { initializeDiscussion, advance } from './engine.js';
import { BOARDS, canonical, type EngineState, type RulePack } from './model.js';
import { enumerateChoices } from './replay.js';
import { normalizeHistory } from './observation-history.js';
import { hasUnsupportedDiagnostic, validateSetup } from './setup.js';
import { incompleteContent, publicRoster } from './knowledge-domain.js';
import { matchesOpeningRoster, matchesPlayerObservation } from './knowledge-history.js';

// Infinite numeric domains need a symbolic representation; never substitute the real secret.
function unsupportedDomain(pack: RulePack, opening: PlayerView): string[] {
  const reasons: string[] = [];
  if ([...opening.characters, ...(opening.roster ?? [])].some((c) => c.character === '仙人'))
    reasons.push('仙人的非负整数 X 尚无有限公开上界，需要符号域支持。');
  if (Object.values(pack.plots).some((p) => !p.supported)) reasons.push('存在尚未支持的规则。');
  return reasons.concat(incompleteContent(pack, opening));
}

/** Enumerates construction variables from rules and the complete public opening roster.
 * No catalogue, true identities, private roles, or actual secret choices are inputs.
 * null yields allow cancellation even when many assignments fail the shared validator.
 */
export function* generateDomain(pack: RulePack, opening: PlayerView): Generator<GameSetup | null> {
  const roster = publicRoster(pack, opening);
  const absent = roster.flatMap((c, i) =>
    opening.characters.some((v) => v.id === c.id) ? [] : [i],
  );
  const ys = Object.values(pack.plots).filter((p) => p.type === 'Y');
  const xs = Object.values(pack.plots).filter((p) => p.type === 'X');
  const xSets =
    pack.setupRules.xSlots === 1
      ? xs.map((x) => [x])
      : xs.flatMap((x, i) => xs.slice(i + 1).flatMap((z) =>
          pack.module === 'WM' ? [[x, z], [z, x]] : [[x, z]],
        ));
  for (const y of ys)
    for (const xSet of xSets) {
      const basePool: Record<string, number> = {};
      const pairs: [string, string][] = [];
      for (const p of [y, ...xSet]) {
        for (const [identity, count] of Object.entries(p.identities))
          basePool[identity] = Math.min(
            (basePool[identity] ?? 0) + count,
            pack.identities[identity]?.max ?? Infinity,
          );
        if (p.pair) pairs.push(p.pair);
      }
      const additions: GameSetup['secretAddition'][] = xSet.some((p) => p.name === '捏造的秘密')
        ? [undefined, '杀手', '主谋', '因果残片']
        : [undefined];
      for (const secretAddition of additions) {
        if (secretAddition && basePool[secretAddition]) continue;
        const pool = { ...basePool, ...(secretAddition ? { [secretAddition]: 1 } : {}) };
        const characters: GameSetup['characters'] = roster.map((c) => ({
          id: c.id,
          character: c.character,
          initialArea: c.area,
          identity: '平民',
        }));
        function* assign(
          index: number,
          remainingPairs: [string, string][],
        ): Generator<GameSetup | null> {
          const slots = characters
            .slice(index)
            .filter((c) => !['局外人', '模仿犯'].includes(c.character)).length;
          const required =
            Object.entries(pool)
              .filter(([k]) => !['平民', pack.setupRules.optionalQuota].includes(k))
              .reduce((n, [, count]) => n + count, 0) + remainingPairs.length;
          if (required > slots) {
            yield null;
            return;
          }
          if (index < characters.length) {
            const c = characters[index]!;
            if (c.character === '模仿犯') {
              yield* assign(index + 1, remainingPairs);
              return;
            }
            const identities =
              c.character === '局外人'
                ? Object.keys(pack.identities).filter(
                    (k) =>
                      k !== '平民' && !pool[k] && !basePool[k] && !pairs.some((p) => p.includes(k)),
                  )
                : ['平民', ...Object.keys(pool).filter((k) => k !== '平民' && pool[k]! > 0)];
            for (const identity of identities) {
              c.identity = identity;
              delete c.reverseIdentity;
              const counted = c.character !== '局外人' && identity !== '平民';
              if (counted) pool[identity]!--;
              yield* assign(index + 1, remainingPairs);
              if (counted) pool[identity]!++;
            }
            if (c.character !== '局外人')
              for (let i = 0; i < remainingPairs.length; i++) {
                [c.identity, c.reverseIdentity] = remainingPairs[i]!;
                yield* assign(
                  index + 1,
                  remainingPairs.filter((_, j) => i !== j),
                );
              }
            delete c.reverseIdentity;
            return;
          }
          if (
            remainingPairs.length ||
            Object.entries(pool).some(([k, n]) => k !== '平民' && k !== pack.setupRules.optionalQuota && n !== 0)
          ) {
            yield null;
            return;
          }
          const setup: GameSetup = {
            module: opening.module,
            anniversary: opening.anniversary,
            loops: opening.loops,
            days: opening.days,
            captain: opening.captain,
            discussion: 'allowed',
            y: y.name,
            x: xSet.map((p) => p.name),
            characters: structuredClone(characters),
            incidents: [],
            secretAddition,
          };
          function* parameters(i: number): Generator<GameSetup | null> {
            if (i < setup.characters.length) {
              const c = setup.characters[i]!;
              function* next(): Generator<GameSetup | null> {
                if (pack.characters[c.character]?.abilityArea?.publicMarker === 'territory') {
                  for (const territory of opening.territory ? [opening.territory] : BOARDS) {
                    c.territory = territory;
                    yield* parameters(i + 1);
                  }
                } else yield* parameters(i + 1);
              }
              if (c.character === '模仿犯') {
                for (const target of setup.characters.filter((t) => t.id !== c.id)) {
                  c.identity = target.identity;
                  c.reverseIdentity = target.reverseIdentity;
                  c.copiedFrom = target.id;
                  yield* next();
                }
              } else if (c.character === '转校生') {
                for (let day = 1; day <= setup.days; day++) {
                  c.enterDay = day;
                  yield* next();
                }
              } else if (c.character === '神灵') {
                for (let loop = 1; loop <= setup.loops; loop++) {
                  c.enterLoop = loop;
                  yield* next();
                }
              } else yield* next();
              return;
            }
            yield* initialAreas(0);
          }
          function* initialAreas(i: number): Generator<GameSetup | null> {
            if (i === absent.length) {
              yield* incidents(0);
              return;
            }
            const c = setup.characters[absent[i]!]!;
            for (const area of pack.characters[c.character]!.initial) {
              c.initialArea = area;
              yield* initialAreas(i + 1);
            }
          }
          function* incidents(i: number): Generator<GameSetup | null> {
            if (i < opening.incidents.length) {
              const event = opening.incidents[i]!;
              const names = [
                event.name,
                ...(pack.incidents[lifecycle.incident.disguised] && event.name !== lifecycle.incident.disguised ? [lifecycle.incident.disguised] : []),
              ];
              for (const name of names)
                for (const culprit of pack.incidents[name]?.crowdThreshold !== undefined
                  ? BOARDS
                  : characters.map((c) => c.id)) {
                  setup.incidents[i] = { day: event.day, name, publicName: event.name, culprit };
                  yield* incidents(i + 1);
                }
              return;
            }
            const fragments =
              opening.anniversary
                ? setup.characters.filter((c) => c.identity === '平民').map((c) => c.id)
                : [undefined];
            const alternateYs = setup.x.includes('疯狂的真相')
              ? ys.filter((p) => p.name !== setup.y).map((p) => p.name)
              : [undefined];
            const roles: GameSetup['privateRoles'][] =
              pack.module === 'LL'
                ? (['A', 'B', 'C'] as const).flatMap((p0) =>
                    (['A', 'B', 'C'] as const)
                      .filter((p1) => p1 !== p0)
                      .map((p1) => ({
                        p0,
                        p1,
                        p2: (['A', 'B', 'C'] as const).find((r) => r !== p0 && r !== p1)!,
                      })),
                  )
                : [undefined];
            for (const fragment of fragments)
              for (const alternateY of alternateYs)
                for (const privateRoles of roles) {
                  setup.anniversaryFragment = fragment;
                  setup.alternateY = alternateY;
                  setup.privateRoles = privateRoles;
                  const matchesOpening = setup.characters.every(
                    (c) =>
                      roster.find((p) => p.id === c.id)?.status ===
                      (c.enterDay || (c.enterLoop ?? 1) > 1 ? 'absent' : 'alive'),
                  );
                  yield !matchesOpening || validateSetup(pack, setup).length
                    ? null
                    : structuredClone(setup);
                }
          }
          yield* parameters(0);
        }
        yield* assign(0, pairs);
      }
    }
}

interface Node {
  state: EngineState;
  choices?: Generator<Choice>;
  normalized?: string[];
}
interface Candidate {
  setup: GameSetup;
  active: Node[];
  frontier: Node[];
  uncertain: boolean;
  root: boolean;
}

/** Exact product decomposition only where culprit legality is independent of identities.
 * Ordinary, distinct-per-day incidents use an injection from days to the public roster.
 * Required/forbidden culprits, serial/crowd/forged incidents and plot requirements opt out.
 */
function initialDomain(pack: RulePack, opening: PlayerView) {
  const names = opening.incidents.map((i) => i.name);
  const restricted = ['强迫症', '愚者', '双胞胎', '祭品', '怪杰', '侦探'];
  const independent =
    ['FS', 'BTX'].includes(pack.module) &&
    names.length > 0 &&
    !restricted.some((name) => pack.identities[name]) &&
    !pack.plots['灭亡讴歌'] &&
    !pack.incidents[lifecycle.incident.disguised] &&
    names.every(
      (name) =>
        pack.incidents[name]?.supported &&
        pack.incidents[name]?.crowdThreshold === undefined &&
        name !== lifecycle.incident.repeatCulprit,
    );
  const n = publicRoster(pack, opening).length;
  const weight = independent ? names.reduce((value, _, i) => value * Math.max(0, n - i), 1) : 1;
  if (!independent || !Number.isSafeInteger(weight))
    return { domain: generateDomain(pack, opening), weight: 1, factored: false };
  return {
    domain:
      weight === 0
        ? (function* (): Generator<GameSetup | null> {})()
        : generateDomain(pack, { ...opening, incidents: [] }),
    weight,
    factored: true,
  };
}

/** Resumable exhaustive tree search. Every unvisited branch and every compatible frontier is retained.
 * Script projections are exact only after full domain generation and no undecided scripts.
 * Current hidden-state projections deliberately have no completion claim here.
 */
export class EnumeratedKnowledge {
  private domain: Generator<GameSetup | null>;
  private candidates: Candidate[] = [];
  private expected: string[] = [];
  private observations: PlayerView['observations'] = [];
  private complete = false;
  private cursor = 0;
  private revision = -1;
  private expansions = 0;
  private epochExpansions = 0;
  private generationStopped = false;
  private generationAttempts = 0;
  private initialOnly = true;
  private discarded = 0;
  private initialCount = 0;
  private initialCached = true;
  private initialWeight = 1;
  private streamed = false;
  private streamedPossible = 0;
  private streamedIdentities: Record<string, string[]> = {};
  private streamedRules = new Set<string>();
  private streamedCulprits: Record<string, string[]> = {};
  private initialIdentities: Record<string, string[]> = {};
  private initialRules = new Set<string>();
  private initialCulprits: Record<string, string[]> = {};
  private limited = false;
  private deductions: NonNullable<KnowledgeView['deductions']> = [];
  private started = performance.now();
  readonly reasons: string[];
  constructor(
    private pack: RulePack,
    readonly opening: PlayerView,
    private readonly cacheLimit = 5000,
    private readonly materializeForComparison = false,
  ) {
    if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 0)
      throw new Error('Invalid knowledge cache limit.');
    this.reasons = unsupportedDomain(pack, opening);
    const initial = materializeForComparison
      ? { domain: generateDomain(pack, opening), weight: 1, factored: false }
      : initialDomain(pack, opening);
    this.domain = initial.domain;
    this.initialWeight = initial.weight;
    if (initial.factored) this.initialCached = false;
  }
  update(history: PlayerView['observations'], revision: number) {
    const next = normalizeHistory(history);
    if (this.expected.some((o, i) => next[i] !== o))
      throw new Error('观察必须追加，不能改写已有历史。');
    const openingHistory = normalizeHistory(this.opening.observations);
    if (
      this.initialOnly &&
      (next.length > openingHistory.length || next.some((o, i) => o !== openingHistory[i]))
    ) {
      this.initialOnly = false;
      if (!this.initialCached) {
        this.domain = generateDomain(this.pack, this.opening);
        this.complete = false;
        this.generationStopped = false;
        this.generationAttempts = 0;
      }
    }
    if (
      next.length !== this.expected.length &&
      !this.initialOnly &&
      (!this.initialCached || this.streamed)
    ) {
      this.streamed = true;
      this.candidates = [];
      this.discarded = 0;
      this.streamedPossible = 0;
      this.streamedIdentities = {};
      this.streamedRules.clear();
      this.streamedCulprits = {};
      this.domain = generateDomain(this.pack, this.opening);
      this.complete = false;
      this.generationStopped = false;
      this.generationAttempts = 0;
      this.deductions = [];
    }
    if (next.length !== this.expected.length) {
      for (const c of this.candidates) {
        c.active.push(...c.frontier);
        c.frontier = [];
      }
      this.epochExpansions = this.expansions;
      this.limited = false;
    }
    this.expected = next;
    this.observations = structuredClone(history.slice(0, next.length));
    this.revision = revision;
    this.propagate();
  }
  private propagate(candidates = this.candidates) {
    if (this.materializeForComparison) return;
    // FS/BTX static disclosures, with BTX's civilian-to-serial-killer transformation retained.
    // Other transforming modules continue to rely exclusively on execution histories.
    if (!['FS', 'BTX'].includes(this.pack.module)) return;
    for (let i = 0; i < this.expected.length; i++) {
      const observation = JSON.parse(this.expected[i]!);
      const d = observation.data;
      let removed = 0;
      for (const candidate of candidates) {
        if (
          !candidate.root &&
          !candidate.active.length &&
          !candidate.frontier.length &&
          !candidate.uncertain
        )
          continue;
        const setup = candidate.setup;
        let contradicts = false;
        if (observation.type === 'identity' && typeof d.identity === 'string') {
          const c = setup.characters.find((c) => c.id === d.character);
          // Temporary worker has a separate changing/replacement identity lifecycle.
          if (c && c.character !== '临时工')
            contradicts =
              (setup.anniversaryFragment === c.id ? '因果残片' : c.identity) !== d.identity &&
              !(
                c.identity === lifecycle.transformation.initial &&
                setup.anniversaryFragment !== c.id &&
                setup.x.includes(lifecycle.transformation.plot) &&
                d.identity === lifecycle.transformation.effective
              );
        }
        if (observation.type === 'rule' && typeof d.rule === 'string')
          contradicts = ![setup.y, ...setup.x].includes(d.rule);
        if (observation.type === 'culprit' && typeof d.culprit === 'string')
          contradicts = setup.incidents.find((e) => e.day === d.day)?.culprit !== d.culprit;
        if (contradicts) {
          candidate.root = false;
          candidate.active = [];
          candidate.frontier = [];
          candidate.uncertain = false;
          removed++;
        }
      }
      if (removed) {
        const prior = this.deductions.find((d) => d.observation === i + 1);
        if (prior) prior.removed += removed;
        else
          this.deductions.push({
            observation: i + 1,
            removed,
            reason: `正式公开的${observation.type === 'identity' ? '身份' : observation.type === 'rule' ? '规则' : '当事人'}与联合配置冲突；其余变量随联合配置传播。`,
          });
      }
    }
  }
  tick(milliseconds = 20, maxExpansions = 20000) {
    if (this.reasons.length) return;
    const end = performance.now() + milliseconds;
    while (
      performance.now() < end &&
      this.expansions - this.epochExpansions < maxExpansions &&
      !this.limited
    ) {
      const finished = this.candidates.at(-1);
      if (this.streamed && finished?.frontier.length) {
        const setup = finished.setup;
        this.streamedPossible++;
        this.streamedRules.add(setup.y);
        setup.x.forEach((x) => this.streamedRules.add(x));
        for (const c of setup.characters) {
          const values = (this.streamedIdentities[c.id] ??= []);
          const value = setup.anniversaryFragment === c.id ? '因果残片' : c.identity;
          if (!values.includes(value)) values.push(value);
        }
        for (const i of setup.incidents) {
          const values = (this.streamedCulprits[String(i.day)] ??= []);
          if (!values.includes(i.culprit)) values.push(i.culprit);
        }
        this.candidates.pop();
      }
      const last = this.candidates.at(-1);
      if (
        !this.initialOnly &&
        !this.complete &&
        last &&
        !last.root &&
        !last.active.length &&
        !last.frontier.length &&
        !last.uncertain
      ) {
        this.candidates.pop();
        this.discarded++;
      }
      const tail = this.candidates.at(-1);
      if (
        !this.complete &&
        !this.generationStopped &&
        (this.initialOnly || !tail || tail.frontier.length || (!tail.root && !tail.active.length))
      ) {
        const next = this.domain.next();
        this.generationAttempts++;
        this.complete = !!next.done;
        if (next.value && this.initialOnly) {
          this.initialCount += this.initialWeight;
          if (this.initialCached && this.initialCount <= this.cacheLimit) {
            this.candidates.push({
              setup: next.value,
              active: [],
              root: true,
              frontier: [],
              uncertain: false,
            });
          } else if (this.initialCached) {
            this.candidates = [];
            this.initialCached = false;
          }
          const setup: GameSetup = next.value;
          this.initialRules.add(setup.y);
          setup.x.forEach((x) => this.initialRules.add(x));
          for (const c of setup.characters) {
            const values = (this.initialIdentities[c.id] ??= []);
            const value = setup.anniversaryFragment === c.id ? '因果残片' : c.identity;
            if (!values.includes(value)) values.push(value);
          }
          for (const i of setup.incidents) {
            const values = (this.initialCulprits[String(i.day)] ??= []);
            if (!values.includes(i.culprit)) values.push(i.culprit);
          }
          if (this.initialWeight !== 1 || !setup.incidents.length)
            for (const event of this.opening.incidents) {
              this.initialCulprits[String(event.day)] = publicRoster(this.pack, this.opening).map(
                (c) => c.id,
              );
            }
        } else if (next.value) {
          this.candidates.push({
            setup: next.value,
            active: [],
            root: true,
            frontier: [],
            uncertain: false,
          });
        }
        if (!this.initialOnly && !this.streamed && this.candidates.length > this.cacheLimit) {
          this.streamed = true;
          this.initialCached = false;
          this.candidates = [];
          this.discarded = 0;
          this.domain = generateDomain(this.pack, this.opening);
          this.complete = false;
          this.generationAttempts = 0;
          this.deductions = [];
          continue;
        }
        if (!this.initialOnly && this.candidates.length >= 100000) this.generationStopped = true;
        if (!this.initialOnly && next.value) this.propagate([this.candidates.at(-1)!]);
        if (!this.complete && !this.generationStopped && (this.initialOnly || !next.value))
          continue;
      }
      const candidate =
        !this.complete && !this.generationStopped
          ? this.candidates.at(-1)
          : this.candidates[this.cursor++ % this.candidates.length];
      if (!candidate) break;
      if (this.rootSatisfied(candidate)) break;
      if (candidate.frontier.length) {
        if (this.candidates.every((c) => c.frontier.length || (!c.root && !c.active.length))) break;
        continue;
      }
      if (candidate.root) {
        const initial = initializeDiscussion(this.pack, candidate.setup);
        candidate.root = false;
        candidate.uncertain = !initial.state;
        if (initial.state) candidate.active.push({ state: initial.state });
      }
      if (!candidate.active.length) {
        if (this.candidates.every((c) => c.frontier.length || (!c.root && !c.active.length))) break;
        continue;
      }
      const node = candidate.active[candidate.active.length - 1]!;
      const actual = (node.normalized ??= normalizeHistory(node.state.observations.protagonists));
      if (actual.slice(0, this.expected.length).some((_, i) => !matchesPlayerObservation(actual,this.expected,i,node.state.observations.protagonists[i]!))) {
        candidate.active.pop();
        continue;
      }
      if (actual.length >= this.expected.length) {
        candidate.frontier.push(candidate.active.pop()!);
        continue;
      }
      const pending = node.state.pending;
      if (!pending || node.state.winner) {
        if (!node.state.winner) candidate.uncertain = true;
        candidate.active.pop();
        continue;
      }
      if (!node.choices) {
        // Known protagonist choices include free-form guesses; secret mastermind actions are enumerated.
        const known = this.observations.slice(actual.length).find((o) => o.type === 'own-choice');
        node.choices =
          pending.actor !== 'mastermind' && known
            ? (function* () {
                if (known.data.actor === pending.actor) yield known.data.choice as Choice;
              })()
            : this.hiddenChoices(node.state, actual.length);
        if (pending.kind === 'guess' && !known) candidate.uncertain = true;
      }
      const next = node.choices.next();
      if (next.done) {
        candidate.active.pop();
        continue;
      }
      this.expansions++;
      const advanced = advance(this.pack, node.state, pending.actor, {
        id: `knowledge-${node.state.revision}`,
        expectedRevision: node.state.revision,
        decisionId: pending.id,
        choice: next.value,
      });
      if (advanced.status === 'rejected') continue;
      if (advanced.status === 'paused') candidate.uncertain = true;
      candidate.active.push({ state: advanced.state });
      if (
        this.expansions % 100 === 0 &&
        this.candidates.reduce((n, c) => n + c.active.length + c.frontier.length, 0) > 16000
      )
        this.limited = true;
    }
    if (this.expansions - this.epochExpansions >= maxExpansions) this.limited = true;
  }
  private rootSatisfied(candidate: Candidate) {
    return (
      candidate.root &&
      this.opening.phase === 'discussion' &&
      this.opening.loop === 1 &&
      this.expected.length <= this.opening.observations.length &&
      this.expected.every((o, i) => normalizeHistory(this.opening.observations)[i] === o)
    );
  }
  /** Exact materialized configurations for independent audits. Streaming or
   * unfinished searches must not masquerade as an empty joint space. */
  jointSolutions(): GameSetup[] | undefined {
    if (!this.materializeForComparison || !this.initialCached || this.streamed || !this.complete)
      return;
    const view = this.snapshot();
    if (!['exact', 'contradiction'].includes(view.status)) return;
    return this.candidates
      .filter(c => this.initialOnly || this.rootSatisfied(c) || c.frontier.length)
      .map(c => structuredClone(c.setup));
  }
  /** Trusted-host query for one entire initial configuration, not independent marginal guesses. */
  queryConfiguration(setup: GameSetup): 'possible' | 'excluded' | 'unknown' {
    if (this.reasons.length) return 'unknown';
    const key = (s: GameSetup) =>
      canonical({
        y: s.y,
        x: s.module === 'WM' ? s.x : [...s.x].sort(),
        module: s.module,
        anniversary: s.anniversary,
        anniversaryFragment: s.anniversaryFragment,
        alternateY: s.alternateY,
        secretAddition: s.secretAddition,
        privateRoles: s.privateRoles,
        characters: s.characters
          .map((c) => ({
            ...c,
            initialArea:
              c.initialArea ?? this.pack.characters[c.character]?.initial[0] ?? 'hospital',
            enterLoop: c.enterLoop ?? 1,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        incidents: s.incidents.map((i) => ({ ...i, publicName: i.publicName ?? i.name })),
      });
    if (this.initialOnly) {
      const started = initializeDiscussion(this.pack, setup);
      if (!started.state)
        return hasUnsupportedDiagnostic(started.diagnostics) ? 'unknown' : 'excluded';
      return setup.module === this.opening.module &&
        setup.anniversary === this.opening.anniversary &&
        setup.days === this.opening.days &&
        setup.loops === this.opening.loops &&
        setup.captain === this.opening.captain &&
        matchesOpeningRoster(started.state, this.opening) &&
        canonical(setup.incidents.map((i) => ({ day: i.day, name: i.publicName ?? i.name }))) ===
          canonical(this.opening.incidents) &&
        this.expected.every(
          (o, i) => normalizeHistory(started.state!.observations.protagonists)[i] === o,
        )
        ? 'possible'
        : 'excluded';
    }
    if (hasUnsupportedDiagnostic(validateSetup(this.pack, setup))) return 'unknown';
    const target = key(setup);
    const matches = this.candidates.filter((c) => key(c.setup) === target);
    if (matches.some((c) => this.rootSatisfied(c) || c.frontier.length)) return 'possible';
    if (this.streamed) {
      // Streaming keeps the complete constraints rather than millions of cached witnesses.
      // Answer a requested joint configuration by replay-searching that configuration alone.
      const check = new EnumeratedKnowledge(this.pack, this.opening);
      check.update(this.opening.observations, this.opening.revision);
      if (check.queryConfiguration(setup) === 'excluded') return 'excluded';
      check.initialOnly = false;
      check.initialCached = true;
      check.domain = (function* () {
        yield structuredClone(setup);
      })();
      check.update(this.observations, this.revision);
      while (!check.paused) check.tick(20);
      const result = check.snapshot();
      return result.possible
        ? 'possible'
        : result.status === 'contradiction'
          ? 'excluded'
          : 'unknown';
    }
    if (
      matches.some((c) => c.root || c.active.length || c.uncertain) ||
      !this.complete ||
      this.streamed ||
      this.reasons.length
    )
      return 'unknown';
    return 'excluded';
  }
  private *hiddenChoices(state: EngineState, offset: number): Generator<Choice> {
    if (state.pending?.kind !== 'cards' || state.pending.actor !== 'mastermind') {
      yield* enumerateChoices(state);
      return;
    }
    const records = this.observations
      .slice(offset)
      .filter((o) => o.type === 'cards' && o.loop === state.loop && o.day === state.day);
    const known = records.find(
      (o) =>
        Array.isArray(o.data.placements) &&
        o.data.placements.every((p) => p.owner === 'mastermind'),
    );
    if (!known || !Array.isArray(known.data.placements)) {
      yield* enumerateChoices(state);
      return;
    }
    const targets: string[] = known.data.placements.map((p) => p.target);
    const revealed = records.find((o) => o.phase === 'card-resolution');
    const reveal = Array.isArray(revealed?.data.placements) ? revealed.data.placements : [];
    const cards = state.cards.filter((c) => c.owner === 'mastermind' && c.status === 'hand');
    function* place(i: number, placements: { card: string; target: string }[]): Generator<Choice> {
      if (i === targets.length) {
        // The engine's exhaustive generator uses card order; observation projection sorts targets.
        yield {
          kind: 'cards',
          placements: placements
            .slice()
            .sort(
              (a, b) =>
                cards.findIndex((c) => c.id === a.card) - cards.findIndex((c) => c.id === b.card),
            ),
        };
        return;
      }
      const target = targets[i]!;
      const face = reveal.find((p) => p.owner === 'mastermind' && p.target === target)?.kind;
      for (const card of cards)
        if ((!face || card.kind === face) && !placements.some((p) => p.card === card.id))
          yield* place(i + 1, [...placements, { card: card.id, target }]);
    }
    yield* place(0, []);
  }
  get paused() {
    return (
      this.limited ||
      this.reasons.length > 0 ||
      ((this.complete || this.generationStopped) &&
        this.candidates.every(
          (c) => this.rootSatisfied(c) || c.frontier.length || (!c.root && !c.active.length),
        ))
    );
  }
  snapshot(): KnowledgeView {
    if (this.initialOnly)
      return {
        revision: this.revision,
        ruleDigest: this.pack.digest,
        status: this.reasons.length
          ? 'unsupported'
          : this.complete
            ? this.initialCount
              ? 'exact'
              : 'contradiction'
            : 'running',
        domainComplete: this.complete,
        generated: this.initialCount,
        possible: this.initialCount,
        unresolved: 0,
        excluded: 0,
        expansions: 0,
        elapsedMs: Math.round(performance.now() - this.started),
        identities: structuredClone(this.initialIdentities),
        rules: [...this.initialRules].sort(),
        culprits: structuredClone(this.initialCulprits),
        reasons: [...this.reasons],
        evidenceThrough: this.expected.length,
      };
    const kept = this.candidates.filter(
      (c) => c.root || c.frontier.length || c.active.length || c.uncertain,
    );
    const currentPossible = kept.filter((c) => this.rootSatisfied(c) || c.frontier.length).length;
    const possible = this.streamedPossible + currentPossible;
    const unresolved = kept.length - currentPossible;
    const identities: Record<string, string[]> = structuredClone(this.streamedIdentities),
      culprits: Record<string, string[]> = structuredClone(this.streamedCulprits);
    const rules = new Set<string>(this.streamedRules);
    for (const c of kept) {
      rules.add(c.setup.y);
      c.setup.x.forEach((x) => rules.add(x));
      for (const char of c.setup.characters) {
        const values = (identities[char.id] ??= []);
        const identity = c.setup.anniversaryFragment === char.id ? '因果残片' : char.identity;
        if (!values.includes(identity)) values.push(identity);
      }
      for (const event of c.setup.incidents) {
        const values = (culprits[String(event.day)] ??= []);
        if (!values.includes(event.culprit)) values.push(event.culprit);
      }
    }
    const status = this.reasons.length
      ? 'unsupported'
      : !this.complete
        ? this.generationStopped || this.limited
          ? 'incomplete'
          : 'running'
        : !kept.length && !this.streamedPossible
          ? 'contradiction'
          : unresolved
            ? 'incomplete'
            : 'exact';
    return {
      revision: this.revision,
      ruleDigest: this.pack.digest,
      status,
      domainComplete: this.complete,
      generated: this.candidates.length + this.discarded + this.streamedPossible,
      possible,
      unresolved,
      excluded: this.candidates.length + this.discarded - kept.length,
      expansions: this.expansions,
      elapsedMs: Math.round(performance.now() - this.started),
      identities,
      rules: [...rules].sort(),
      culprits,
      reasons: [
        ...this.reasons,
        ...(unresolved ? ['仍有隐藏历史未穷尽；未判定候选继续保留。'] : []),
        ...(this.generationStopped
          ? ['初始构造达到配置或尝试次数预算；未生成部分仍未知，不能作全域排除。']
          : []),
        ...(this.limited
          ? ['本观察版本达到搜索或内存预算；新增观察后继续，未搜索分支仍保留。']
          : []),
      ],
      evidenceThrough: this.expected.length,
      deductions: this.deductions.map((d) => ({ ...d })),
    };
  }
}
