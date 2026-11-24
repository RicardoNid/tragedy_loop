# Tragedy Loop · 规则内核与工程骨架

当前已有独立规则内核、剧作家与主人公输入输出接口、官方规则包和自动回归，同时保留首批机器规则审阅资产。旧游戏、服务、资料页面、测试和生成工具均已移入
`archive/`，不再作为活动实现运行。现已提供本地人类审阅 UI；多人服务尚未实现。

计划技术栈：React + Vite、Node.js + Fastify、TypeScript；Python + uv 用于未来辅助工具。
JS/TS 的版本、workspace 依赖和锁定记录已经配置。Python 环境是非打包环境，暂不声明 CLI 或构建包。

`facts/` 是独立静态规则资料站，图片、正文和来源快照随普通 Git 同步，无需 LFS 或 Wiki 登录。
克隆后从仓库根运行 `python3 -m http.server 5188 --bind 127.0.0.1`，打开 http://127.0.0.1:5188/facts/ 。

## 目录

```text
apps/
  web/                 React + Vite 人类审阅 UI，仅消费主人公契约
  server/              Fastify 本地审阅宿主，持有引擎会话
packages/
  engine/              runtime/ 执行内核；保留首批类型、效果预览与 prototypes/ 独立原型
  contracts/           双方输入输出类型、JSON 格式校验
  content/             official/ 运行规则包；首批机器定义、来源锁定与资料覆盖清单
python/
  src/tragedy_tools/    空
  tests/               空
tests/                 engine/ 内核回归；rules/ 机器规则资产与效果片段检查
e2e/                   review/ 桌面与移动视口人类测试 UI 回归
scripts/               engine/ 报告与只读来源快照工具；rules/ 来源追溯整理工具
products/              engine/ 内核报告；review/ 人类测试 UI 验收记录
docs/
  architecture/        HTML 方案、术语阅读版和算法交接
  development/         空
facts/                 独立的“规则真源”任务维护；本次不修改
archive/               旧实现与归档说明；不参与 workspace 或检查
```

空目录通过 `.gitkeep` 保留。未来实现应从这些空目录开始，按需参考 archive；不以旧测试或
旧引擎实现自动认定规则正确。facts 的 wiki 结构和权威约定由该目录负责的任务决定。

## 设计阅读入口

- [规则引擎实现、双方接口与验收](products/engine/index.html)
- [核心状态机方案](docs/architecture/framework.html)
- [领域术语阅读版](docs/architecture/glossary.html)（对应根 [CONTEXT.md](CONTEXT.md)）
- [解空间与算法交接 Prompt](docs/architecture/handoff-prompt.html)
- [FS 完整对局交互原型](packages/engine/prototypes/fs-first-script.prototype.html)
- [机器规则首批定义与特殊语义审阅](docs/rules/first-batch-review.html)

克隆仓库后，用浏览器打开这些 HTML 文件即可阅读；原型单文件离线运行，无需安装依赖。
原型保留教学编排、实现范围和待验收标记，不作为活动引擎或规则权威。
方案文件总是以 HTML 格式交付。

## 安装和配置检查

Node 版本见 `.node-version`（当前 22.22.1），pnpm 版本见 package.json（11.25.0），
Python 版本见 `.python-version`（3.12）；使用 uv 管理 Python 环境。

```bash
pnpm install --frozen-lockfile
uv sync --locked --python 3.12 --default-index https://pypi.org/simple
pnpm check
```

本机联网安装在命令前加 `get-dep`。`pnpm check` 只校验配置格式和 Python 锁一致性；
CI 另外执行冻结安装。本地审阅 UI 可运行；领域规则与视觉体验仍待人类验收。
`pnpm check:review` 检查审阅 UI 构建、服务类型和接口回归。

`pnpm check:engine` 检查当前内核；`pnpm report:engine` 重跑检查并刷新 HTML 报告、性能基线与示例重放。
调用入口为 `packages/engine/src/index.ts` 和 `packages/content/src/official/index.ts`。
官方内容执行映射、自动测试与人工验收分别记录；当前仍待人类验收。有限候选域参考验证器复用执行内核，
不等于已完成全域实时解空间系统。双方端口可供未来服务或训练宿主接入；完整快照仅限可信宿主使用。

