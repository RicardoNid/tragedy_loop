import { inventoryHtml } from './absence-inventory.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileOfficial } from '../../packages/content/src/official/compile.js';
import {
  buildAbsenceSpace,
  absenceSolutions,
  type AbsenceWindow,
} from '../../packages/engine/src/absence/index.js';
import { zeroCounters } from '../../packages/engine/src/runtime/model.js';

const pack = compileOfficial('BTX');
const roles = ['平民', '杀人狂', '时间旅者'];
function matrix(title: string, guard: number, coverage: AbsenceWindow['coverage'], third = false) {
  const characters: AbsenceWindow['entry']['characters'] = ['A', 'B'].map((id, i) => ({
    id,
    character: i ? '女学生' : '男学生',
    status: 'alive',
    area: 'school',
    counters: zeroCounters(),
  }));
  characters[1]!.counters.guard = guard;
  const domains: Record<string, string[]> = { A: roles, B: roles };
  if (third) {
    characters.push({ ...characters[0]!, id: 'C', character: '医生' });
    domains.C = ['平民'];
  }
  const space = buildAbsenceSpace(
    pack,
    {
      coverage,
      timing: { kind: 'day-end' },
      absent: ['A', 'B'].map((character) => ({ phenomenon: 'death', character })),
      entry: {
        module: 'BTX',
        anniversary: false,
        phase: 'day-end',
        day: 1,
        loop: 1,
        days: 3,
        loops: 2,
        characters,
        boards: { school: 0, shrine: 0, city: 0, hospital: 0 },
      },
    },
    domains,
  );
  const rows = [...absenceSolutions(space)];
  return `<details${!guard && coverage === 'complete' && !third ? ' open' : ''}><summary>${title} · 保留 ${rows.length}/9</summary>
    <table><caption>行是 A 的身份，列是 B 的身份</caption><thead><tr><th>A ＼ B</th>${roles.map((r) => `<th scope="col">${r}</th>`).join('')}</tr></thead>
    <tbody>${roles.map((A) => `<tr><th scope="row">${A}</th>${roles.map((B) => (rows.some((r) => r.A === A && r.B === B) ? '<td>保留</td>' : '<td class="out">排除</td>')).join('')}</tr>`).join('')}</tbody></table>
    ${space.constraints.map((c) => `<p>${c.owner} 若为${c.identity}，则排除 ${c.target} 为${c.targetIdentities.join('、')}的组合。</p>`).join('')}
    <details><summary>查看结构化身份域与约束</summary><pre>${JSON.stringify(space, null, 2).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre></details></details>`;
}

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>未发生现象的解空间</title><style>
body{max-width:48rem;margin:2.5rem auto;padding:0 1rem;font:1rem/1.7 system-ui,sans-serif;color:#1e3039;background:#fafaf7}
h1,h2{line-height:1.3}h2{margin-top:2rem}details{background:white;border:1px solid #bfcac6;border-radius:.45rem;margin:.7rem 0;padding:.7rem 1rem}
summary{font-weight:650;cursor:pointer}table{border-collapse:collapse;width:100%;margin:1rem 0}caption{text-align:left}th,td{border:1px solid #cbd2cf;text-align:center;padding:.35rem}
td{background:#edf7ef}.out{color:#7f291f;background:#faeae5}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#145952}</style><main>
<h1>未发生现象的解空间</h1>
<p>在同一结算时点，某组有效身份若必然产生已确认缺席的现象，就排除整组。单个角色仍可能保留原先的全部候选。</p>
<h2>两人同区，均未死亡</h2>
<p>BTX 回合结束强制能力结算时，A、B 都存活。示例将两人的有效身份各限为平民、杀人狂、时间旅者，逐格检验这条观测。剧本身份配额另行判定。</p>
${matrix('仅 A、B 同区，均无守护', 0, 'complete')}
${matrix('仅 A、B 同区，B 在结算前有一枚守护', 1, 'complete')}
${matrix('同区还有一名存活的平民 C', 0, 'complete', true)}
${matrix('两人同区，观察记录尚未完整', 0, 'partial')}
<p>守护示例只确认无人死亡，允许守护被消耗。死亡按结算时点观察，即使稍后复活，该次死亡依然已经发生。</p>
<h2>其他已验证的推断</h2><ul>
<li>MC 投毒者在日末达到 Ex 门槛，且已确认本轮仍可发动时，必须选择一名合法目标。无人死亡只要求存在一个能活下来的合法目标。程序将全部合法目标放入同一条约束，保留选择不死者的分支。</li>
<li>WM 的目击者有效不安达到 4 时，日末强制能力对自己提出死亡请求。确认本人未死，且没有守护、不死或可能代死时，可排除目击者。</li>
<li>BTX 的亲友若在轮回末已死，强制能力会公开身份。完整结算中没有该角色的身份公开，可排除其当时为亲友。</li>
<li>LL 的密钥死亡后有强制公开身份的反应。只有确认该角色的死亡反应已结算，才能用缺少公开来排除密钥。</li></ul>
${inventoryHtml()}<h2>构建与复现</h2>
<p><code>buildAbsenceSpace(pack, window, candidates)</code> 接受规则包、强制结算开始时的盘面、观察覆盖情况及明确缺席的现象。候选是该时点的有效身份。返回值保留身份域和带来源的禁止组合；<code>absenceSolutions(space)</code> 按需枚举满足全部约束的组合。</p>
<p>本入口独立于实时解空间。局部关系读取规则包中强制身份和角色能力的首步，支持可由公开盘面确认的条件、对自身或遍历目标的死亡与身份公开。可选能力、未确定的条件、私下可选代死和特殊区域能力保留可能解释；存在剧本特规时暂停该窗口的剪枝。对普通日末，可用 <code>observeDayEnd(entry, reports)</code> 从连续的阶段边界和公告中提取缺席现象；缺号、提前结束或尚未收到下一边界时保留候选。AHR、HSA 有日末前置结算，须另行提供强制能力实际开始时的盘面。全时点入口 <code>solveAbsence</code> 将局部约束与有限隐藏补全交给阶段核验器 <code>verifyAbsencePhase</code>，按规则内核处理主副线、事件、可选行动、多步、延迟和替代结算。其他反应窗口由调用方确认完整。初始身份、配额、复制能力及跨日变化需另行约束。</p>
<p>自动回归还从 8 个官方剧本的合法开局驱动首轮。固定种子为 1709，每个已闭合阶段均检查缺席证据保留真实剧本；把实际出现的公开结果改为缺席并重放相同决策，则必须得到冲突。</p><p>在仓库根目录运行 <code>pnpm check:absence</code> 可复核剪枝。运行 <code>pnpm exec tsx scripts/engine/absence-report.ts</code> 可重新生成本页。</p>
<p>规则依据 · <a href="../../${pack.identities['杀人狂']!.source}">BTX 杀人狂</a> · <a href="../../${pack.identities['时间旅者']!.source}">BTX 时间旅者</a> · <a href="../../${pack.identities['亲友']!.source}">BTX 亲友</a></p></main></html>`;

mkdirSync(new URL('../../products/engine/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../../products/engine/absence-space.html', import.meta.url),
  html.replace(/[ \t]+$/gm, ''),
);
