"""Build a local, source-linked rule atlas from the authoritative Lunhui baseline."""
from pathlib import Path
from html import escape
from urllib.parse import quote
import re, json, hashlib
from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).parent
MD = MarkdownIt('commonmark', {'html': True}).enable('table')
BASE = 'https://main-bakafire.ssl-lolipop.jp/rooper/'
RULE = 'facts/sources/lunhui/tragedy_loop_game_rules(3)(1).md'
APP = 'facts/sources/lunhui/tragedy_loop_appendix(3)(1).md'
BOOK = 'facts/sources/lunhui/主人公之书(3)(1).txt'
FAQ = 'facts/sources/lunhui/在线FAQ流程复核（2026-09-22）.md'
POLICY = 'facts/canonical/source-policy.md'

def link(url, label):
    return f'<a href="{escape(url, quote=True)}">{escape(label)}</a>'
def local(path, label):
    assert (ROOT/path).is_file(), path
    return link('../../'+quote(path, safe='/'), label)
def web(path,label): return link(BASE+path,label)
def render(s):
    # Archived source documents contain stale relative links. Preserve their labels,
    # while the atlas supplies verified original-file links above each extract.
    s=re.sub(r'\[([^\]]+)\]\((?!https?://)(?:<[^>]+>|[^)])+\)',r'\1',s)
    return MD.render(s).replace('<table>', '<div class="table-wrap"><table>').replace('</table>', '</table></div>')
def section(sid,eyebrow,title,body):
    return f'<section id="{sid}"><div class="eyebrow">{eyebrow}</div><h2>{title}</h2>{body}</section>'
def detail(title,body): return f'<details><summary>{title}</summary><div class="detail-body">{body}</div></details>'
def table(headers,rows):
    return '<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+h+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+c+'</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table></div>'

appendix=(ROOT/APP).read_text()
parts=dict(re.findall(r'^### ([^\n]+)\n(.*?)(?=^### |^## |\Z)',appendix,re.M|re.S))
mods=[
('FS','First Steps','First Steps','first-steps',5,'基本盒 5th','入门：一条规则 X；简化剧本结构。'),
('BTX','Basic Tragedy Χ','Basic Tragedy X','basic-tragedy-x',4,'基本盒 5th','标准基础：规则 Y/X、身份、事件与最终决战。'),
('MZ','Midnight Zone','Midnight Zone','midnight-zone',7,'扩展 0','谎言与情报；使用 EX 牌表达额外状态。'),
('MCΧ','Mystery Circle Χ','Mystery Circle','mystery-circle',2,'扩展 1Χ','事件与犯人；本地整理使用事件累计的 EX 槽。'),
('HSA','Haunted Stage A','Haunted Stage Again','haunted-stage-a',9,'扩展 2A','死亡与怪物；牺牲者、尸体、群众事件及诅咒。'),
('WM','Weird Mythology','Weird Mythology','weird-mythology',8,'扩展 2B','绝望与抵抗；旧日魔术、EX 累计与友好拒绝。'),
('AHR','Another Horizon R','Another Horizon Revised','another-horizon-r',11,'惨劇RoopeR 〇','两个世界；表里身份、世界移动与心境反转。'),
('LL','Last Liar','Last Liar','last-liar',10,'惨劇RoopeR 〇','背叛与决战；私人 A/B/C、已沟通/已死亡标志及特殊胜利。')]

pieces=[]
pieces.append(section('map','01 / STRUCTURE','一套规则，六个组成层', '''<p class="lead">模组决定“可以使用哪些规则”，剧本决定“这一局具体发生什么”。只收齐模组速查表，仍缺完整流程、角色例外、剧本秘密表与后续裁定。</p><div class="layers">'''+''.join(f'<a href="#{target}"><span>0{i}</span><strong>{name}</strong><small>{desc}</small></a>' for i,(target,name,desc) in enumerate([
('core','通用流程','开局 → 每日九阶段 → 轮回结束 → 最终决战'),('components','公共组件','版图、角色、行动牌、指示物、EX 与标志'),('modules','惨剧集 / 模组','特殊规则 + 规则 Y/X + 身份 + 事件'),('scripts','剧本 / 剧本集','公开表 + 非公开表 + 教学或主持说明'),('rulings','勘误与裁定','语言、版次、问题编号与采纳依据'),('coverage','版本与覆盖','现行 / 历史 / 译版 / 项目整理的边界')],1))+'</div><p class="source">结构依据：'+local(RULE,'本地规则正文 §2、§4、§6')+' · '+local(APP,'本地附录 A/B/C')+' · '+web('sr_dl_03_set.htm','官方惨剧集目录')+' · '+web('sr_dl_02_syn.htm','官方剧本与表格目录')+'</p>'))

