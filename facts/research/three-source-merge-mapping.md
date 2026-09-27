# 三源合并映射研究

2026-09-27。只读检查本地来源快照；不代表所有 Wiki 页面已采集。合并优先级依据本轮用户指令为 wiki > lloyd > ricardo，lloyd 即历史目录 `sources/lunhui`。以下是数据建模建议，不是新的游戏裁定。

## 已有证据可建立的角色映射

证据基准：[Lloyd 附录 C](../sources/lunhui/tragedy_loop_appendix(3)(1).md)（角色表第 617–656 行）及 [Ricardo 角色卡](../sources/ricardo/reference/character-cards/cards.md)。不能仅凭繁简转换合并实体。

| Wiki 条目 → 本文角色名 | Lloyd 对应 | 证据 |
| --- | --- | --- |
| 媒體人 → 媒体人 | 媒体人 | [页面快照](../sources/wiki/pages/17bd4b4afdac7dfc.json)同页明确写出简体角色名 |
| 神靈 → 神灵 | 神灵 | [快照](../sources/wiki/pages/eb2f04c87cbab5eb.json)同页角色名；指定轮回登场特性一致 |
| 班長 → 班长 | 班长 | [快照](../sources/wiki/pages/46166d54006a4691.json)同页角色名；收回队长限次行动牌能力一致 |
| 從者 → 从者 | 从者 | [快照](../sources/wiki/pages/3021eeaa7071de48.json)同页角色名；跟随大人物/大小姐并代死特性一致 |
| 異界人 → 异界人 | 异界人 | [快照](../sources/wiki/pages/c795fbe776bfb03e.json)同页角色名 |
| 情報商 → 情报商 | 情报商 | [快照](../sources/wiki/pages/31f316c77f6c5900.json)同页角色名 |
| 臨時工？ → 临时工？ | 临时工？ | [快照](../sources/wiki/pages/edb4e01e31d65cb0.json)同页角色名；保留问号作为身份区别 |
| 臨時工 → 临时工 | 临时工 | [快照](../sources/wiki/pages/433ef0170b0f9d6b.json)同页角色名；不得与带问号角色合并 |
| 職員 → 职员 | 职员 | [快照](../sources/wiki/pages/de633317ee358d2c.json)同页角色名；都市/禁学校/不安2/友好3公开自身身份与 Lloyd、Ricardo 一致 |
| 教師 → 教师 | 教师 | [快照](../sources/wiki/pages/ac6e49c296a46510.json)同页角色名 |
| 學者 → 学者 | 学者 | [快照](../sources/wiki/pages/021480e95f4e88ae.json)同页角色名；清除自身指示物与调整EX能力一致 |
| 男學生 | 男子学生；Ricardo 男学生 | [快照](../sources/wiki/pages/3f6dbb415e68b864.json)与两源同时具备学校/无禁行/学生少年/不安2/友好2移除同区另一学生1不安的组合，不只名称相似 |
| 女學生 | 女子学生；Ricardo 女学生 | [快照](../sources/wiki/pages/a2981483fdc442ac.json)与两源同时具备学校/无禁行/学生少女/不安3/友好2移除同区另一学生1不安的组合 |
| A.I. | AI | [快照](../sources/wiki/pages/2f5700a082215a9b.json)与 Lloyd 同为造物/都市/禁三处/不安4，不能为平民、所有指示物计不安、友好3限1代为处理公开事件等特征一致 |

这些映射只证明实体对应，不能说明所有字段一致。巫女、偶像等来源属性差异仍需保留候选。Wiki【感想】应存为社区评论，不应混入强制规则。不存在于当前快照的角色不应据此删除；本次快照采集仍在进行。

## 模组与版本边界

