import type {
  CharacterSetup,
  GameSetup,
  Protagonist,
  ScheduledIncident,
} from '../../../contracts/src/game.js';
import type { SetupDomain } from '../../../contracts/src/setup-domain.js';
import { BOARDS, canonical, type RulePack } from '../runtime/model.js';
import {
  culpritDuty,
  hasUnsupportedDiagnostic,
  roleInventory,
  validateSetup,
} from '../runtime/setup.js';
import type { DecisionEvidence } from './observed-worlds.js';
import { compileScriptEvidence, type ScriptEvidence } from './script-evidence.js';

type Slot = SetupDomain['characters'][number];
type Role = NonNullable<Slot['roles']>[number];
type Layout = NonNullable<SetupDomain['plots']>[number];
type Tick = () => void;
const seats: Protagonist[] = ['p0', 'p1', 'p2'];
const unique = <T>(xs: readonly T[]) => [...new Map(xs.map((x) => [canonical(x), x])).values()];

function* layouts(pack: RulePack, domain: SetupDomain): Generator<Layout> {
  if (domain.plots) {
    yield* unique(domain.plots);
    return;
  }
  const plots = Object.values(pack.plots);
  const xs = plots.filter((p) => p.type === 'X').map((p) => p.name);
  for (const { name: y } of plots.filter((p) => p.type === 'Y'))
    for (const first of xs) {
      if (pack.module === 'FS') yield { y, x: [first] };
      else for (const second of xs) if (first !== second) yield { y, x: [first, second] };
    }
}

function* roleRows(
  pack: RulePack,
  domain: SetupDomain,
  layout: Layout,
  tick: Tick,
  acceptsRole: (id: string, role: Role) => boolean,
): Generator<CharacterSetup[]> {
  const defs = [layout.y, ...layout.x].map((n) => pack.plots[n]!);
  const { pool, pairs } = roleInventory(pack, defs);
  const excluded = new Set([...Object.keys(pool), '平民', '因果残片', ...pairs.flat()]);
  if (layout.secretAddition) pool[layout.secretAddition] = 1;
  const quantities = new Map<string, { role: Role; left: number; optional: boolean }>();
  for (const [role, left] of Object.entries(pool))
    if (role !== '平民') quantities.set(canonical(role), { role, left, optional: role === '暴徒' });
  for (const role of pairs) {
    const k = canonical(role),
      old = quantities.get(k);
    quantities.set(k, { role, left: 1 + (old?.left ?? 0), optional: false });
  }
  const roles: Role[] = ['平民', ...[...quantities.values()].map((q) => q.role)];
  const rows = new Map<string, CharacterSetup>();
  const ordinary = domain.characters
    .filter((c) => !['局外人', '模仿犯'].includes(c.character))
    .map((c) => ({
      slot: c,
      options: (c.roles
        ? roles.filter((r) => c.roles!.some((v) => canonical(v) === canonical(r)))
        : roles
      ).filter((r) => acceptsRole(c.id, r)),
    }))
    .sort((a, b) => a.options.length - b.options.length);
  const outsiders = domain.characters.filter((c) => c.character === '局外人');
  const copy = domain.characters.find((c) => c.character === '模仿犯');
  function put(c: Slot, r: Role, copiedFrom?: string) {
    const { roles: _, ...cfg } = c;
    rows.set(c.id, {
      ...cfg,
      identity: typeof r === 'string' ? r : r[0],
      ...(Array.isArray(r) && { reverseIdentity: r[1] }),
      ...(copiedFrom && { copiedFrom }),
    });
  }
  const allowed = (c: Slot, r: Role) =>
    (!c.roles || c.roles.some((v) => canonical(v) === canonical(r))) && acceptsRole(c.id, r);
  const row = () => domain.characters.map((c) => rows.get(c.id)!);
  function* exceptions(): Generator<CharacterSetup[]> {
    const outsider = outsiders[0];
    const options = outsider
      ? Object.keys(pack.identities).filter((r) => !excluded.has(r) && allowed(outsider, r))
      : [undefined];
    for (const r of options) {
      tick();
      if (outsider && r) put(outsider, r);
      if (!copy) {
        yield row();
        continue;
      }
      for (const c of domain.characters) {
        if (c.id === copy.id || (copy.copiedFrom && c.id !== copy.copiedFrom)) continue;
        tick();
        const t = rows.get(c.id)!;
        const role: Role = t.reverseIdentity ? [t.identity, t.reverseIdentity] : t.identity;
        if (allowed(copy, role)) {
          put(copy, role, c.id);
          yield row();
        }
      }
    }
  }
  function* visit(i: number, required: number): Generator<CharacterSetup[]> {
    if (required > ordinary.length - i) return;
    if (i === ordinary.length) {
      yield* exceptions();
      return;
    }
    const { slot, options } = ordinary[i]!;
    for (const r of options) {
      tick();
      const q = quantities.get(canonical(r));
      if (q && q.left === 0) continue;
      if (q) q.left--;
      put(slot, r);
      yield* visit(i + 1, required - Number(!!q && !q.optional));
      if (q) q.left++;
    }
  }
  yield* visit(
    0,
    [...quantities.values()].reduce((n, q) => n + (q.optional ? 0 : q.left), 0),
  );
}