core_blocks=[
('目标与席位','一名剧作家对一至三名主人公。主人公尝试在有限轮回内避免失败；满足最终决战条件时还可推理身份争取胜利。本地流程正文限定标准四人，不能替代两人/三人变体。','§1、§5'),
('开局与剧本','先选定完整剧本和模组，摆放版图与角色，分离公开表和秘密表。规则 Y/X、角色身份、事件当事人等由剧作家掌握；具体公开边界以所用版本为准。','§2'),
('轮回开始','按剧本初始状态复位角色和通常指示物，回收限次行动牌，应用轮回开始效果。扩展可能保留 EX、知识或跨轮标志，不可一概全部清零。','§3'),
('行动与能力','行动牌暗置后公开并结算；移动、禁止、指示物增减、限次及回收分别处理。公开角色友好能力与隐藏身份能力属于不同规则来源。','§4.3–§4.7'),
('事件与失败','在指定日期检查事件当事人及条件，再处理效果；事件发生不等于一定产生可见变化。立即失败、日末失败、轮回结束失败需要区分。','§4.8、§5'),
('全局交互','角色与尸体、死亡与离场、替代效果、同时效果、后续步骤、次数、信息公告和最终身份推理共同构成边界规则；有争议的细化保留为项目裁定。','§4.1、§6–§8')]
body='<div class="two-col">'+''.join(f'<article><h3>{n}</h3><p>{d}</p><p class="source">'+local(RULE,'本地规则 '+ref)+'</p></article>' for n,d,ref in core_blocks)+'</div>'
body+='<h3>每日九阶段 · 本地四人流程</h3><ol class="flow">'+''.join('<li>'+x+'</li>' for x in ['回合开始','剧作家行动','主人公行动','行动结算','剧作家能力','主人公能力','事件','队长交替','回合结束'])+'</ol>'
body+='<p class="source">'+local(RULE,'正文 §4')+' · '+web('10th/dl/protagonist_rulebook.pdf','原作者 5th《主人公之书》49 页 PDF')+' · '+local(BOOK,'本地《主人公之书》中文文本')+'</p><p class="notice">以下为用户指定的项目权威来源：Lunhui 整理全文及已确认裁定。项目规则解释以此为基线；外部原件用于溯源和补缺。源文件的失效旧链接在本页转为文本，原文件保持不变。</p>'
body+=detail('展开本地规则正文：流程、结算、胜负与术语全文',render((ROOT/RULE).read_text()))
pieces.append(section('core','02 / CORE','通用规则与一局游戏的运行',body))

comp=[('版图与位置','医院、神社、都市、学校；初始位置、禁行区域与特殊区域。'),('角色卡','公开身份之外的角色名、属性、不安限度、初始地点、特性和友好能力。角色与剧本赋予的“身份”不是同一对象。'),('行动牌','双方暗置的移动、指示物增减与禁止牌；区分常规回收、每轮限次及额外牌。'),('指示物与状态','友好、不安、密谋，以及扩展的希望/绝望、EX 牌/槽、尸体、世界和跨轮标志。'),('身份与事件','身份通常由剧本秘密指定；事件由模组定义效果，剧本指定日程与当事人。')]
body=table(['组成','需要查什么'],comp)+'<p class="source">'+local(APP,'本地附录 A（行动牌）、B（身份/事件）、C（角色）')+' · '+web('sr_dl_04_sozai.htm','作者 Commons 卡牌/版图素材原始入口')+'</p>'
a=appendix.split('## 附录A：手牌表',1)[1].split('## 附录B',1)[0]
c=appendix.split('## 附录C：角色表',1)[1]
body+=detail('行动牌与希望／绝望通则 · 本地附录 A',render(a))
body+=detail('37 张角色的属性、特性与友好能力 · 本地附录 C',render(c))
body+='<p class="muted">“37 张角色、46 项友好能力、82 条按模组计的事件”是现有项目盘点的口径，不是系列官方全量分母；同名事件跨模组会重复计数。'+local('docs/archive/lunhui-engine/content-audit.md','查看盘点口径')+'</p>'
pieces.append(section('components','03 / COMPONENTS','组件与数据字典',body))