`pnpm check:rules` 单独检查最小规则类型、来源哈希、独立预期与效果片段；它不是完整游戏测试。
首批交付的范围和未决特殊语义见上方审阅 HTML。`node scripts/rules/build-evidence.mjs`
只读取 `facts/`，更新本任务在 `packages/content/src/` 的两个追溯文件；来源变化时应先人工核对差异，
不要通过重新生成来掩盖失败的来源检查。

根只有一套 pnpm/uv 活动锁文件。归档中的旧配置仅是历史副本，不参与自动安装。

[协作规范](AGENTS.md) · [GitHub 流程](CONTRIBUTING.md) · [归档与迁移清单](archive/README.md)

## 本地人类测试

测试页右侧显示求解器 1 和求解器 3。求解器 3 支持按完整公告批次回看四态表格、变化、联合关系和结论来源。已验收用例及未验证范围见[逐阶段验收结果](products/engine/solution3-acceptance.html)。运行 `pnpm check:solver3` 执行回归，运行 `pnpm report:solver3` 更新报告。 使用 `pnpm test:solver3:cross` 复现独立小穷举、两席 FS 完整对局的逐前缀精确交叉测试，以及 14 条教程逐前缀检查。用 `pnpm exec tsx scripts/engine/solution3-cross-prefix.ts 种子` 可重放两席对局。参数 `1 all 1000` 逐一核验七种事件、每种一千个种子。`pnpm test:solver3:soak 6.01` 连续运行并将每组的结果和首个失败写入 `products/engine/solution3-monitor.jsonl`。

三席 FS 的联合对照可用 `pnpm exec tsx scripts/engine/solution3-cross-prefix.ts 1 all 400 3` 复现。MC 三席使用 `1 all 100 3 --module=MC`，BTX、HSA 两席分别使用 `1 all 200 2 --module=BTX` 或 `--module=HSA`。大剧本的独立验收使用 `pnpm exec tsx scripts/engine/solution3-campaign.ts 1 1000 MC varied audit`；种子和次数之后为模组缩写，检查每一步公开历史与该局真实制作配置的联合相容性。验收报告的固定用例、精确对照、真实配置留存与人工验收分别统计。

求解器 2 已弃用。

双击根目录 [tragedy-test-ui.html](tragedy-test-ui.html) 即可离线开局。规则引擎、官方剧本和实时求解器均已打包在 HTML 中。复制此文件到其他目录也可运行。刷新或关闭页面会结束当前对局，运行诊断自动保存在当前浏览器。公开审阅记录和笔记可在结束前导出。

维护者修改源码后运行 `pnpm build:review:local` 更新交付文件，使用 `pnpm test:review:local` 在断网浏览器中验证。开发服务模式仍可用 `pnpm dev:review`。
[测试入口](tragedy-test-ui.html) 与 [实现、验证和人工验收清单](products/review/index.html)。

本地 HTML 通过内嵌 Web Worker 调用双方席位接口。开发服务模式通过 HTTP 调用相同接口。前端不导入引擎或服务端示例剧本；手动导入的剧本由测试者自行提供。
BTX 测试按钮采用官方 BTX-01G《魔法少女万能论》（4 轮、每轮 5 天、7 名角色，第 3 天医院事故，含关键人物）。完整配置与出处保存在 `apps/server/src/fixtures/btx-01g.json`，不传递隐藏身份给主人公 UI。
FS 测试按钮采用官方 FS-01G《初学者剧本》（3 轮、每轮 3 天、6 名角色，第 3 天自杀），配置与出处保存在 `apps/server/src/fixtures/fs-01g.json`。
新建对局后，按盘面上方“当前操作方”的提示切换席位。剧作家可手动提交三张行动牌、发动能力和作出选择；三名主人公分别盖牌，队长处理能力、回应与最终回答。所有可选动作来自现有引擎接口，由引擎校验和结算。
游戏开始前，主人公可查阅所有日期的公开事件名称和剧本提供的公开特殊规则。队长点击“开始游戏”进入第一轮轮回间讨论。讨论结束、轮回开始时才向主人公公开首批登场角色，转校生和神灵分别在指定日、指定轮回登场。导入剧本的 `publicSpecialRules` 为公开说明文本数组，供玩家阅读。
同一次结算有多个可见结果时，观察记录以一条“同时发生”公告列出所有结果。各席位按自己能看见的结果分组。事件发生、随后的一次结算、死亡触发的后续效果分别保留各自的时点。求解器收到整批后才更新证据，同批结果的排列不影响历史匹配。

