import { createHash } from 'node:crypto';
import {
  characterTraits,
  identityTraits,
  incidentTraits,
  moduleAbilities,
} from './interaction-rules.js';
import catalog from './source-catalog.json' with { type: 'json' };
import rulings from '../foundation-decisions.json' with { type: 'json' };
import type { Module, Area, Board } from '../../../contracts/src/game.js';
import { canonical, type Ability, type RulePack } from '../../../engine/src/runtime/model.js';
import { characterPrograms, identityPrograms, incidentProgram, plotPrograms } from './programs.js';
interface Entry {
  name: string;
  kind: string;
  module: string | null;
  source: string;
  sha256: string;
  fields: Record<string, unknown>;
}
const entries = catalog.entries as unknown as Entry[];
const areas: Record<string, Area> = {
  医院: 'hospital',
  神社: 'shrine',
  都市: 'city',
  学校: 'school',
  远方: 'far',
};
const decodeAreas = (text: string): Area[] =>
  Object.entries(areas)
    .filter(([name]) => text.includes(name))
    .map(([, area]) => area);
const stamp = (abilities: Omit<Ability, 'source'>[] | null, source: string): Ability[] =>
  (abilities ?? []).map((a) => ({ ...a, source }));
function freeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) freeze(v);
    Object.freeze(o);
  }
  return o;
}
/** Compilation is reusable; unsupported translations remain explicit diagnostics at setup. */
const compiled = new Map<string, RulePack>();
export function compileOfficial(module: Module, anniversary = false): RulePack {
  const key = `${module}:${anniversary}`;
  const cached = compiled.get(key);
  if (cached) return cached;
  const pack: RulePack = {
    schema: 1,
    semanticVersion: '0.3.3',
    moduleAbilities: moduleAbilities[module] ?? [],
    digest: '',
    module,
    anniversary,
    characters: {},
    identities: {},
    plots: {},
    incidents: {},
  };
  const counts: Record<string, number> = { '①': 1, '②': 2, '③': 3 };
  for (const e of entries) {
    const f = e.fields;
    if (e.kind === 'characters') {
      const programs = characterTraits[e.name]?.abilities ?? characterPrograms(e.name);
      pack.characters[e.name] = {
        ...characterTraits[e.name],
        name: e.name,
        source: e.source,
        initial: decodeAreas(String(f['初始区域'] ?? '')),
        forbidden: decodeAreas(String(f['禁行区域'] ?? '')) as Board[],
        paranoia: Number(String(f['不安限度'] ?? '').normalize('NFKC')) || 0,
        attributes: (f['属性'] as string[]) ?? [],
        abilities: stamp(programs, e.source),
        supported: programs !== null,
      };
      continue;
    }
    const overlay =
      anniversary &&
      e.module === 'BTX+' &&
      ((e.kind === 'rules' && e.name === '超越世界线') ||
        (e.kind === 'identities' && e.name === '因果残片') ||
        (e.kind === 'incidents' && ['希望之光', '绝望之暗'].includes(e.name)));
    if (e.module !== module && !overlay) continue;
    if (e.kind === 'identities') {
      const programs = identityTraits[e.name]?.abilities ?? identityPrograms(e.name),
        traits = String(f.traits ?? '').replaceAll(/\s/g, '');
      pack.identities[e.name] = {
        ...identityTraits[e.name],
        name: e.name,
        source: e.source,
        max: counts[String(f.max)],
        ignore: traits.includes('必定')
          ? 'mandatory'
          : traits.includes('无视友好')
            ? 'optional'
            : undefined,
        puppet: traits.includes('傀儡'),
        immortal: traits.includes('不死'),
        abilities: stamp(programs, e.source),
        supported: programs !== null,
      };
    }
    if (e.kind === 'rules') {
      const programs = plotPrograms(e.name);
      const rawCounts = (f.identityCounts as Record<string, string>) ?? {};
      const front = Object.keys(rawCounts).find((n) => rawCounts[n] === '表');
      const reverse = Object.keys(rawCounts).find((n) => rawCounts[n] === '里');
      pack.plots[e.name] = {
        name: e.name,
        source: e.source,
        type: f.ruleType as 'Y' | 'X',
        identities: Object.fromEntries(
          Object.entries(rawCounts)
            .filter(([, n]) => counts[n])
            .map(([name, n]) => [name, counts[n]!]),
        ),
        pair: front || reverse ? [front ?? '平民', reverse ?? '平民'] : undefined,
        abilities: stamp(programs, e.source),
        supported: programs !== null,
      };
    }
    if (e.kind === 'incidents') {
      const program = incidentProgram(e.name);
      pack.incidents[e.name] = {
        ...incidentTraits[e.name],
        name: e.name,
        source: e.source,
        steps: program ?? [],
        supported: program !== null,
        thresholdOffset: ['前兆', '送葬', '冲动杀人'].includes(e.name)
          ? -1
          : e.name === '猎奇杀人'
            ? 1
            : 0,
        thresholdCounter: ['阴谋活动', '廷达罗斯之嗅', '空想事件'].includes(e.name)
          ? 'intrigue'
          : e.name === '希望之光'
            ? 'goodwill'
            : undefined,
        exGain: e.name === '银色子弹' ? 0 : e.name === '猎奇杀人' ? 2 : 1,
        crowdThreshold: (
          { 疯狂之夜: 0, 诅咒活化: 1, 污秽溢出: 2, 死者默示录: 2 } as Record<string, number>
        )[e.name],
      };
    }
  }
  pack.identities['平民'] = {
    name: '平民',
    source: 'facts/sources/lunhui/tragedy_loop_game_rules(3)(1).md#6.4',
    supported: true,
    abilities: [],
  };
  pack.digest = createHash('sha256')
    .update(
      canonical({
        pack,
        sources: entries
          .filter(
            (e) =>
              e.module === module ||
              e.kind === 'characters' ||
              (anniversary && e.module === 'BTX+'),
          )
          .map((e) => [e.source, e.sha256]),
        decisions: rulings.decisions.map((d) => ({
          id: d.id,
          status: d.status,
          semantics: d.semantics,
        })),
      }),
    )
    .digest('hex');
  const result = freeze(pack);
  compiled.set(key, result);
  return result;
}
export function contentCoverage(pack: RulePack) {
  return Object.entries({
    characters: pack.characters,
    identities: pack.identities,
    plots: pack.plots,
    incidents: pack.incidents,
  }).map(([kind, values]) => ({
    kind,
    total: Object.keys(values).length,
    translated: Object.values(values).filter((v) => v.supported).length,
    pending: Object.values(values)
      .filter((v) => !v.supported)
      .map((v) => ({ name: v.name, source: v.source })),
  }));
}