body='<p>官方目录列出 <strong>8 套现行惨剧集</strong>，另列 3 套旧版。本页逐套连接官方速查表，并展开本地附录中的特殊规则、规则 Y/X、身份和事件。本地规则内容统一采用 Lunhui 整理稿；外部材料保留出处，不自动覆盖本地裁定。</p><p class="source">'+web('sr_dl_03_set.htm','官方现行/历史分类原出处')+'</p><div class="filterbar"><label for="module-search">查找模组或规则词</label><input id="module-search" data-testid="module-search" type="search" placeholder="例如：背叛者、世界、Midnight"><span id="module-count" aria-live="polite">8 / 8 套</span><button id="clear-search" data-testid="clear-search">清除</button></div><div id="module-list">'
for short,official,name,slug,num,product,desc in mods:
    note='项目权威基线：Lunhui 整理稿。外部版本名称仅作溯源。'
    pdf=f'pdf/summary_{num:03}.pdf'
    body+=f'<article class="module" id="module-{slug}" data-testid="module-{slug}"><div class="module-heading"><span class="code">{short}</span><div><h3>{official}</h3><p>{product} · {desc}</p></div></div><div class="tags"><span>Lunhui 权威整理 · 四类正文</span><span class="warn">{note}</span></div><p class="source">'+web(pdf,'官方速查 PDF')+' · '+web('sr_dl_03_set.htm','官方目录出处')+' · '+local(APP,'Lunhui 附录原文件')+'</p><p class="muted">外部参考 PDF：'+('上轮 Edge 已完整显示单页。' if short=='BTX' else '下载链接已从官方目录取得，尚未逐页核验。')+'</p>'+detail('展开特殊规则、Y/X、身份、事件 · 本地整理全文',render(parts[name]))+'</article>'
body+='</div><p id="no-results" hidden>没有匹配的模组；请更换关键词。</p><h3>历史惨剧集 · 与现行版本分开</h3>'+table(['旧版名称','官方原件','本地覆盖'],[(n,web(f'pdf/summary_{i:03}.pdf','旧版速查 PDF'),'未发现独立的完整旧版模组资料；不得拿现行 X/A/R 版静默替代。') for n,i in [('Basic Tragedy',1),('Haunted Stage',3),('Another Horizon',6)]])
body+='<p class="notice">速查表不等于扩展说明书或扩展剧本。扩展 0、1、2A、2B 在作者产品页另有 DLsite 下载销售入口；〇 的 LL/AHR 也需要相应说明与剧本材料。'+web('sr_game_03_component.htm','产品原出处')+' · '+web('10th/rei.html','〇 产品说明')+'</p>'
pieces.append(section('modules','04 / TRAGEDY SETS','八套模组 · Lunhui 权威整理',body))

