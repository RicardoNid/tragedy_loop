"""Render the current review from pinned evidence. Never writes facts/."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8"))
sources = read("packages/content/src/source-lock.json")["sources"]
cases = read("packages/content/src/review-cases.json")["cases"]
def esc(x):
    return html.escape(str(x))
def items(values):
    return "<ul>" + "".join("<li>" + esc(x) + "</li>" for x in values) + "</ul>"
def evidence(ids):
    parts = []
    for key in ids:
        s = sources[key]
        location = s.get("pointer") or f"第 {s['startLine']}—{s['endLine']} 行"
        provenance = s["provenance"]
        info = provenance["provider"] + " " + provenance.get("capturedAt", "")
        if provenance.get("cells"):
            info += " " + provenance["sheet"] + " / " + provenance["cells"]
        upstream = ""
        if s.get("upstream"):
            upstream = f'<p><a href="../../{esc(s["upstream"]["file"])}">上游本地快照</a></p>'
        parts.append(f'<div class="evidence"><b>{esc(key)}</b><p>{esc(s.get("question", ""))}</p><blockquote>{esc(s["excerpt"])}</blockquote><p><a href="../../{esc(s["file"])}">{esc(s["file"])}</a> · {esc(location)}</p><p>{esc(info)}</p><small>SHA-256：{s["sha256"]}</small>{upstream}</div>')
    return '<details><summary>展开原文、精确位置与来源版本</summary>' + "".join(parts) + "</details>"

decisions = read("packages/content/src/foundation-decisions.json")
questions = {d["caseId"]: d for d in decisions["decisions"]}
review = []
for key, decision in questions.items():
    c = next(c for c in cases if c["id"] == key)
    number, title = decision["id"], decision["title"]
    review.append(f'<section class="question" id="{number}"><span class="tag">用户已确认 · {number} / {key}</span><h2>{title}</h2><div class="proposal"><b>已采用的基础语义</b><p>{esc(decision["summary"])}</p></div><h3>具体初始状态</h3>{items(c["initial"])}<h3>预期过程与结果（尚未执行）</h3>{items(c["expectedProcess"])}{items(c["expectedResult"])}{evidence(c["sources"])}</section>')
known = []
for c in cases:
    if c["id"] in questions:
        continue
    pending = '<p>后续由我核对：' + esc("；".join(c["openQuestions"])) + '</p>' if c["openQuestions"] else ""
    known.append(f'<article><h3>{c["id"]} · {esc(c["title"])}</h3>{items(c["initial"])}{items(c["expectedProcess"])}{items(c["expectedResult"])}{pending}{evidence(c["sources"])}</article>')

rows = [
("对象与范围", "玩家、角色卡、存活角色、尸体、未登场/移除；区域与版图；规则及能力实例、所属版本。", "我按通则和例外整理。远方不是第五张版图；资料收录不等于本局生效。"),
("状态与读数", "实际指示物与有效计数；初始/当前身份与获得能力；初始设定、当前状态及上轮快照。", "已决定的区别沿用；跨轮快照边界见 Q3。"),
("条件与目标", "主体资格、目标集合、是否含自身、选择数量、区域、读取时点及无目标时的处理。", "逐条核对。无目标与无变化不自动等同，不把某个能力的例外推广为通则。"),
("选择权与次数", "谁选择、能否放弃、次数归属、何时消耗/恢复、是否共享。", "我核对。讨论/不讨论模式按已确认决定执行，剧作家选择权不变。"),
("同时与先后", "共同快照、同批效果、新触发的后续、“随后”的新步骤。", "明确 FAQ 直接采用；一般收尾边界见 Q2。"),
("保护与替代", "死亡请求与实际死亡；重复请求、护卫资源、替代资格。", "双人案例已明确，推广到多人见 Q1。"),
("完成与结束", "声明、被拒绝、开始、来源完成、步骤收尾、轮回结束与整局结束。", "Q2 只决定轮回中断；LL 特殊胜利等仍单独核对。"),
("重置与保留", "哪些状态清除、恢复、保留或读取上轮；EX 与标志各自的规则。", "依 Q3 确定共同边界，具体字段由我整理。"),
("披露与知识", "公开内容、获知时点与所指时点；真实事件/公开名称；正式公开/推理确定。", "沿用主人公共享观察口径；相同规范化历史得到相同知识，不用真实秘密补未知值。"),
("冲突与例外", "来源优先级与游戏规则覆盖分开；例外只覆盖冲突部分。", "同层冲突无明确顺序时标记未支持；只提交影响结果且来源不足的案例。")
]
table = "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in row) + "</tr>" for row in rows)
document = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>基础规则定义 · 三项已确认裁定</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:#233832;font:16px/1.85 "Microsoft YaHei",sans-serif}header,main,footer{max-width:1080px;margin:auto;padding:28px}header{padding-top:48px}h1{font-size:34px;line-height:1.4}h2{font-size:25px;line-height:1.5}h3{font-size:18px}a{color:#11664d;overflow-wrap:anywhere}nav{display:flex;gap:10px 22px;flex-wrap:wrap;padding:16px 0}section{margin:26px 0;padding:24px 0;border-top:1px solid #cbd8d0}.question{background:white;padding:26px;border:1px solid #cbd8d0;border-radius:12px}.tag{font-size:13px;color:#7b4b10;background:#fff0cd;padding:5px 9px}.proposal{background:#eaf4ee;padding:16px 20px;border-left:4px solid #377b58}small{color:#586a62;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:12px;border:1px solid #d3ddd6;text-align:left;vertical-align:top}th{background:#e9eee7}.scroll{overflow:auto}details{margin:18px 0;border:1px solid #d3ddd6;padding:12px}summary{cursor:pointer;color:#11664d}.evidence{padding:18px 0;border-top:1px solid #d3ddd6;margin-top:14px;font-size:14px}blockquote{margin:10px 0;padding:12px 16px;background:#f5f5f0;white-space:pre-wrap}pre{overflow:auto;background:#203c31;color:#eef5ed;padding:20px;font-size:14px;line-height:1.8}article{margin:28px 0;padding-bottom:12px;border-bottom:1px solid #d3ddd6}li{margin:7px 0}@media(max-width:650px){header,main,footer{padding:18px}h1{font-size:28px}.question{padding:18px}table{min-width:600px}}@media print{body{background:white;font-size:10pt}nav{display:none}.question{break-before:page}h2,h3{break-after:avoid}pre{white-space:pre-wrap;color:black;background:#eee}}
</style></head><body><header><small>惨剧轮回 · 机器规则工作 · 2026-11-08</small><h1>先确定共同语义，<br>再组合出具体游戏规则</h1><p><strong>Q1—Q3 已全部确认。</strong>简单规则和来源明确的内容由我整理。已按你的回答记录项目裁定，原始回复与计数澄清保存在裁定记录中，未改写来源原文。</p><p>当前状态：3 项基础语义已确认；7 条首批机器定义；完整引擎尚未实现。规则及阅读体验待人类验收。</p><nav><a href="#foundation">基础定义分工</a><a href="#Q1">Q1 多人替死</a><a href="#Q2">Q2 中断收尾</a><a href="#Q3">Q3 跨轮快照</a><a href="#known">已有依据的案例</a><a href="#composition">如何组合</a></nav></header><main>
<section id="foundation"><h2>基础层定义什么，哪些需要你介入</h2><p>确定性指：相同规则版本、完整状态和明确选择得到相同结果；仍需玩家选择时，停在明确决策点。不能为得到唯一结果替玩家决定，也不能让程序遍历顺序代替规则。</p><div class="scroll"><table><thead><tr><th>基础语义</th><th>需要明确的信息</th><th>本轮分工</th></tr></thead><tbody>__TABLE__</tbody></table></div><p>这是起始清单，不宣称已审完全部官方内容。后续确有新语义时，补充具名操作及独立案例，不用任意回调绕过规则。</p></section>
__REVIEW__
<section><h2>裁定已记录</h2><p>Q1：可替多人死亡；两项替代加一项自身请求，共三项。Q2、Q3：采用 A。无需重复确认。</p><p><a href="../../packages/content/src/foundation-decisions.json">项目裁定及结构化基础语义</a>保留原始回复和补充澄清。后续引擎按这些语义组合规则；目前已更新定义与独立预期，尚未执行完整结算。</p></section>
<section id="known"><h2>已有依据，由我直接整理的核对案例</h2><p>以下供你抽查，不是另一批必须逐条回答的问题。预期根据原文手工整理，未从执行代码反向生成。</p>__KNOWN__</section>
<section id="composition"><h2>后续引擎怎样组合这些基础规则</h2><p><strong>基础对象与操作 → 共同结算规则 → 具体游戏内容。</strong>通则集中定义，具体规则引用通则并补充参数及例外。</p><h3>例：传谣人</h3><pre>主体：当前拥有该能力的在场存活角色 A
时点：剧作家能力阶段，强制处理完成后
选择者：剧作家，可不发动
目标：与 A 同区的 1 名存活角色 B，允许 B = A
读取：本次效果开始时的目标资格与状态
基本转移：B.实际不安 := B.实际不安 + 1
其他基础字段：不由这项加法改变
后续：更新受影响的常驻状态，按共同规则处理触发
次数：通常每能力每对应阶段一次，具体版本例外另列
披露：公开指示物变化，不主动暴露隐藏能力来源</pre><p>流言四起复用加指示物操作，但主体是 X 槽位的规则实例，目标是版图，写入密谋，次数是每轮回。复用操作不等于合并版本或次数记录。</p><p>FS 只有一个 X 槽位属于配置约束，不必伪装成状态转移。死亡替代必须经过 Q1/Q2 的共同语义。基础操作、配置约束与披露共同构成机器定义。</p></section>
<section><h2>当前产物与验证边界</h2><p>本地清单盘点含 12 个官方模组条目、37 个官方角色条目（含仙人、UP主），十周年单独登记。BT/BTX/BTX Plus、HS/HSA、AH/AHR 保持独立。数字表示本地分类清单，不证明全部出版版本均已核对。</p><p>首批 7 条包括 FS 两项设置、FS/BTX 流言四起、FS/BTX 传谣人及 BTX 邪气污染效果。5 条效果片段已解除 R03 的语义阻塞，并引用已确认的 Q2；预览器只校验目标并生成请求，尚不执行完整生命周期。</p><ul><li><a href="../../packages/content/src/first-batch.ts">首批机器定义</a>、<a href="../../packages/engine/src/rule-definition.ts">最小规则结构</a></li><li><a href="../../packages/content/src/source-lock.json">原文与版本锁定</a>、<a href="../../packages/content/src/coverage.json">目录盘点</a>、<a href="../../packages/content/src/review-cases.json">独立预期与未决案例</a></li><li><a href="../../tests/rules/first-batch.test.ts">资产与效果片段检查</a>：pnpm check:rules。完整游戏及特殊交互案例尚未执行。</li></ul><p>用本地文件 SHA-256 和可用的采集时间锁定来源，不把采集日期冒充官方出版版本号。字段按 wiki &gt; lloyd &gt; ricardo 选源；来源列表含 wiki 不代表正文必然来自 wiki。FS 最终决战冲突已按高优先级正文选“没有最终决战”。</p><p>Q1—Q3 相关案例已有用户确认，但不是已通过的引擎测试；其他内容仍按各自验收状态管理。共用内核枚举只能检查一致性，不能单独证明翻译正确。未支持不等于不可能。</p><p>facts/、archive/ 和总方案保持不动；AGENTS.md 的其他未提交修改保留。</p></section>
</main><footer>当前有效裁定稿 · 已同步机器定义与对应案例。自动检查不能代替规则与阅读体验的人类验收。</footer></body></html>"""
document = document.replace("__TABLE__", table).replace("__REVIEW__", "".join(review)).replace("__KNOWN__", "".join(known))
document = document.replace('</main>', '<section><h2>本次验证记录</h2><p>2026-11-08：规则类型检查及 12 项资产/效果片段与裁定引用检查通过；首版页面的 3 个审阅题、68 个本地引用与锚点、原文展开、桌面及 390px 窄屏布局检查通过，并查看了页面截图。截图检查不代替人类阅读验收。</p><p>全局格式检查未通过：另有 11 个未由本任务修改的配置文件存在格式差异；本任务修改的根配置格式检查已通过。未报告完整应用、完整引擎或特殊结算案例测试通过。</p></section></main>')
output = ROOT / "docs/rules/first-batch-review.html"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(document, encoding="utf-8")
print(output)