function* range(n: number) {
  for (let i = 1; i <= n; i++) yield i;
}
function* placements(
  pack: RulePack,
  chars: CharacterSetup[],
  sheet: DecisionEvidence['sheet'],
  tick: Tick,
): Generator<CharacterSetup[]> {
  const configured: CharacterSetup[] = [];
  function* visit(i: number): Generator<CharacterSetup[]> {
    if (i === chars.length) {
      yield [...configured];
      return;
    }
    const c = chars[i]!,
      def = pack.characters[c.character]!;
    const areas = c.initialArea
      ? [c.initialArea]
      : c.character === '手下'
        ? [undefined, ...BOARDS]
        : def.initial.length > 1
          ? def.initial
          : [undefined];
    for (const initialArea of areas)
      for (const territory of !c.territory && def.abilityArea ? BOARDS : [c.territory])
        for (const enterDay of !c.enterDay && c.character === '转校生'
          ? range(sheet.days)
          : [c.enterDay])
          for (const enterLoop of !c.enterLoop && c.character === '神灵'
            ? range(sheet.loops)
            : [c.enterLoop]) {
            tick();
            configured.push({
              ...c,
              ...(initialArea && { initialArea }),
              ...(territory && { territory }),
              ...(enterDay && { enterDay }),
              ...(enterLoop && { enterLoop }),
            });
            yield* visit(i + 1);
            configured.pop();
          }
  }
  yield* visit(0);
}

function* schedules(
  pack: RulePack,
  sheet: DecisionEvidence['sheet'],
  domain: SetupDomain,
  characters: CharacterSetup[],
  tick: Tick,
  evidence: ScriptEvidence | undefined,
  kept: (ok: boolean) => boolean,
): Generator<ScheduledIncident[]> {
  const row: ScheduledIncident[] = [];
  const ids = characters.filter((c) => culpritDuty(c) !== 'forbidden').map((c) => c.id);
  const required = new Set(
    characters.filter((c) => culpritDuty(c) === 'required').map((c) => c.id),
  );
  function* visit(i: number): Generator<ScheduledIncident[]> {
    if (required.size > sheet.incidents.length - i) return;
    if (i === sheet.incidents.length) {
      if (kept(!evidence || evidence.allowsTuple(row))) yield [...row];
      return;
    }
    const { day, name: shown } = sheet.incidents[i]!;
    const restriction = domain.incidents?.find((r) => r.day === day);
    for (const name of unique(restriction?.names ?? [shown, '伪造事件'])) {
      const def = pack.incidents[name];
      if (!def || (name !== shown && name !== '伪造事件')) continue;
      const culprits = (def.crowdThreshold !== undefined ? BOARDS : ids).filter((c) =>
        kept(!evidence || evidence.allowsIncident(pack, characters, { day, name, culprit: c })),
      );
      for (const culprit of culprits) {
        tick();
        if (restriction?.culprits && !restriction.culprits.includes(culprit)) continue;
        if (
          def.crowdThreshold === undefined &&
          row.some((v) => v.culprit === culprit && (v.name !== '连续杀人' || name !== '连续杀人'))
        )
          continue;
        row.push({ day, name, culprit, ...(name !== shown && { publicName: shown }) });
        const satisfied = required.delete(culprit);
        yield* visit(i + 1);
        if (satisfied) required.add(culprit);
        row.pop();
      }
    }
  }
  yield* visit(0);
}

