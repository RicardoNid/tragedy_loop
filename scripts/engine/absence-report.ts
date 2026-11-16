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
<h2>六类观测怎样约束同一份剧本</h2>
<table><thead><tr><th>观测</th><th>检查时点与可排除的组合</th></tr></thead><tbody>
<tr><th>① 事件发生与否</th><td>按日期和公开名称匹配事件公告。用实际当事人、指示物、身份和同区角色判定。手下已关闭事件，或另一名同区预言家仍存活时，即使当事人为强迫症也可解释事件未发生。</td></tr>
<tr><th>② 事件发生后的现象</th><td>分别约束发生公告、无现象公告、角色变化和失败公告。医院无密谋、伪造事件初始区域密谋不足、谋杀选到不死者都有无现象分支。独处的亵渎杀人当事人必须选放密谋。</td></tr>
<tr><th>③ 已结算的任意能力</th><td>按发动者、能力和已知目标匹配同一个结算完成记录。巫女在神社移除一枚现有密谋；异界人击杀不死者时守护保留；鉴别员可在两个空目标间结算；职员必须公告，忍者可选择所报身份。</td></tr>
<tr><th>④ 行动卡和移动</th><td>完整翻牌限定每位出牌者的牌面与目标，同名手牌仍保留合法实体选择。移动方向合成后检查禁止区域；心无灵犀给禁止友好附加禁止移动。巫女在神社遇横、纵移动时留在原地。</td></tr>
<tr><th>⑤ 守护、代死及净变化</th><td>按同一批次的死亡请求和入口守护数结算。从者和大小姐同时各受一次死亡请求，从者只有一枚守护时仍会死亡。刑警提线木偶能先获得守护再耗掉，日末的世界移动仍须生效。</td></tr>
<tr><th>⑥ 跨阶段和跨轮回</th><td>每个观测必须沿同一条历史成立。可疑信件实际移动才会限制次日；疯狂之夜在事件发生时数丧尸；密钥在前两轮公开会限制次日剧作家张数；遗言与其他来源重合时下轮每位主人公只得到一张希望牌。</td></tr>
</tbody></table>
<p>完整公开翻牌可用 <code>{kind:'cards', placements}</code>。同一阶段可组合 <code>incident</code>、<code>ability-completed</code>、<code>report</code>（次数上下限）、<code>no-death</code> 和边界盘面 <code>character / board / ex / winner</code>。只填实际观测到的字段。角色终盘存活、整段未死亡及未出现角色变化公告，分别表达三种不同的事实。</p>
${inventoryHtml()}<h2>构建与复现</h2>
<p><code>buildAbsenceSpace(pack, window, candidates)</code> 接受规则包、强制结算开始时的盘面、观察覆盖情况及明确缺席的现象。候选是该时点的有效身份。返回值保留身份域和带来源的禁止组合；<code>absenceSolutions(space)</code> 按需枚举满足全部约束的组合。</p>
<p>本入口独立于实时解空间。局部关系读取规则包中强制身份和角色能力的首步，支持可由公开盘面确认的条件、对自身或遍历目标的死亡与身份公开。可选能力、未确定的条件、私下可选代死和特殊区域能力保留可能解释；存在剧本特规时暂停该窗口的剪枝。对普通日末，可用 <code>observeDayEnd(entry, reports)</code> 从连续的阶段边界和公告中提取缺席现象；缺号、提前结束或尚未收到下一边界时保留候选。AHR、HSA 日末边界含前置结算，整段缺席交给正向内核复核；拿到实际强制批次的入口时才能对该批次直接生成局部身份约束。</p>
<p><code>solveAbsence(pack, window, domains, {evidence, following, worlds, workPerRow})</code> 接受首段及连续后续阶段。未指定的合法选择按需分支，已知选择逐个重放。各候选的隐藏剧本补全由调用方提供。存在一个完整见证即可保留；预算耗尽、未穷尽补全或证据窗口不完整时，返回未知。引擎只在核验副本采集细化审计。</p>
<h2>复核方法</h2>
<p>旧版正向内核的 16 份整局记录来自提交 <code>dc78b0ad</code>。15 份与原有检查点完全一致。MZ-01G 剧作家胜利线的自白公开身份后，旧内核还会报告“没有任何现象”。逐步比较全部 101 个决策，修正这 4 条公告及后续编号后，状态与胜负完全一致。该例有独立的公告次数回归。</p>
<p>规则文字独立推算身份集合的测试位于 <code>tests/engine/absence-outcomes.test.ts</code>。同时杀人狂、守护和代死的对照按每种可达终盘比较整组身份，对照还包含不可达的事件、牌面、公告次数与跨轮回组合。测试末尾打印独立矩阵数、比较的身份组合数和翻牌剪枝开关的搜索步数。</p>
<p>另以 8 个官方剧本各运行 8 个固定种子直至胜负，逐阶段用真实决策复核。每个阶段都检查未出现的公告；有公开现象时再将一条实际公告改为缺席，验证相同决策下的矛盾。逐程序覆盖和独立规则推算分别计数。运行 <code>pnpm check:absence</code> 复核，运行 <code>pnpm exec tsx scripts/engine/absence-report.ts</code> 重新生成本页。</p>
<p>报告已验证桌面和移动宽度的表格显示。人工验收待完成。</p>
<p>规则依据 · <a href="../../${pack.identities['杀人狂']!.source}">BTX 杀人狂</a> · <a href="../../${pack.identities['时间旅者']!.source}">BTX 时间旅者</a> · <a href="../../${pack.identities['亲友']!.source}">BTX 亲友</a></p></main></html>`;

mkdirSync(new URL('../../products/engine/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../../products/engine/absence-space.html', import.meta.url),
  html.replace(/[ \t]+$/gm, ''),
);
