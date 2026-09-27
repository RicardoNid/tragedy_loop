# 惨剧轮回本地 Wiki

入口：`index.html`。从仓库根启动 `python3 -m http.server 5188 --bind 127.0.0.1`，打开 http://127.0.0.1:5188/facts/ 。无外部脚本、无运行引擎依赖。

- `data/catalog.json`：分类、条目导航和采集覆盖率。
- `data/source-inventory.json`：每份本地来源文件的哈希、处理方式及对应条目。
- `data/references/`：来源原文与整理记录，与游戏规则条目分开展示。
- `data/<类别>/*.json`：角色、模组、规则、身份、事件、剧本等实体；字段候选和所选来源分别保存。
- `text/<类别>/*.txt`：独立的长正文；不嵌入入口 HTML。
- `sources/wiki/`：Wiki 目录、页面快照、结构化表格和版本 URL。
- `sources/lunhui/`：Lloyd 来源原件（保留历史目录名）。
- `sources/ricardo/`、`working/ricardo/`：Ricardo 原件与既有草稿。
- `assets/`：静态阅读器的样式和显示逻辑。
- `tools/`：采集参考方法、整理与验证工具。
- `canonical/source-policy.md`：三源优先级约定。
- `CONTEXT.md`、`decisions/`、`research/`：术语、决定与证据。

重新整理：`python3 facts/tools/build_wiki.py`。只读取本地来源，不自动联网。采集目录由 Edge 正常浏览网页取得，遇限流或访问验证停止，不导出 Cookie。采集清单的待完成项必须清空并核对后，才可宣称完整。

当前已完成指定来源的本地 Wiki 整理：主目录917项、Wiki素材55项及本地图片4项；原站162个空白条目和1个缺失文件保留证据。交付核对见 `decisions/completion-audit.md`。Wiki 空白条目保留空白状态；低优先级来源只补缺，具体出处可在条目内查看。社区正文按站点显示的 CC-BY-SA 许可保留来源；图片等另有许可者遵循原出处。

阅读器反馈已按 14 项实施，见 [逐项验证](decisions/0002-reader-feedback-verification.md)。模组以全局规则置顶、三个列表板块切换；所有分类支持关键字、标签及性质筛选；模组绑定类目默认展示一个模组，并可多选过滤。FAQ 现有 479 条，原始在线单元格在 `sources/faq-sheet/`，四张纸本照片的逐题转写在 `sources/paper-faq/`。分别保留出处，未进行翻译统一。BTX Plus 是独立组合模组；行动牌的缩写标签链接到有条件的获得／移除证据。

反馈专项核验：`python3 facts/tools/verify_reader_feedback.py`。图文阅读体验仍待人类验收，自动检查不能代替该验收。

第三轮布局与剧本归并见 [最新记录](decisions/0003-reader-layout-and-scenarios.md)：FAQ 同行问答、分组彩色标签、统一模组配色排序、588 个唯一剧本编号及默认折叠的非公开区块。专项验证：`python3 facts/tools/verify_reader_v3.py`。
