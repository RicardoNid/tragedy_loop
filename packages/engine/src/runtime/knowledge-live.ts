import type { GameSetup, Observation, PlayerView } from '../../../contracts/src/game.js';
import type { KnowledgeView } from '../../../contracts/src/knowledge.js';
import { canonical, type RulePack } from './model.js';
import { normalizeHistory } from './reference.js';
import { hasUnsupportedDiagnostic, validateSetup } from './setup.js';
import {
  buildProfiles,
  incompleteContent,
  combinationKey,
  applyDisclosure,
  configurations,
  setupValues,
  shownIdentity,
  supports,
  targetId,
  targetValues,
  type Profile,
  type Target,
} from './knowledge-domain.js';
import { HistorySearch, type EvidenceLog } from './knowledge-history.js';
import type { PropagationStats } from './knowledge-constraints.js';
import { CausalScope } from './knowledge-scope.js';

interface RecordEntry {
  setup: GameSetup;
  values: Map<string, string>;
  search: HistorySearch;
}
interface Query {
  target: Target;
  iterator: ReturnType<typeof configurations>;
  current?: RecordEntry;
  exhausted: boolean;
  unknown: boolean;
}
const hasHermit = (opening: PlayerView) =>
  [...opening.characters, ...(opening.roster ?? [])].some((c) => c.character === '仙人');
export function waitingForCharacters(revision: number): KnowledgeView {
  return {
    revision,
    status: 'waiting',
    domainComplete: false,
    ruleDigest: '',
    generated: 0,
    possible: 0,
    unresolved: 0,
    excluded: 0,
    expansions: 0,
    elapsedMs: 0,
    identities: {},
    rules: [],
    culprits: {},
    reasons: [],
    evidenceThrough: 0,
  };
}

export function unsupportedDomain(pack: RulePack, opening: PlayerView): string[] {
  const reasons: string[] = [];
  if (
    pack.module !== opening.module ||
    pack.anniversary !== opening.anniversary ||
    opening.loop !== 1 ||
    opening.phase !== 'discussion' ||
    opening.day !== 1
  )
    reasons.push('求解需要相同规则版本的第一轮开局公开视图。');
  if (!['FS', 'BTX'].includes(pack.module)) reasons.push('增量约束求解器当前支持 FS、BTX。');
  if (hasHermit(opening)) reasons.push('仙人的无界整数 X 尚需符号数值约束，不能截断为有限精确域。');
  if (Object.values(pack.plots).some((p) => !p.supported || p.pair))
    reasons.push('当前内容包含未支持的规则或双面身份约束。');
  return reasons.concat(incompleteContent(pack, opening));
}

