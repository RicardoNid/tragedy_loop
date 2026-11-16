import { compileOfficial } from '../../packages/content/src/official/compile.js';
import catalog from '../../packages/content/src/official/source-catalog.json' with { type: 'json' };
import { absenceProgramIndex } from '../../packages/engine/src/absence/programs.js';
import { propagateSolutions } from '../../packages/engine/src/absence/propagation.js';
import type { AbsenceConstraint } from '../../packages/engine/src/absence/index.js';

const esc = (v: string) =>
  v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function inventoryHtml() {
  let mandatory = 0,
    optional = 0,
    incidents = 0;
  const sections = [];
  for (const module of ['FS', 'BTX', 'MZ', 'MC', 'WM', 'HSA', 'AHR', 'LL'] as const) {
    for (const anniversary of ['AHR', 'LL'].includes(module) ? [false] : [false, true]) {
      const pack = compileOfficial(module, anniversary);
      const { programs, unsupported } = absenceProgramIndex(pack);
      const count = (v: string) => programs.filter((p) => p.activation === v).length;
      mandatory += count('mandatory');
      optional += count('optional');
      incidents += count('incident');
      sections.push(
        `<details><summary>${module}${anniversary ? ' 周年' : ''} · 强制 ${count('mandatory')}，任意 ${count('optional')}，事件程序 ${count('incident')}</summary><ul>` +
          programs
            .map(
              (p) =>
                `<li><strong>${esc(p.owner)}</strong> <code>${esc(p.id)}</code> · ${p.activation} · ${p.timing} · ${p.ability.steps.length} 步 · ${esc(p.effects.join('、'))}</li>`,
            )
            .join('') +
          `</ul><p>内容包标为未实现的条目 ${unsupported.length} 个。</p></details>`,
      );
    }
  }
  const raw = catalog.entries.flatMap((e) => {
    const f = e.fields as Record<string, unknown>;
    const lines = [...(Array.isArray(f.abilities) ? f.abilities : []), f.effect].filter(
      (t) => typeof t === 'string' && /强制|強制/.test(t),
    );
    for (const t of [f.traits, f['特性'], ...(Array.isArray(f.special) ? f.special : [])])
      if (typeof t === 'string' && t.trim()) lines.push(t);
    return lines.length
      ? [
          `<li>${esc(e.module ?? '通用')} · <a href="../../${esc(e.source)}">${esc(e.name)}</a><ul>${lines.map((s) => '<li>' + esc(s) + '</li>').join('')}</ul></li>`,
        ]
      : [];
  });
  const domains = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => ['x' + i, i ? ['普通', '特殊'] : ['特殊']]),
  );
  const constraints: AbsenceConstraint[] = Array.from({ length: 11 }, (_, i) => ({
    source: 'benchmark',
    ability: 'chain',
    owner: 'x' + i,
    identity: '特殊',
    target: 'x' + (i + 1),
    targetIdentities: ['普通'],
    phenomenon: 'death',
  }));
  const stats = { branches: 0, removed: 0, solutions: 0 };
  const solutions = [...propagateSolutions({ domains, constraints }, stats)];
  return `<h2>全规则检查</h2><p>8 个模组、14 种模组与周年配置，共 ${mandatory} 个强制、${optional} 个任意能力和 ${incidents} 个事件程序实例。同一能力在不同配置中分别计数。自动测试对每个已成立程序执行一个盘面样本，再用得到的公开结果构造缺席查询。多个分支、触发条件和特性组合另有专项测试。</p>
  ${sections.join('')}<details><summary>查看规则来源中的强制文字、特性及模组说明（${raw.length} 个来源条目）</summary><p>常驻特性由正向内核读取。此表用于逐条追溯，逐程序样本的数量不代表每条特性或每个隐藏状态均已单独实测。</p><ul>${raw.join('')}</ul></details>
  <h2>结构化剪枝的计算量</h2><p>先把同一对变量的禁止组合合并为关系；候选删除时，仅检查相关邻居。传播到稳定后，优先选择候选最少的变量。12 个变量的链式基准固定首项，穷举有 2,048 种排列。本次传播删除 ${stats.removed} 个域值，使用 ${stats.branches} 次搜索分支得到 ${solutions.length} 个解。此数字仅针对该基准。</p>
  <p>完整阶段核验按公告类型定位缺席约束，遇到矛盾立即结束该分支，找到一个合法选择序列即可保留候选。未确定的隐藏状态、脚本特规和用尽的预算保留为未知。多个隐藏补全全部冲突且补全集合已穷尽时，才排除该身份组合。</p>`;
}
