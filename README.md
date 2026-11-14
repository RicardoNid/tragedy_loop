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

双击根目录 [tragedy-test-ui.html](tragedy-test-ui.html) 即可离线开局。规则引擎、官方剧本和实时求解器均已打包在 HTML 中。复制此文件到其他目录也可运行。刷新或关闭页面会结束当前对局，审阅记录可在结束前导出。

维护者修改源码后运行 `pnpm build:review:local` 更新交付文件，使用 `pnpm test:review:local` 在断网浏览器中验证。开发服务模式仍可用 `pnpm dev:review`。
[测试入口](tragedy-test-ui.html) 与 [实现、验证和人工验收清单](products/review/index.html)。

本地 HTML 通过内嵌 Web Worker 调用双方席位接口。开发服务模式通过 HTTP 调用相同接口。前端不导入引擎或服务端示例剧本；手动导入的剧本由测试者自行提供。
BTX 测试按钮采用官方 BTX-01G《魔法少女万能论》（4 轮、每轮 5 天、7 名角色，第 3 天医院事故，含关键人物）。完整配置与出处保存在 `apps/server/src/fixtures/btx-01g.json`，不传递隐藏身份给主人公 UI。
FS 测试按钮采用官方 FS-01G《初学者剧本》（3 轮、每轮 3 天、6 名角色，第 3 天自杀），配置与出处保存在 `apps/server/src/fixtures/fs-01g.json`。
新建对局后，按盘面上方“当前操作方”的提示切换席位。剧作家可手动提交三张行动牌、发动能力和作出选择；三名主人公分别盖牌，队长处理能力、回应与最终回答。所有可选动作来自现有引擎接口，由引擎校验和结算。
游戏开始前，主人公可查阅所有日期的公开事件名称和剧本提供的公开特殊规则。队长点击“开始游戏”后放置首批角色，转校生和神灵分别在指定日、指定轮回登场。导入剧本的 `publicSpecialRules` 为公开说明文本数组，供玩家阅读。
手测时，页面会把各次操作、引擎结算、公开观察和求解过程自动保存在本浏览器。剧作家视角下点击“导出完整诊断（含剧透）”可下载当前对局 JSON。刷新后仍可在同一浏览器、同一路径的测试首页导出最近记录。按观察序号可对照候选删除、局部原因及联合历史搜索；普通席位的“导出审阅记录”仍只包含本方视野。
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

双击 `tragedy-test-ui.html`，选择 FS 或 BTX 剧本。在“对局操作”按提示切换剧作家和三位主人公，提交行动直到出现胜负。桌面右侧的“实时解空间”按主人公的公开观察更新角色身份、事件当事人和规则候选。切换到剧作家席位也可继续查看同一份公开推理。回看时显示对应观察版本；联合解总数在求解器完成计数后显示。

离线构建、开发服务和回放共用 `packages/content/src/official` 与 `packages/engine/src/runtime`。更新规则后运行 `pnpm check:engine` 和 `pnpm check:review`；仅运行求解器回归可用 `pnpm check:realtime`。