body='<p class="lead">一份剧本，是模组的一次具体配置；一本剧本集，是多份剧本及主持说明的集合。规则表无法还原剧本的秘密配役。</p>'+table(['部分','应包含的信息','查阅对象'],[
('公开表','所用模组、轮回/天数、事件日程、公开特殊条件。','全体玩家'),('非公开表','规则 Y/X、身份分配、初始特别设置、事件真实内容与当事人、秘密条件。','剧作家；含剧透'),('主持/教学说明','难度、教学顺序、故事与策略、可能解法及说明。','通常由剧作家阅读')])+'<p class="source">'+local(RULE,'本地正文 §2.2')+' · '+web('sr_dl_02_syn.htm','官方公开/非公开表模板出处')+'</p>'
body+='<h3>商业剧本集与盒内剧本</h3>'+table(['资料','已确认范围','取得状态 / 原出处'],[
('基本盒《脚本家之书》','官方 5th 介绍列出 10 作；教学与主持材料不能用《主人公之书》替代。','本地未发现整本。'+web('10th/whats.html','5th 官方介绍')+' · '+web('10th/quickset.html','官方体验包入口')+' 可定位首个教学剧本。'),
('惨劇RoopeR 脚本集 I','官方公告：30 个剧本；88 页，附 2 个角色。','找到官方说明；未取得整本。'+link('https://bakafire.main.jp/rooper/sr_news_200601.htm','脚本集公告')+' · '+link('https://bakafire.main.jp/rooper/sr_game_03_component_cos.htm','第一册产品说明')),
('惨劇RoopeR 脚本集 II','官方公告：52 个剧本（50 个竞赛作品 + 2 个新角色示例），附 6 个角色。','找到官方说明；未取得整本。'+link('https://bakafire.main.jp/rooper/sr_news_200601.htm','脚本集公告')),
('各扩展与〇附属剧本','应按扩展产品逐一建清单；不把速查表算作剧本。','本地未发现完整的逐产品剧本档案。'+web('sr_game_03_component.htm','扩展目录')+' · '+web('10th/rei.html','〇 原出处')),
('New Tragedies 英文版','WizKids 产品页列出 13 剧本、30 角色；保持独立版次。',link('https://shop.wizkids.com/products/tragedy-looper-new-tragedies','英文出版商原出处')+'；全文覆盖未验证。')])
body+='<p class="muted">各产品、征选集与免费投稿可能重叠；未核对重复关系，不能将数量直接相加为去重总数。</p>'
body+='<h3>官网公开投稿剧本 · 14 项</h3><p>作者官网托管的旧 <strong>Basic Tragedy</strong> 投稿目录；不是官方商业剧本集 I/II 的全文，也不自动适用于 BTX。以下链接可能直接显示秘密配役与解法。</p><p class="source">'+web('sr_dl_02_syn.htm','目录、作者与下载链接的原始出处')+'</p>'
names=['歪んだ独占欲','みんな死ぬしかないじゃない！','ピタゴラスイッチ','心を無くした三人','脚本家の箱庭','カゲロウデイズ','隠された真実','対岸の火事','ドジっ子退魔師の迷走','逃げて！ 少女超逃げて！','手中','魔女化した魔法少女(ver.2)','病院事件多発中','ピタゴラスイッチ２']
authors=['秋山真琴','村山斬','秋山真琴','入穂','Eber','RooP','Sieg_Ribbon','krbysh','RooP','RooP','syunsann','秋山真琴','秋山真琴','秋山真琴']
body+=detail('展开 14 项剧本原件入口（含剧透）',table(['剧本','作者','PDF 验证状态'],[(web(f'pdf/toukou_{i:03}.pdf',n),authors[i-1],'Edge 已完整显示单页；含公开/非公开表与主持说明。' if i==1 else '已从官网取得链接；本次未逐页读取。') for i,n in enumerate(names,1)]))
body+='<h3>Lunhui 剧本示例</h3>'+table(['来源','现有内容','边界'],[
(local('packages/content/src/index.ts','Lunhui firstStepsScenario()'),'FS 演示：3 轮 × 4 天。','保留为项目示例；商业剧本集全文尚未取得。')])
body+='<p class="source">空白模板：'+web('pdf/syn_seat.pdf','标准公开/非公开表')+' · '+web('pdf/syn_seat_ah.pdf','旧 Another Horizon 表')+' · '+web('pdf/syn_seat_hs.pdf','旧 Haunted Stage 表')+'。模板本身不是成品剧本。</p>'
pieces.append(section('scripts','05 / SCRIPTS','剧本、剧本集与可玩配置',body))