/** Event-driven symbolic projection. Exact means every displayed value has a witness, NOT model counting. */
export class LiveKnowledge {
  private profiles: Profile[];
  private readonly stats: PropagationStats = { checks: 0, removed: 0, branches: 0 };
  private evidence: EvidenceLog = { observations: [], normalized: [], version: 0 };
  private revision = -1;
  private constraintVersion = 0;
  private projectedTargets?: Target[];
  private records = new Map<string, RecordEntry>();
  private rejected = new Set<string>();
  private queries = new Map<string, Query>();
  private verified = new Set<string>();
  private revalidate: RecordEntry[] = [];
  private cursor = 0;
  private started = performance.now();
  private limited = false;
  private work = 0;
  private epochWork = 0;
  private expansions = 0;
  private generated = 0;
  private initializations = 0;
  private priorRoots = 0;
  private priorExpansions = 0;
  private historyComparisons = 0;
  private deductions: NonNullable<KnowledgeView['deductions']> = [];
  private causal?: CausalScope;
  private readonly openingColumns: NonNullable<KnowledgeView['openingColumns']>;
  private scope?: KnowledgeView['scope'];
  private deferred = true;
  // Exhaust all surviving *joint configurations* once a coupled window is seen.
  // Retain the iterator, rejected configurations, and every surviving replay
  // stack across append(): later evidence can only remove solutions.
  private joint?: { iterator: Generator<GameSetup | null>; exhausted: boolean };
  private jointUnknown = false;
  private readonly enumeratedRecords = new Set<RecordEntry>();
  private windowReports = 0;
  private trace: NonNullable<KnowledgeView['calculationTrace']> = [];
  private windowPhase?: Observation['phase'];
  private publicContradiction = false;
  get historySearchDeferred() {
    return this.deferred;
  }
  private transition?: KnowledgeView['transition'];
  readonly reasons: string[];
  constructor(
    private pack: RulePack,
    readonly opening: PlayerView,
    private readonly searchBudget = 100000,
  ) {
    this.reasons = unsupportedDomain(pack, opening);
    // The unbounded X of the hermit prevents exact enumeration. Its public
    // roster, role quotas and incident relationships still have finite domains.
    this.profiles =
      !this.reasons.length || (this.reasons.length === 1 && hasHermit(opening))
        ? buildProfiles(pack, opening, this.stats)
        : [];
    const initial = this.targets();
    const columns = (prefix: string) =>
      [...new Set(initial.filter((t) => t.key.startsWith(prefix)).map((t) => t.value))].sort();
    this.openingColumns = {
      identities: columns('identity:'),
      rules: columns('rule'),
      culprits: columns('culprit:'),
      days: opening.incidents.map((e) => String(e.day)),
    };
    if (this.profiles.length) this.causal = new CausalScope(pack, opening);
    this.ensureQueries(initial);
  }
  /** Complete logs and incremental deliveries share the same prefix validation. */
  update(history: Observation[], revision: number) {
    if (revision < this.revision) throw Error('观察版本不能回退。');
    if (history.length < this.evidence.observations.length)
      throw Error('观察必须追加，不能改写已有历史。');
    this.append(history, 0, revision);
  }
  get observationCount() {
    return this.evidence.observations.length;
  }
  /** Empty and retried deliveries never wake inference. */
  append(observations: Observation[], after: number, revision: number) {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.evidence.observations.length)
      throw Error('观察追加偏移不连续。');
    const normalized = normalizeHistory(observations);
    const overlap = Math.min(this.evidence.observations.length - after, observations.length);
    for (let i = 0; i < overlap; i++)
      if (
        observations[i]!.sequence !== after + i + 1 ||
        normalized[i] !== this.evidence.normalized[after + i]
      )
        throw Error('观察必须追加，不能改写已有历史。');
    const fresh: Observation[] = [],
      suffix: string[] = [];
    // Sequences in one public feed start at one. Check the whole delivery
    // before publishing any changes, including overlaps within a retry batch.
    for (let i = overlap; i < observations.length; i++) {
      const o = observations[i]!;
      const index = o.sequence - 1;
      const offset = index - this.evidence.normalized.length;
      if (!Number.isSafeInteger(index) || index < 0 || offset > fresh.length)
        throw Error('观察序号不连续。');
      if (offset === fresh.length) {
        fresh.push(o);
        suffix.push(normalized[i]!);
      } else if (
        (offset < 0 ? this.evidence.normalized[index] : suffix[offset]) !== normalized[i]
      ) {
        throw Error('同序号观察内容冲突。');
      }
    }
    if (revision < this.revision && fresh.length) throw Error('观察版本不能回退。');
    this.revision = Math.max(this.revision, revision);
    if (!fresh.length) return;
    this.priorRoots = this.initializations;
    this.priorExpansions = this.expansions;
    this.transition = {
      historyCandidates: [],
      fromVersion: this.evidence.version,
      toVersion: this.evidence.version + 1,
      firstObservation: this.evidence.observations.length + 1,
      lastObservation: this.evidence.observations.length + fresh.length,
    };
    this.evidence.observations.push(...structuredClone(fresh));
    this.evidence.normalized.push(...suffix);
    this.evidence.version++;
    this.epochWork = this.work;
    this.limited = false;
    this.verified.clear();
    this.revalidate = [...this.records.values()];
    this.deferred = false;
    this.scope = undefined;
    if (!this.causal) return;
    const before = this.stats.removed,
      profileCount = this.profiles.length,
      relationVersion = this.causal.version;