手测时，每局的引擎与两个求解器输入输出自动保存在本浏览器的 IndexedDB。记录包含请求时间、操作参数、成功结果、错误、引擎结算及完整求解结果。求解器1保存完整公开历史作为可重放输入，求解器 3 保存公开开局、当前公开视图与请求的历史前缀，并核对已处理的公告序号。相同的求解器轮询结果只保留一次。剧作家视角下点击“导出完整诊断（含剧透）”可下载当前对局 JSON；首页或剧作家视角的“本地运行记录（含剧透）”可以选择并导出各局记录。刷新后，在同一浏览器、同一路径仍可读取。写入失败会显示提示，并在后续写入时重试。普通席位的“导出审阅记录”只包含本方视野。
在“游戏盘面”标题下选择“剧作家”，可查看每名角色当前的真实身份、完整名册及登场条件、X/Y 规则、真实事件与当事人，以及各席位的手牌和盖牌。切回任一主人公即恢复该席位视图，解空间始终基于主人公的公开观察。
本机测试者可切换四个席位完成整局，无需使用折叠区内的固定测试推进。剧作家剧本信息只在剧作家席位显示；主人公导出不包含剧作家历史。这是本机人类审阅工具，不是带账号隔离的多人服务。

`pnpm check:review`：前端类型与生产构建、服务类型和接口测试。
`pnpm test:review:gui`：桌面与移动视口浏览器回归（需本机 Microsoft Edge）。
`pnpm check:engine`：独立规则内核回归。GUI 自动检查和人工验收分开记录。
`pnpm check:comprehensive`：FAQ 来源完整性、复合规则定向断言、八模组完整对局重放、角色组合压力、规则资产与 UI 联调检查。
逐条问答、已修复问题、覆盖限制和复现日志见 [综合验收报告](products/comprehensive/index.html)。任意文本特殊规则不受支持，人类验收仍待进行。
服务重启后对局失效；刷新页面会丢失当前审阅会话，结束前可导出公开记录和笔记。
旧格式存档不直接兼容当前 GameSetup。

### 实时求解器

[求解器1规则语义说明](products/engine/rule-semantics.html) 直接展示运行内容包的原生 `RuleProgram / Ability / Step`、制作约束和 traits。求解器1的正向制作验证与反向初始域读取同一份身份属性、当事人限制及群众事件声明；事件快速路径读取显式覆盖声明。尚未迁移的宿主生命周期语义在页面中单列。重建说明：`pnpm exec tsx scripts/engine/rule-semantics-report.ts`。

主人公友好能力阶段先核对公开发动条件和实际结果。能确定的单步、多步及群体效果直接更新盘面，后续公开选择沿当前能力核对。普通结算不新增隐藏来源约束。强制拒绝、隐藏发动条件、免疫与替代、正式披露、额外反应或缺失预期结果，才触发相应候选核验。标记、保护和回收牌的后续影响在真正被使用的窗口检查。

事件阶段同样先判断观察是否区分当前候选。所有事件与当事人候选都符合发生状态时，不新增触发约束。FS/BTX 中公开固定的指示物步骤若对所有候选产生相同结果，则逐步更新盘面，跳过来源搜索与联合投影；公开空目标或封顶导致的无现象也可直接记账。不同门槛与作用区域、取消、重复结算、死亡免疫、替代、额外反应及缺失预期结果仍有推理价值；私有条件或未支持的正文继续保留核验。

