import catalog from './source-catalog.json' with { type: 'json' };
import type { Module } from '../../../contracts/src/game.js';
import type { PlotDefinition, IdentityDefinition } from '../../../engine/src/runtime/model.js';

interface Entry {
  kind: string;
  module: string | null;
  name: string;
  source: string;
  fields: Record<string, unknown>;
}
const entries = catalog.entries as unknown as Entry[];
const additions = new Set(['超越世界线', '因果残片', '希望之光', '绝望之暗']);
// Printed permanent traits for the seven supported modules. Conditional changes
// (paper tiger, plot-granted refusal, hope/despair) are read at their own window.
const optionalRefusal = new Set([
  '杀手',
  '主谋',
  '不安定因子',
  '暴徒',
  '深潜者',
  '无面者',
  '忍者',
  '投毒者',
  '吸血鬼',
  '狼人',
  '梦魇',
]);
const mandatoryRefusal = new Set(['邪教徒', '魔女', '偏执狂', '强迫症', '怪杰']);
const immortal = new Set([
  '时间旅者',
  '祭品',
  '永生者',
  '无面者',
  '监视者',
  '怪杰',
  '侦探',
  '吸血鬼',
  '梦魇',
  '纸老虎',
]);
export function catalog3(module: Module, anniversary: boolean) {
  const plots: Pick<PlotDefinition, 'name' | 'source' | 'type' | 'identities'>[] = [];
  const identities: Pick<IdentityDefinition, 'name' | 'source' | 'max' | 'ignore' | 'immortal'>[] =
    [];
  const events: string[] = [];
  const attributes = new Map<string, string[]>();
  const thresholds = new Map<string, number>();
  const forbidden = new Map<string, string[]>();
  const areaNames: Record<string, string> = {
    医院: 'hospital',
    神社: 'shrine',
    学校: 'school',
    都市: 'city',
  };
  for (const { kind, module: origin, name, source, fields } of entries) {
    if (kind === 'characters') {
      forbidden.set(
        name,
        String(fields['禁行区域'] ?? '')
          .split(/\s+/)
          .flatMap((a) => areaNames[a] ?? []),
      );
      attributes.set(name, fields['属性'] as string[]);
      const threshold = Number(String(fields['不安限度']).trim().normalize('NFKC'));
      if (Number.isFinite(threshold)) thresholds.set(name, threshold);
    }
    if (origin !== module && !(anniversary && origin === 'BTX+' && additions.has(name))) continue;
    if (kind === 'rules')
      plots.push({
        name,
        source,
        type: fields.ruleType as 'X' | 'Y',
        identities: Object.fromEntries(
          Object.entries(
            (origin === 'BTX+' && name === '超越世界线'
              ? { 传谣人: '①' }
              : fields.identityCounts) as Record<string, string>,
          ).map(([key, n]) => [key, Number(n.normalize('NFKC'))]),
        ),
      });
    if (kind === 'incidents') events.push(name);
    if (kind === 'identities') {
      identities.push({
        name,
        source,
        immortal: immortal.has(name),
        max: Number(String(fields.max).normalize('NFKC')) || undefined,
        ignore: mandatoryRefusal.has(name)
          ? 'mandatory'
          : optionalRefusal.has(name)
            ? 'optional'
            : undefined,
      });
    }
  }
  if (!identities.some((i) => i.name === '平民'))
    identities.push({ name: '平民', source: '基本规则' });
  return { plots, identities, events, attributes, thresholds, forbidden };
}