function* shuffles(pack: RulePack, domain: SetupDomain): Generator<GameSetup['privateRoles']> {
  if (pack.module !== 'LL' || domain.privateRoles) {
    yield domain.privateRoles;
    return;
  }
  for (const a of seats)
    for (const b of seats)
      if (b !== a) {
        const r: NonNullable<GameSetup['privateRoles']> = { p0: 'C', p1: 'C', p2: 'C' };
        r[a] = 'A';
        r[b] = 'B';
        yield r;
      }
}

/** Enumerates a finite roster/configuration domain. Numbers with no rule-defined
 * upper bound (the Immortal's X) must be supplied for a completeness certificate. */
export function generateSetups(
  pack: RulePack,
  evidence: DecisionEvidence,
  domains: readonly SetupDomain[],
  limit: number,
  pruneScript = false,
  checkIncidents = true,
) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw Error('Invalid generation work limit');
  const stats = {
    work: 0,
    validated: 0,
    legal: 0,
    complete: false,
    limited: false,
    unsupported: false,
    prunedChoices: 0,
  };
  const stop = Symbol('generation limit');
  const tick = () => {
    if (stats.work >= limit) throw stop;
    stats.work++;
  };
  const sheet = evidence.sheet;
  // An untranslated component can change what an announcement means. Retain
  // unsupported diagnostics rather than pruning a possibly applicable model.
  const evidenceRules = pruneScript ? compileScriptEvidence(evidence, checkIncidents) : undefined;
  const safe =
    evidenceRules?.facts.length &&
    [pack.identities, pack.characters, pack.incidents, pack.plots].every((catalog) =>
      Object.values(catalog).every((v) => v.supported),
    )
      ? evidenceRules
      : undefined;
  const kept = (ok: boolean) => {
    if (!ok) stats.prunedChoices++;
    return ok;
  };
  const acceptsRole = (id: string, r: Role) => kept(!safe || safe.allowsBaseRole(pack, id, r));
  const first = evidence.view.reports.find(
    (r) => r.type === 'boundary' && r.phase === 'discussion',
  );
  const initialCaptain = (first?.data.captain ?? evidence.view.captain) as Protagonist;
  function* finish(
    domain: SetupDomain,
    layout: Layout,
    characters: CharacterSetup[],
    incidents: ScheduledIncident[],
  ) {
    const fragments = sheet.anniversary
      ? characters
          .filter(
            (c) =>
              c.identity === '平民' &&
              (!domain.anniversaryFragments || domain.anniversaryFragments.includes(c.id)),
          )
          .map((c) => c.id)
      : [undefined];
    for (const privateRoles of shuffles(pack, domain)) {
      if (!kept(!safe || safe.allowsShuffle(privateRoles))) continue;
      for (const fragment of fragments) {
        tick();
        if (
          !kept(
            !safe ||
              characters.every((c) =>
                safe.allowsIdentity(
                  pack,
                  c.id,
                  fragment === c.id ? '因果残片' : c.identity,
                  c.reverseIdentity,
                ),
              ),
          )
        )
          continue;
        stats.validated++;
        const setup: GameSetup = {
          module: pack.module,
          anniversary: pack.anniversary,
          days: sheet.days,
          loops: sheet.loops,
          captain: domain.captain ?? initialCaptain,
          discussion: sheet.discussion,
          ...(sheet.specialRules.length && { publicSpecialRules: sheet.specialRules }),
          ...layout,
          characters,
          incidents,
          ...(fragment && { anniversaryFragment: fragment }),
          ...(privateRoles && { privateRoles }),
        };
        const diagnostics = validateSetup(pack, setup);
        if (hasUnsupportedDiagnostic(diagnostics)) stats.unsupported = true;
        else if (!diagnostics.length) {
          stats.legal++;
          yield setup;
        }
      }
    }
  }
  function* generate() {
    try {
      for (const domain of domains) {
        tick();
        if (
          !domain.characters.length ||
          new Set(domain.characters.map((c) => c.id)).size !== domain.characters.length ||
          new Set(domain.characters.map((c) => c.character)).size !== domain.characters.length
        )
          throw Error('Expected unique roster IDs and character names');
        if (
          domain.characters.some(
            (c) =>
              !pack.characters[c.character]?.supported ||
              (c.character === '仙人' && c.x === undefined),
          )
        ) {
          stats.unsupported = true;
          continue;
        }
        if (
          domain.incidents?.some((r) => !sheet.incidents.some((i) => i.day === r.day)) ||
          new Set(domain.incidents?.map((r) => r.day)).size !== (domain.incidents?.length ?? 0)
        )
          throw Error('Invalid incident restriction days');
        for (const layout of layouts(pack, domain)) {
          tick();
          const y = pack.plots[layout.y],
            xs = layout.x.map((n) => pack.plots[n]);
          if (
            y?.type !== 'Y' ||
            xs.some((x) => x?.type !== 'X') ||
            new Set(layout.x).size !== xs.length ||
            xs.length !== (pack.module === 'FS' ? 1 : 2)
          )
            throw Error('Invalid plot layout');
          if (!y.supported || xs.some((x) => !x!.supported)) {
            stats.unsupported = true;
            continue;
          }
          const alternate = layout.alternateY
            ? [layout.alternateY]
            : layout.x.includes('疯狂的真相')
              ? Object.values(pack.plots)
                  .filter((p) => p.type === 'Y' && p.name !== layout.y)
                  .map((p) => p.name)
              : [undefined];
          const additions: GameSetup['secretAddition'][] = [undefined];
          if (layout.x.includes('捏造的秘密') && ![y, ...xs].some((p) => p!.identities['密钥']))
            additions.push(
              ...(layout.secretAddition
                ? [layout.secretAddition]
                : (['杀手', '主谋', '因果残片'] as const)),
            );
          for (const poolExtra of additions) {
            if (poolExtra && [y, ...xs].some((p) => p!.identities[poolExtra])) continue;
            const allocation = { ...layout, secretAddition: poolExtra };
            const actualExtra = layout.secretAddition ?? poolExtra;
            for (const row of roleRows(pack, domain, allocation, tick, acceptsRole))
              for (const characters of placements(pack, row, sheet, tick))
                for (const incidents of schedules(
                  pack,
                  sheet,
                  domain,
                  characters,
                  tick,
                  safe,
                  kept,
                ))
                  for (const alternateY of alternate)
                    yield* finish(
                      domain,
                      {
                        y: layout.y,
                        x: layout.x,
                        ...(actualExtra && { secretAddition: actualExtra }),
                        ...(alternateY && { alternateY }),
                      },
                      characters,
                      incidents,
                    );
          }
        }
      }
      stats.complete = !stats.unsupported;
    } catch (e) {
      if (e !== stop) throw e;
      stats.limited = true;
    }
  }
  return {
    setups: generate(),
    stats,
    get incidentExamples() {
      return safe?.incidentExamples ?? [];
    },
  };
}