body=table(['证据层','内容与使用边界','原始出处 / 本地材料'],[
('原作者 FAQ / 勘误','基础与角色、事件、规则 X/Y 裁定；包含历史条目，必须核对适用版本。',web('sr_game_02_rule.htm','BakaFire 官方 FAQ')),
('中文 QA 汇编','本地 2026-09-22 报告记录 394 条问答及单元格定位；本轮未重新逐条验证线上内容，也未确认每条设计师原始出处。',link('https://docs.qq.com/sheet/DQWN4bEZ6UnF3b3BR?tab=000001','腾讯表原始入口')+' · '+local(FAQ,'本地读取与复核记录')),
('项目裁定','流程稿与引擎裁定使规则可执行，但不是作者原文。不能用实现或测试数量证明官方规则完整。',local('docs/archive/lunhui-engine/rulings.md','项目裁定登记')+' · '+local('facts/sources/lunhui/步骤结算流程（独立稿）.md','结算流程稿'))])
body+='<h3>已有记录指出的冲突 · 本轮未改写规则</h3><ul><li><strong>希望牌除外范围：</strong>正文“该牌”与附录“所有人的希望牌”不同。</li><li><strong>御神木时点：</strong>正文强制批次与附录可选择时机的文字不同。</li><li><strong>被拒绝的轮限能力：</strong>旧日文 FAQ Ch10 与当前本地中文口径不同，必须保留版次/更新依据。</li><li><strong>六级优先顺序：</strong>项目的细分层级尚不能仅由官方“特殊优先、禁止优先”两条原则证明。</li></ul><p class="source">'+local('facts/working/lunhui/规则完整性分析-2026-09-27.md','本地完整性分析（含具体定位）')+' · '+local(APP,'附录原文')+' · '+local(RULE,'正文原文')+' · '+web('sr_game_02_rule.htm','作者 FAQ')+'</p>'
pieces.append(section('rulings','06 / RULINGS','裁定与版本差异也属于规则资料',body))

body='<p class="notice"><strong>当前规则权威：Lunhui 整理结果。</strong>本页的规则正文、行动牌、角色、模组、身份、事件与项目裁定均以该来源为基线。外部站点用于原始出处、版本记录与未收录剧本的补充研究。</p>'+table(['权威材料','已覆盖内容','保留的边界'],[
(local(RULE,'Lunhui 规则正文'),'开局、每日九阶段、轮回结束、最终决战、结算与术语。','内部文字冲突继续登记，不由外部旧版文本自动改写。'),
(local(APP,'Lunhui 附录'),'八套模组、行动牌、身份、事件与角色表。','本页采用当前整理稿；后续补充统一纳入该体系。'),
(local(FAQ,'Lunhui FAQ 复核'),'已读取的中文问答及裁定来源定位。','项目采纳结果与其历史外部出处分别保存。'),
(local('docs/archive/lunhui-engine/rulings.md','Lunhui 项目裁定'),'已确认的结算与执行约定。','源码和测试是实现证据，不自行产生新规则。')])
body+='<p class="source">'+local(POLICY,'规则来源选择与后续使用约定')+' · '+local('docs/archive/lunhui-engine/content-audit.md','Lunhui 内容盘点')+'</p>'
body+='<h3>仍需补充的资料</h3><ul><li>商业剧本集 I/II、基本盒及扩展剧本的完整目录与正文。</li><li>Lunhui 尚未收录的历史版本及少人玩法，作为明确标注的新增范围。</li><li>Lunhui 整理稿内部的文字同步与原始出处定位。</li></ul><p class="muted">权威来源选择已经确定；页面交互与排版仍待人类验收。选定基线不表示缺失的剧本内容已经取得。</p>'
pieces.append(section('coverage','07 / BASELINE','Lunhui 权威基线与补充范围',body))

body='<p>每个板块的 Lunhui 链接指向项目权威整理；作者和出版商链接保留为外部溯源与补缺参考。PDF 可以由 Edge 打开，即使 Web 文本工具无法解析。链接存在、文件可读、内容逐条校对是三个不同状态。</p><ul><li>'+local('facts/research/tragedy-looper-authoritative-sources-2026-09-27.md','第一轮网络访问核验')+'</li><li>'+local('facts/research/tragedy-looper-modules-scripts-source-audit-2026-09-27.md','第二轮：全部模组、剧本集与官方投稿来源审计')+'</li><li>'+local(POLICY,'当前规则来源约定')+'</li></ul><p class="muted">本页直接从本地正文和附录生成。下方清单记录生成输入的 SHA-256，便于重新核对来源；未下载/重发布官方商业原件，未更改规则或运行引擎测试。</p>'
manifest={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in [RULE,APP,BOOK,FAQ,POLICY]}
body+=detail('本地生成输入与指纹', '<pre>'+escape(json.dumps(manifest,ensure_ascii=False,indent=2))+'</pre>')
pieces.append(section('sources','08 / SOURCES','出处与核验方法',body))

