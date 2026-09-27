# 惨剧轮回规则：权威站点与全文访问核验

核验日期：2026-09-27（UTC；本机美国太平洋时间为 2026-09-26）。研究目标是找到可通过 Web 或已连接的 Edge 浏览器插件取得完整页面/文件的规则来源。这里只记录访问与来源核验，不宣称两套项目规则内核已经统一。

## 结论与使用顺序

优先使用 **BakaFire Party 原作者官网**：它同时提供日文 FAQ/勘误、分版本惨剧集索引、官方速查表和素材入口。已实测 **5th《主人公之书》49 页 PDF 可由 Edge 打开**（封面与末页正常显示）、官网 FAQ 可由 Web 和 Edge 读取、Basic Tragedy Χ 官方速查表可由 Edge 完整显示。这里的“完整”指某一公开页面或文件完整可读，**不等于已取得全系列所有商业规则书、剧本和卡牌**。[官方首页](https://bakafire.main.jp/rooper/sr_top.htm)、[FAQ 与勘误](https://bakafire.main.jp/rooper/sr_game_02_rule.htm)、[惨剧集索引](https://bakafire.main.jp/rooper/sr_dl_03_set.htm)

英语资料中，Z-Man 官方旧版 PDF 是权威来源候选，但本次 Web 请求超时，Edge 又出现证书域名不匹配错误，不满足当前“可用”标准。WizKids 官方商店适合确认 New Tragedies 的版本与内容范围，其产品介绍不能替代规则书。[Z-Man 玩家手册](https://images.zmangames.com/filer_public/bc/e8/bce8e73f-d200-4a9f-be90-b3c59b8bb330/zm7470_tragedy_looper_rules.pdf)、[WizKids 产品页](https://shop.wizkids.com/products/tragedy-looper-new-tragedies)

## 推荐参考入口

| 入口 | 权威性与内容范围 | 本次访问证据 | 可用性结论 |
| --- | --- | --- | --- |
| [官方 5th《主人公之书》](https://main-bakafire.ssl-lolipop.jp/rooper/10th/dl/protagonist_rulebook.pdf) | 作者官方基本版详细规则书 | Web 因文件超过 10 MiB 无法读取；Edge 正常打开 49 页 PDF，实查封面与最后一页，末页印刷页码 48，发行日期 2016-12-11 | **文件可用，核心规则首选**；需用 Edge PDF 截图读取，DOM 不提供正文，未逐页校对全部内容 |
| [BakaFire 官方 FAQ/勘误](https://bakafire.main.jp/rooper/sr_game_02_rule.htm)；[同站另一官方入口](https://main-bakafire.ssl-lolipop.jp/rooper/sr_game_02_rule.htm) | 作者自己的裁定；包含基础、行动牌、角色/身份、规则 X/Y、事件等 FAQ，以及按日期记载的修正 | Web 返回 473 行完整页面；Edge 插件打开并读取正文，无需登录 | **全文可用，裁定首选**；注意页面同时保留旧版和 α 版说明 |
| [官方惨剧集/速查表目录](https://bakafire.main.jp/rooper/sr_dl_03_set.htm) | 官方区分现行集、旧集和非官方集 | Web 正文可读但漏掉下载链接；Edge 成功取得 PDF 链接；Basic Tragedy Χ PDF 已完整显示单页 | **目录可用，已验证 BTΧ 全文**；其余文件不能继承该文件的核验结果 |
| [官方 Quick Set 下载入口](https://main-bakafire.ssl-lolipop.jp/rooper/10th/quickset.html) | 官方称提供可游玩「はじまりの脚本」所需内容的体验包，另介绍 5th 与扩展 | Web 与 Edge 正文完整可读；独立规则书已由 Edge 打开，ZIP 未解包 | **规则书可用，体验包内部清单尚未独立核验** |
| [惨剧 Commons 5th 与素材说明](https://bakafire.main.jp/rooper/sr_dl_04_sozai.htm) | 作者提供的角色/卡牌/棋盘等素材入口，含使用条件 | Web 与 Edge 正文可读；Edge 找到官方 ZIP 直链 | **说明页可用，ZIP 全包尚需独立验证** |
| [官方产品/扩展目录](https://bakafire.main.jp/rooper/sr_game_03_component.htm) | 作者明确给出四项扩展的 DLsite 下载销售入口 | Web 产品页可读；DLsite 链接本次 Web 打开失败 | **授权购买渠道可定位，购买后全文未验证** |
| [WizKids 官方 New Tragedies 产品页](https://shop.wizkids.com/products/tragedy-looper-new-tragedies) | 英文出版商，说明其新版/独立续作与收录范围 | Web 正文可读 | **版本资料可用，不是完整规则来源** |

### 官方速查表直链

以下链接由 Edge 对官方目录的实际读取获得。文件名编号不是新旧排序，使用时以惨剧集全名确定版本。[官方目录](https://bakafire.main.jp/rooper/sr_dl_03_set.htm)

| 目录分类 | 惨剧集 | 官方 PDF | 全文核验 |
| --- | --- | --- | --- |
| 现行 | First Steps | [summary_005.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_005.pdf) | 已取得链接，Web 未成功读取 |
| 现行 | Basic Tragedy Χ | [summary_004.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_004.pdf) | **Edge 完整显示 1/1 页**，含规则、身份、事件及人物表 |
| 现行 | Midnight Zone | [summary_007.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_007.pdf) | 链接已核验，文件待独立读取 |
| 现行 | Mystery Circle Χ | [summary_002.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_002.pdf) | 链接已核验，文件待独立读取 |
| 现行 | Haunted Stage A | [summary_009.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_009.pdf) | 链接已核验，文件待独立读取 |
| 现行 | Weird Mythology | [summary_008.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_008.pdf) | 链接已核验，文件待独立读取 |
| 现行 | Last Liar | [summary_010.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_010.pdf) | 链接已核验，文件待独立读取 |
| 现行 | Another Horizon R | [summary_011.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_011.pdf) | 已取得链接，Web 未成功读取 |
| 旧版 | Basic Tragedy | [summary_001.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_001.pdf) | 链接已核验，文件待独立读取 |
| 旧版 | Haunted Stage | [summary_003.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_003.pdf) | 链接已核验，文件待独立读取 |
| 旧版 | Another Horizon | [summary_006.pdf](https://main-bakafire.ssl-lolipop.jp/rooper/pdf/summary_006.pdf) | 链接已核验，文件待独立读取 |

速查表不是完整扩展册的同义词。官方十周年介绍另外说明扩展有样例剧本及下载销售入口；不能据速查表可读便称已收齐完整扩展。[官方扩展说明](https://main-bakafire.ssl-lolipop.jp/rooper/10th/whats.html)

### 基础规则与体验包

建议直接收藏 [5th《主人公之书》PDF](https://main-bakafire.ssl-lolipop.jp/rooper/10th/dl/protagonist_rulebook.pdf)。它从[官方 Quick Set 页面](https://main-bakafire.ssl-lolipop.jp/rooper/10th/quickset.html)给出，属于详细规则书。Edge PDF 阅读器报告 49 页并能导航到末页，已验证文件打开及两端页面渲染，未对每一页逐字校对。Web 报超过 10 MiB 是工具限制，不是站点要求登录。

同页另有 [Quick Set ZIP](https://main-bakafire.ssl-lolipop.jp/rooper/10th/dl/quickset.zip)。官方说明其覆盖首个剧本所需内容；本次未下载解包，不能承诺它包含完整商业《脚本家之书》或其他剧本。

### 素材包与在线版

[Commons 5th 官方 ZIP](https://main-bakafire.ssl-lolipop.jp/rooper/dl/tragedy_commons_5th.zip) 是 Edge 从官方页面读到的公开链接。该页将最近一次素材更新记为 2021-12-31，并列出卡牌、棋盘、计数物等类别。链接存在、说明可读和包已完整取得是三项不同结论；本次不能由前两项推导第三项。[素材说明与下载页](https://bakafire.main.jp/rooper/sr_dl_04_sozai.htm)

CCFOLIA 是官方认可的在线版本。作者 2025-02-19 公告明确说包含 5th 与部分推广/脚本集角色，同时将扩展另作后续追加说明；它不能据此被称为全扩展合集。本次 Web 打开商店仅得到需要 JavaScript 的应用壳，没有读取购买后内容。[作者公告](https://bakafire.main.jp/rooper/sr_news_250219.htm)、[CCFOLIA 商品页](https://ccfolia.com/games/zxItFiUBzDNsYeG2QGt9)

## 英文资料与排除项

- **Z-Man 玩家手册**：搜索索引识别为 Player’s Handbook，指向出版商官方 PDF，但本次直接 Web 打开超时，Edge 返回 `ERR_CERT_COMMON_NAME_INVALID`，未绕过证书检查。状态是“来源可信、本次访问未通过”，不能列入当前可用集合，也不是永久失效定论。[官方 PDF](https://images.zmangames.com/filer_public/bc/e8/bce8e73f-d200-4a9f-be90-b3c59b8bb330/zm7470_tragedy_looper_rules.pdf)
- **WizKids New Tragedies**：官方产品页确认它属于新版及独立续作，不能拿它与 Z-Man 旧版或日文 5th 不加区分地合并。本次没有核验到可直接读取的官方完整规则文件；规则主页 Web 无法打开，Edge 也未成功附着目标页面。[官方产品页](https://shop.wizkids.com/products/tragedy-looper-new-tragedies)
- **BoardGameGeek**：发现名为 WizKidsMichele 的账号上传的 New Tragedies rulebook 条目；本次打开文件页返回 403。账号名与文件元数据不足以证明当前可取得完整文件，因此暂不列入“全文已验证”。[文件条目](https://boardgamegeek.com/filepage/253444/tragedy-looper-new-tragedies-rulebook)
- **社区工具、Wiki、教程、玩家整理表**：适合找线索、交叉检查或导入候选数据，不作为作者裁定的替代。例如 deduction-sheet 项目明确自称社区项目，其仓库列有仍需修正的角色元数据与校验限制；不能因内容多就当作官方完整规则库。[项目首页](https://tragedy-looper.github.io/)、[项目源码与说明](https://github.com/Tragedy-Looper/tragedy-looper.github.io)

## 项目引用方式

建议先固定目标为日文 5th / Basic Tragedy Χ，或者明确指定英文版，再记录每一项来源的页面标题、版本、URL、取得日期和页码/FAQ 编号。官网本身明确区分 Basic Tragedy 与 Basic Tragedy Χ 等版本，FAQ 也含历史修订；版本差异应记录后裁定，不应把不同版本文本自动合并成一个规则。[官方版本目录](https://bakafire.main.jp/rooper/sr_dl_03_set.htm)、[历史 FAQ/修订](https://bakafire.main.jp/rooper/sr_game_02_rule.htm)

本次也未验证到满足同一标准的官方中文完整规则来源。中文社区译名与翻译可另作对照，不应据此宣称已找到中文权威全文。

对于公开网页，可直接用 Web 读取；当 Web 无法解析官方 PDF 时，本次已证明 Edge 插件能打开 49 页基础规则书（核验首末页，未逐页审校）和 BTΧ 单页速查表。付费资料则仍需合法取得和逐文件验证；“能打开商店”不等于“能读取商品全部内容”。本笔记未购买、未登录新账号、未提交或发布外部内容。