`pnpm report:timeline` 按阶段入口、阶段结束及关键公开证据，在每个相同公开前缀上独立穷举，比较逐条处理、时间节点批量处理与穷举的完整联合解集，生成可直接打开的 `products/engine/timeline-audit.html`。报告区分精确解集差异、本地候选的保守余量和计算量，保留规则时点清单及可下载的复现证据。专项覆盖友好能力与事件的普通、无现象和封顶结算，并用错误数量、缺失应有现象核对三方是否一致为空解；这些对照也纳入 `pnpm check:engine` 的正式回归。

[反向剪枝与穷举对照](products/engine/pruning-benchmark.html) 可直接双击打开。按规则名称查看观察条件与排除依据，或查行动牌、原盘面低收益程序及扩测后仍然费时的查询。报告在同一输入上比较穷举、原策略和当前阶段核验步数，并单列来源索引访问、历史展开及三人／四人身份名额分支。可以下载结构化 JSON，或在仓库根目录运行 `pnpm exec tsx scripts/engine/pruning-benchmark.mjs` 重新生成。

双击 `tragedy-test-ui.html`，可直接新建 FS 或 BTX 对局。要试其他官方模组，展开[逐条剪枝清单](products/engine/pruning-order.html)中的“逐模组开局实测”，下载对应的剧本 JSON，再在测试界面选择“导入测试剧本”。文件含剧作家隐藏设定。在“对局操作”按提示切换剧作家和三位主人公，提交行动直到出现胜负。两个求解器面板在页面右侧上下固定，各自独立滚动，统一展示“角色 × 初始身份”、规则、事件三个表格，以及表格无法表达的组合和跨表逻辑关系。切换到剧作家席位也可继续查看公开推理，回看时显示对应观察版本。

离线构建、开发服务和回放共用 `packages/content/src/official` 与 `packages/engine/src/runtime`。更新规则后运行 `pnpm check:engine` 和 `pnpm check:review`；仅运行求解器回归可用 `pnpm check:realtime`。


当前入口使用结构化求解器。双击 [逐条剪枝清单](products/engine/pruning-order.html)，可按角色、身份、事件或主副线查找：什么观察让来源纳入计算，哪些已知条件能跳过该来源，何时才允许删除联合候选。清单的“逐条编译”部分按实际规则包生成，覆盖八个官方模组的 14 种合法配置，可以按模组筛选，查看各配置的开局验证、双面身份和模组固有能力。行动牌、建域和观察窗口另有逐项样例。运行 `pnpm exec tsx scripts/engine/pruning-order.mjs` 可重新生成。

运行入口为 `packages/engine/src/runtime/knowledge.ts`。运行 `pnpm check:realtime` 可复测结构化求解器。回归使用有限域穷举核对联合解，并在 FS、BTX 的基础版和周年追加中各运行六组固定种子的出牌与能力选择，逐条核对公开观察后仍保留真实身份、主副线组合和事件当事人。MZ、MC、HSA、WM、AHR、LL 及适用的周年配置也有独立的官方剧本前缀回归，测试输入明确给定角色名册。

同时公告收齐后，求解器用批次开始时的盘面筛选单条规则，沿共享目标、使用次数、身份名额、免疫和替死等依赖分组。每组单独检查合法组合，用整批结果及未变化的受影响对象排除解释。医院事故会一并核对伤亡和守护消耗。回合结束时，能从公开盘面确定的首批强制效果一起结算，后续触发另算。实时推理保留缺少隐藏条件或超出局部预算的候选，完整历史可在页面选择“核验联合历史”。

[旧版求解器 v1](packages/engine/versions/knowledge-v1.zip) 已独立封存，供将来追溯。压缩包内的原始 ESM 快照包含当时的规则包、求解器和回放实现，SHA-256 为 `8dcd285c0a31e1309404417156e26cef7adce52ca33deb627e4ab5cb1367fecf`。应用、构建和回归测试均使用活动源码。