style='''*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;color:#253735;background:#f4f3ed;font:16px/1.8 system-ui,-apple-system,"Noto Sans CJK SC",sans-serif}a{color:#116b67;text-underline-offset:4px}a:hover{color:#9a561c}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #c58331;outline-offset:4px}.shell{max-width:1510px;margin:auto;display:grid;grid-template-columns:235px minmax(0,1fr);gap:60px;padding:42px 48px}.sidebar{position:sticky;top:32px;align-self:start}.brand{font-size:19px;font-weight:800;letter-spacing:.1em;border-top:4px solid #174f4b;padding-top:16px}.sidebar p{font-size:12px;color:#647773}.sidebar nav{display:grid;gap:6px;margin-top:36px}.sidebar nav a{text-decoration:none;border-bottom:1px solid #d6ddd5;padding:9px 0;color:#39534e;font-size:14px}.sidebar nav a span{display:inline-block;color:#83938b;width:30px;font-size:12px}main{min-width:0}.hero{padding:40px 0 44px;border-bottom:1px solid #bfcac0}.eyebrow{font-size:11px;letter-spacing:.2em;color:#537c73;font-weight:800}.hero h1{font-size:clamp(36px,4vw,58px);letter-spacing:-.04em;line-height:1.25;margin:18px 0}.hero .lead{max-width:750px}.lead{font-size:19px;line-height:1.9;color:#49645d}.stats{display:flex;flex-wrap:wrap;gap:36px;margin-top:30px}.stats b{font-size:28px;color:#174f4b}.stats span{font-size:12px;display:block;color:#5d716b}.badge{display:inline-block;padding:2px 10px;background:#e5eadf;color:#4d6758;font-size:12px;margin-right:8px}section{padding:48px 0;border-bottom:1px solid #cbd4c9}h2{font-size:29px;line-height:1.4;margin:10px 0 25px}h3{font-size:19px;margin:28px 0 12px}h4{font-size:17px}p{margin:14px 0}.muted{font-size:14px;color:#66776e}.source{font-size:13px;line-height:2.2}.source a{margin-right:7px}.notice{border-left:3px solid #bc843a;padding:13px 18px;background:#eee9dc;color:#685431;font-size:14px}.layers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:28px 0}.layers a{display:block;text-decoration:none;border-top:2px solid #4c7b70;padding:16px 0}.layers span{font-size:12px;color:#78938a}.layers strong{display:block;font-size:19px;color:#254e44}.layers small{display:block;color:#63766c;font-size:13px}.two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 30px}.two-col article{border-top:1px solid #d4dcd0}.flow{display:flex;flex-wrap:wrap;gap:8px;list-style-position:inside;padding:0}.flow li{padding:9px 13px;background:#e3eadd;font-size:13px}.table-wrap{overflow-x:auto;max-width:100%;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.8}th{text-align:left;background:#e4eadf;color:#345549;font-size:12px;letter-spacing:.02em}th,td{vertical-align:top;padding:12px 14px;border-bottom:1px solid #d1dacd;min-width:100px}td{overflow-wrap:anywhere}details{margin:16px 0;border-top:1px solid #c9d5c7;border-bottom:1px solid #c9d5c7}summary{cursor:pointer;padding:16px 4px;color:#215e50;font-weight:650;font-size:14px}.detail-body{padding:0 10px 22px}.detail-body h1{font-size:27px}.detail-body h2{font-size:24px}.detail-body table{min-width:640px}.detail-body blockquote{border-left:3px solid #9caf97;margin-left:0;padding-left:18px;color:#687b67}.filterbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:28px 0}.filterbar label{font-size:13px}input{font:inherit;padding:9px 12px;max-width:100%;background:#fffef8;border:1px solid #99ad9a;border-radius:4px}button{font:inherit;font-size:13px;padding:9px 15px;background:#174f4b;color:white;border:0;border-radius:4px;cursor:pointer}#module-count{font-size:13px;color:#596f62}.module{border-top:1px solid #bfcebd;padding:22px 0;scroll-margin-top:20px}.module-heading{display:flex;gap:20px;align-items:baseline}.module-heading h3{margin:0}.module-heading p{margin:4px 0;font-size:14px;color:#57705f}.code{font-size:16px;font-weight:800;color:#2e7564;min-width:57px}.tags{display:flex;flex-wrap:wrap;gap:8px}.tags span{background:#e6ecdf;font-size:11px;padding:2px 9px}.tags .warn{background:#eee6d5;color:#785d33}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#e6eadf;padding:18px}code{font-size:.9em}footer{padding:35px 0;color:#7a887b;font-size:12px}[hidden]{display:none!important}@media(max-width:1050px){.shell{gap:30px;padding:28px;grid-template-columns:180px minmax(0,1fr)}.layers{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.shell{display:block;padding:20px}.sidebar{position:static}.sidebar nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:15px 0}.sidebar nav a{font-size:12px;padding:4px}.sidebar nav a span{width:23px}.sidebar p{display:none}.hero{padding-top:22px}.two-col{grid-template-columns:1fr}.stats{gap:22px}.layers{gap:14px}.layers strong{font-size:16px}section{padding:32px 0}h2{font-size:25px}.module-heading{gap:10px}.filterbar input{width:100%}.notice{padding:10px 13px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{.sidebar,.filterbar,button{display:none}.shell{display:block;padding:0}body{background:white}section{break-inside:avoid}.table-wrap{overflow:visible}}'''
nav=[('map','规则组成'),('core','通用流程'),('components','组件与角色'),('modules','全部模组'),('scripts','剧本与剧本集'),('rulings','裁定与冲突'),('coverage','权威基线与补充'),('sources','来源与方法')]
html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>惨剧轮回 · 规则与剧本资料全景</title><style>'+style+'</style></head><body><div class="shell"><aside class="sidebar"><div class="brand">惨剧轮回<br>RULE ATLAS</div><p>规则 · 模组 · 剧本 · 出处<br>Lunhui 权威基线 / 外部出处参考 / 2026.09.27</p><nav aria-label="章节导航">'+''.join(f'<a href="#{i}"><span>{n:02}</span>{t}</a>' for n,(i,t) in enumerate(nav,1))+'</nav></aside><main><header class="hero"><div class="eyebrow">TRAGEDY LOOPER / SOURCE-LINKED FIELD GUIDE</div><h1>规则由什么组成，<br>资料究竟齐到哪里。</h1><p class="lead">把基础流程、八套现行模组、历史版本和剧本资料放回同一张地图。每一层都能追溯出处，每一处缺口都明确保留。</p><span class="badge">Lunhui · 项目权威来源</span><span class="badge">待人类验收</span><div class="stats"><div><b>8 + 3</b><span>官方目录 · 现行 + 旧版模组</span></div><div><b>14</b><span>官网托管投稿剧本入口</span></div><div><b>I / II</b><span>商业剧本集 · 正文尚未取得</span></div></div></header>'+''.join(pieces)+'<footer>原作：惨劇RoopeR / BakaFire Party。此页为本地研究与资料导航，不是官方规则修订。公开资料与项目整理按各自来源标注。</footer></main></div><script>const input=document.getElementById("module-search"), modules=[...document.querySelectorAll(".module")];function filter(){const q=input.value.trim().toLocaleLowerCase();let count=0;modules.forEach(m=>{m.hidden=!m.textContent.toLocaleLowerCase().includes(q);if(!m.hidden)count++});document.getElementById("module-count").textContent=count+" / 8 套";document.getElementById("no-results").hidden=count!==0}input.addEventListener("input",filter);document.getElementById("clear-search").addEventListener("click",()=>{input.value="";filter();input.focus()});</script></body></html>'
(OUT/'index.html').write_text(html)
(OUT/'source-manifest.json').write_text(json.dumps({'generated_date':'2026-09-27','authority':'lunhui','external_sources_role':'provenance_and_supplement','inputs':manifest},ensure_ascii=False,indent=2)+'\n')
print('Built',OUT/'index.html',len(html.encode()),'bytes')