- Lloyd 附录 B 明确列出 First Steps、Basic Tragedy X、Midnight Zone、Mystery Circle、Haunted Stage Again、Weird Mythology、Another Horizon Revised、Last Liar 八套。应以模块 ID 约束其规则、身份和事件的作用域。
- [Basic Tragedy](../sources/wiki/pages/c5967c2abd41a1b6.json)与[Basic Tragedy X](../sources/wiki/pages/1095c9f923c9c10c.json)分别有不同身份及契约规则阈值。绝不可丢弃 X 后合并。
- [Haunted Stage](../sources/wiki/pages/2c5d6075f60e6bd8.json)拥有死后活性与灵异度；[Haunted Stage Again](../sources/wiki/pages/da682a376d9880ab.json)拥有牺牲者、群众事件、诅咒牌。为两个模组。
- [Another Horizon](../sources/wiki/pages/0bbeabad41fe0a31.json)的友好爆发，与[Another Horizon Revised](../sources/wiki/pages/5a4c2d8594c08b1e.json)的傀儡无视友好等不能仅凭 AH 前缀合并。
- [Mystery Circle 快照](../sources/wiki/pages/b21e3f528569eced.json)和 Lloyd 同名；不能从“MCΧ”外部称呼推定本地应自动改版。先保存来源标题、缩写、具体规则。
- Ricardo [module-index.json](../working/ricardo/modules/module-index.json)的 `Haunted Stage A` / `Another Horizon R` 只有页码索引证据，不能仅据 A/R 缩写确认对应 Again/Revised；可列待核对关联，不作为无条件 alias。
- 同名事件也须有模块作用域：Lloyd FS 医院事故只列医院角色死亡；BTX 同名事件还有医院2密谋导致主人公死亡。全局按“医院事故”覆盖会丢规则。

## 适合结构化的字段

所有实体：`id`、`kind`、`name`、有证据的 `aliases[]`、`scope/moduleId`、来源候选 `candidates`、字段选用来源 `fieldProvenance`、未决 `conflicts`。保留文本原值；空白、未知、明确“无”必须分开。

角色：初始区域（含由剧本指定）、禁行区域、属性列表、不安限度（数字或 X）、特性、友好能力数组。每个能力独立存阈值、限次、时机、正文，不使用“最高友好限度”代替全部能力。Lloyd 附录有四能力列，Ricardo 的单一友好限度不能反向裁掉能力。

模组：特殊规则正文、规则 X/Y、身份及数量限制、事件、手牌调整。规则的身份分配单元需保留 `①`、`②`、`表/里` 等原值；不要把所有单元格强转为整数。Wiki 表格含 rowspan/colspan，解析时必须展开跨度或保留原矩阵，不能直接按每行 td 下标对齐。

身份：限定数量、特性、能力列表与所属模组。事件：效果列表、事件特性（群众/共谋等）、当事人约束、所属模组。行动牌：阵营、数量、限次、效果。剧本：模组、轮数、天数、角色身份配置、事件日程、公开/非公开信息与特殊规则；缺字段不编造。

来源快照：URL、本地路径、采集时间、原始标题、许可链接、revision（有证据才填）、状态。原始 HTML 仅是留证，发布展示须清理 iframe/script/追踪元素；规则数据不能只藏在 HTML 中。

## 工程排除与混合材料

不纳入面向读者的规则分类：[开发框架-01-工具选型](../sources/lunhui/开发框架-01-工具选型.md)、[开发框架-02-规则引擎模板](../sources/lunhui/开发框架-02-规则引擎模板.md)、[开发框架-03-开发流程](../sources/lunhui/开发框架-03-开发流程.md)、[开发设计与测试基准](../sources/lunhui/tragedy_loop_development(2)(1).md)。原件保留出处或迁移清单，但实现字段、测试断言、目录规划不是规则权威。

步骤结算流程、逻辑样例、FAQ 与裁定是混合材料：保留游戏行为与裁定出处，将代码/测试建议区分为工程注释。不要整文件丢弃，也不要把状态机实现直接升为批准规则。

Ricardo JSON 中 `review_status`、`source_refs` 是来源/审核元数据；`source_document` 仍出现已迁移的 `facts/source_material` 路径，需通过迁移映射修复，而非当作资源存在的证据。`draft_effect` 保持草稿来源标志，即使是第三优先级补缺也不能改称官方确认。