    for (const [index, o] of fresh.entries()) {
      const prior = this.stats.removed,
        size = this.profiles.length;
      const publicUpdate = this.causal.publicUpdate(o);
      const scope = this.causal.consume(o, this.profiles);
      const wasJoint = !!this.joint;
      if (o.type === 'boundary') {
        if (this.windowReports >= 2) this.startJointSearch();
        this.windowPhase = o.phase;
        this.windowReports = 0;
      } else if (
        o.phase === this.windowPhase &&
        [
          'incident',
          'mastermind-abilities',
          'protagonist-abilities',
          'day-end',
          'loop-end',
          'card-resolution',
          'loop-start',
        ].includes(o.phase) &&
        [
          'incident',
          'character',
          'board',
          'declaration',
          'failure',
          'refused',
          'identity',
          'no-effect',
        ].includes(o.type)
      ) {
        if (!scope?.locallyExplained || scope.needsHistory) this.windowReports++;
      }
      if (
        scope?.needsHistory ||
        (!scope?.locallyExplained && o.phase === this.windowPhase &&
          (o.type === 'character' || o.type === 'board' || o.type === 'failure') &&
          ((scope?.fields?.length ?? 0) > 1 || (scope?.alternatives?.length ?? 0) > 1))
      )
        this.startJointSearch();
      if (scope) this.scope = scope;
      if (scope?.needsHistory || (!scope && !publicUpdate)) {
        this.transition.historyCandidates!.push(o.sequence);
      }
      this.profiles = this.profiles.filter((p) => p.active);
      if (o.type === 'identity' || o.type === 'rule' || o.type === 'culprit')
        this.profiles = this.profiles.filter(
          (p) => (p.active = applyDisclosure(p, this.opening, o) && p.store.propagate()),
        );
      if (size && !this.profiles.length) this.publicContradiction = true;

      const removed = this.stats.removed - prior + size - this.profiles.length;
      const needsHistory = !!scope?.needsHistory || (!scope && !publicUpdate);
      this.trace.push({
        observation: o.sequence, removed,
        mode: this.joint ? 'joint' : needsHistory ? 'history' : 'local',
        reason: !wasJoint && this.joint ? '本观察触发联合历史核验' :
          needsHistory ? '公开窗口仍有未建模的历史条件' :
          scope ? '已按公开盘面传播原因约束' : '更新公开盘面',
        ...(scope?.alternatives?.length && { alternatives: scope.alternatives }),
      });
      if (removed)
        this.deductions.push({
          observation: this.evidence.observations.length - fresh.length + index + 1,
          removed,
          reason: scope
            ? '按效果、时点与对象分类建立必要原因约束；角色区域只筛选角色来源，无关规则保留。仅在关联约束收紧时继续传播。'
            : '公开信息收紧对应变量，并沿声明的约束依赖传播；数量为候选取值及规则分支删除次数。',
        });
    }
    if (
      before !== this.stats.removed ||
      profileCount !== this.profiles.length ||
      relationVersion !== this.causal.version
    )
      this.constraintVersion++;
    if (before !== this.stats.removed || profileCount !== this.profiles.length) {
      this.projectedTargets = undefined;
      this.ensureQueries();
    }
    // Reuse only a complete matching witness for the new prefix. All other
    // hidden paths stay on their search stacks for later observations.
    this.revalidate = this.revalidate.filter((record) => {
      if (!this.admissible(record.setup, record.values)) {
        this.enumeratedRecords.delete(record);
        this.records.delete(this.key(record.setup));
        return false;
      }
      const compared = record.search.compared;
      const valid = record.search.result === 'possible';
      this.historyComparisons += record.search.compared - compared;
      if (valid) this.markWitness(record);
      return !valid;
    });
    this.finishJointSearch();
    this.deferred = !this.joint && this.transition.historyCandidates!.length === 0;
    if (this.scope) this.scope.deferred = this.deferred;
  }
  private startJointSearch() {
    if (!this.joint && !this.reasons.length)
      this.joint = { iterator: configurations(this.pack, this.opening, this.profiles), exhausted: false };
  }
  /** Explicitly enumerate complete assignments, even for a single observation. */
  verifyCombinations() {
    this.startJointSearch();
    this.verifyAll();
  }
  /** Explicit full-history validation, independent of the lightweight local cause pass. */
  verifyAll() {
    this.deferred = false;
    if (this.scope) this.scope.deferred = false;
    this.limited = false;
    this.epochWork = this.work;
    this.revalidate = [...this.records.values()];
    this.queries.clear();
    this.ensureQueries();
  }
  private targets(): Target[] {
    if (this.projectedTargets) return this.projectedTargets;
    const targets = new Map<string, Target>();
    const add = (t: Target) => targets.set(targetId(t), t);
    for (const p of this.profiles) {
      add({ key: 'combination', value: combinationKey(p) });
      for (const value of [p.y, ...p.x]) add({ key: 'rule', value });
      for (const [key, values] of p.store.domains)
        for (const value of targetValues(key, values)) add({ key, value });
    }
    this.projectedTargets = [...targets.values()];
    return this.projectedTargets;
  }
  private ensureQueries(targets = this.targets()) {
    const ids = new Set(targets.map(targetId));
    for (const id of this.queries.keys()) if (!ids.has(id)) this.queries.delete(id);
    for (const target of targets)
      if (!this.queries.has(targetId(target)))
        this.queries.set(targetId(target), {
          target,
          iterator: configurations(this.pack, this.opening, this.profiles, target),
          exhausted: false,
          unknown: false,
        });
  }
  private key(setup: GameSetup) {
    return canonical({
      ...setup,
      discussion: 'allowed',
      x: [...setup.x].sort(),
      characters: setup.characters
        .map((c) => ({
          ...c,
          initialArea: c.initialArea ?? this.pack.characters[c.character]?.initial[0],
          ...(c.character === '神灵' ? { enterLoop: c.enterLoop ?? 1 } : {}),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      incidents: setup.incidents
        .map((e) => ({ ...e, publicName: e.publicName ?? e.name }))
        .sort((a, b) => a.day - b.day),
    });
  }
  private admissible(setup: GameSetup, values = setupValues(setup)) {
    return this.profiles.some(
      (p) =>
        p.y === setup.y &&
        canonical([...p.x].sort()) === canonical([...setup.x].sort()) &&
        [...values].every(([key, value]) => supports(p, { key, value })),
    );
  }
  private record(setup: GameSetup) {
    const key = this.key(setup),
      old = this.records.get(key);
    if (old) return old;
    const values = setupValues(setup);
    for (const c of setup.characters)
      if (!this.opening.characters.some((v) => v.id === c.id))
        values.set(`area:${c.id}`, c.initialArea ?? this.pack.characters[c.character]!.initial[0]!);
    const result = {
      setup,
      values,
      search: new HistorySearch(this.pack, setup, this.evidence, this.opening),
    };
    this.records.set(key, result);
    this.generated++;
    this.initializations++;
    return result;
  }
  private markWitness(record: RecordEntry) {
    this.verified.add(targetId({ key: 'combination', value: combinationKey(record.setup) }));
    for (const [key, value] of record.values) this.verified.add(targetId({ key, value }));
    for (const value of [record.setup.y, ...record.setup.x])
      this.verified.add(targetId({ key: 'rule', value }));
  }
  private stepRecord(record: RecordEntry) {
    const before = record.search.expansions,
      compared = record.search.compared;
    record.search.step();
    this.expansions += record.search.expansions - before;
    this.historyComparisons += record.search.compared - compared;
    const result = record.search.result;
    if (result === 'possible') {
      this.markWitness(record);
    } else if (result === 'excluded') {
      this.rejected.add(this.key(record.setup));
      this.enumeratedRecords.delete(record);
      this.records.delete(this.key(record.setup));
    }
    return result;
  }
  private exclude(target: Target) {
    const before = this.stats.removed,
      count = this.profiles.length;
    this.profiles = this.profiles.filter((p) => {
      if (!supports(p, target)) return true;
      if (target.key === 'rule' || target.key === 'combination') {
        p.active = false;
        return false;
      }
      p.store.narrow(
        target.key,
        [...p.store.values(target.key)].filter(
          (v) => (target.key.startsWith('identity:') ? shownIdentity(v) : v) !== target.value,
        ),
      );
      return (p.active = p.store.propagate());
    });
    this.constraintVersion++;
    this.deductions.push({
      observation: this.evidence.observations.length,
      removed: this.stats.removed - before + count - this.profiles.length,
      reason: `${target.key} = ${target.value} 的合法联合配置及隐藏行动解释均已排除；结果沿依赖传播。`,
    });
    this.projectedTargets = undefined;
    this.ensureQueries();
  }
  tick(milliseconds = 15, maxWork = this.searchBudget) {
    if (this.paused) return;
    const deadline = performance.now() + milliseconds;
    while (performance.now() < deadline && this.profiles.length) {
      if (
        this.work - this.epochWork >= maxWork ||
        this.records.size > 512 ||
        this.rejected.size > 100000 ||
        (this.work % 100 === 0 &&
          [...this.records.values()].reduce((n, r) => n + r.search.nodes, 0) > 4000)
      ) {
        this.limited = true;
        break;
      }
      this.work++;
      const cached = this.revalidate.at(-1);
      if (cached) {
        if (!this.admissible(cached.setup, cached.values)) {
          this.enumeratedRecords.delete(cached);
          this.records.delete(this.key(cached.setup));
          this.revalidate.pop();
          if (!this.revalidate.length) this.finishJointSearch();
          continue;
        }
        if (this.stepRecord(cached) !== 'unknown' || cached.search.blocked) this.revalidate.pop();
        if (!this.revalidate.length) this.finishJointSearch();
        continue;
      }
      if (this.joint) {
        if (this.joint.exhausted) break;
        const next = this.joint.iterator.next();
        if (next.done) {
          this.joint.exhausted = true;
          this.finishJointSearch();
        } else if (
          next.value &&
          this.admissible(next.value) &&
          !this.rejected.has(this.key(next.value))
        ) {
          const record = this.record(next.value);
          this.enumeratedRecords.add(record);
          if (record.search.result === 'possible') this.markWitness(record);
          else this.revalidate.push(record);
        }
        continue;
      }
      const pending = [...this.queries.values()].filter(
        (q) => !this.verified.has(targetId(q.target)) && !(q.exhausted && q.unknown),
      );
      if (!pending.length) break;
      const q = pending[this.cursor++ % pending.length]!;
      if (q.current) {
        if (!this.admissible(q.current.setup, q.current.values)) {
          q.current = undefined;
          continue;
        }
        const result = this.stepRecord(q.current);
        if (result !== 'unknown' || q.current.search.blocked) {
          if (q.current.search.blocked) q.unknown = true;
          q.current = undefined;
        }
        continue;
      }
      const next = q.iterator.next();
      if (next.done) {
        q.exhausted = true;
        if (!q.unknown) this.exclude(q.target);
        continue;
      }
      if (!next.value) continue;
      const setup = next.value;
      if (!this.admissible(setup) || this.rejected.has(this.key(setup))) continue;
      q.current = this.record(setup);
    }
  }
  private finishJointSearch() {
    if (!this.joint?.exhausted || this.revalidate.length) return;
    this.jointUnknown = [...this.records.values()].some((r) => r.search.result === 'unknown');
    if (this.jointUnknown) return;
    // All remaining leaves were tried. Only now is a missing witness a proof.
    for (const t of [...this.targets()]) if (!this.verified.has(targetId(t))) this.exclude(t);
  }
  /** Return the exact joint space only at a completed, supported checkpoint. */
  jointSolutions(): GameSetup[] | undefined {
    if (this.reasons.length && !this.publicContradiction) return;
    if (!this.profiles.length) return [];
    if (!this.joint?.exhausted || this.revalidate.length || this.jointUnknown) return;
    return [...this.enumeratedRecords].map((r) => structuredClone(r.setup));
  }
  get paused() {
    return (
      !!this.reasons.length ||
      !this.profiles.length ||
      this.limited ||
      this.deferred ||
      (this.joint
        ? this.joint.exhausted && !this.revalidate.length
        : !this.revalidate.length &&
          [...this.queries.values()].every(
            (q) => this.verified.has(targetId(q.target)) || (q.exhausted && q.unknown),
          ))
    );
  }
  /** Explicit single-configuration query; no implicit count or global traversal. */
  queryConfiguration(setup: GameSetup): 'possible' | 'excluded' | 'unknown' {
    if (this.publicContradiction) return 'excluded';
    if (this.reasons.length) return 'unknown';
    const diagnostics = validateSetup(this.pack, setup);
    if (hasUnsupportedDiagnostic(diagnostics)) return 'unknown';
    if (
      diagnostics.length ||
      setup.days !== this.opening.days ||
      setup.loops !== this.opening.loops ||
      setup.captain !== this.opening.captain ||
      canonical(setup.incidents.map((e) => ({ day: e.day, name: e.publicName ?? e.name }))) !==
        canonical(this.opening.incidents) ||
      !this.admissible(setup)
    )
      return 'excluded';
    if (this.rejected.has(this.key(setup))) return 'excluded';
    const record = this.record(setup);
    for (
      let steps = 0;
      steps < this.searchBudget &&
      record.search.result === 'unknown' &&
      !record.search.blocked &&
      record.search.nodes <= 4000;
      steps++
    )
      this.stepRecord(record);
    return record.search.result;
  }
  snapshot(): KnowledgeView {
    if (this.opening.phase === 'briefing') return waitingForCharacters(this.revision < 0 ? this.opening.revision : this.revision);
    const identities: Record<string, string[]> = {},
      culprits: Record<string, string[]> = {},
      realIncidents: Record<string, string[]> = {},
      parameters: Record<string, string[]> = {};
    const verified = {
      identities: {} as Record<string, string[]>,
      rules: [] as string[],
      culprits: {} as Record<string, string[]>,
      realIncidents: {} as Record<string, string[]>,
    };
    const rules: string[] = [],
      targets = this.targets();
    const add = (record: Record<string, string[]>, key: string, value: string) =>
      (record[key] ??= []).push(value);
    for (const t of targets) {
      const confirmed = this.verified.has(targetId(t));
      if (t.key === 'rule') {
        rules.push(t.value);
        if (confirmed) verified.rules.push(t.value);
      } else if (t.key.startsWith('identity:')) {
        add(identities, t.key.slice(9), t.value);
        if (confirmed) add(verified.identities, t.key.slice(9), t.value);
      } else if (t.key.startsWith('culprit:')) {
        add(culprits, t.key.slice(8), t.value);
        if (confirmed) add(verified.culprits, t.key.slice(8), t.value);
      } else if (t.key.startsWith('event:')) {
        add(realIncidents, t.key.slice(6), t.value);
        if (confirmed) add(verified.realIncidents, t.key.slice(6), t.value);
      } else if (t.key !== 'combination') add(parameters, t.key, t.value);
    }
    for (const c of this.opening.roster ?? this.opening.characters)
      if (c.character === '仙人') parameters['x:' + c.id] = ['非负整数（符号域）'];
    const verifiedValues = targets.filter((t) => this.verified.has(targetId(t))).length;
    const possible = [...this.records.values()].filter(
      (r) => r.search.result === 'possible',
    ).length;
    return {
      representation: 'constraints',
      calculationTrace: [...this.trace],
      historySearchDeferred: this.deferred,
      openingColumns: this.openingColumns,
      jointCount:
        !this.profiles.length && (!this.reasons.length || this.publicContradiction)
          ? 0
          : this.joint?.exhausted && !this.revalidate.length && !this.jointUnknown
            ? this.enumeratedRecords.size
            : null,
      revision: this.revision,
      ruleDigest: this.pack.digest,
      status: this.publicContradiction
        ? 'contradiction'
        : this.reasons.length
          ? 'unsupported'
          : !this.profiles.length
            ? 'contradiction'
            : verifiedValues === targets.length &&
                (!this.joint ||
                  (this.joint.exhausted && !this.jointUnknown && !this.revalidate.length))
              ? 'exact'
              : this.paused
                ? 'incomplete'
                : 'running',
      domainComplete: !this.reasons.length,
      generated: this.generated,
      possible,
      unresolved: targets.length - verifiedValues,
      excluded: this.rejected.size,
      expansions: this.expansions,
      elapsedMs: Math.round(performance.now() - this.started),
      identities,
      impliedIdentities: Object.fromEntries(Object.entries(this.causal?.impliedIdentities ?? {})
        .filter(([id, fact]) => identities[id]?.length === 1 && identities[id]?.[0] === fact.identity)),
      rules: rules.sort(),
      culprits,
      realIncidents,
      parameters,
      verified,
      ruleCombinations: [
        ...new Map(this.profiles.map((p) => [canonical([p.y, p.x]), { y: p.y, x: p.x }])).values(),
      ],
      reasons: [
        ...this.reasons,
        ...(this.deferred
          ? ['局部约束传播完成；未展开无关身份。剩余候选尚未完成联合历史核验，可按需核验。']
          : []),
        ...(this.limited
          ? ['本次联合搜索达到预算；尚未验证的候选继续保留，新增信息后继续推进。']
          : []),
      ],
      evidenceThrough: this.evidence.observations.length,
      deductions: this.deductions.slice(-100),
      scope: this.scope,
      relations: this.causal?.relations(this.profiles) ?? [],
      transition: this.transition && {
        ...this.transition,
        newHistoryRoots: this.initializations - this.priorRoots,
        historyBranches: this.expansions - this.priorExpansions,
      },
      propagation: {
        ...this.stats,
        informationVersion: this.evidence.version,
        constraintVersion: this.constraintVersion,
        pending: targets.length - verifiedValues,
        candidateValues: targets.length,
        verifiedValues,
        initializations: this.initializations,
        historyComparisons: this.historyComparisons,
        causeBranches: this.causal?.causeBranches ?? 0,
      },
    };
  }
}
