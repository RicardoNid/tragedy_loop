# Tragedy Loop

独立的 TypeScript 规则内核和官方内容包支持基于缺席观察的推理。Web 与服务目录保留工程骨架。
下载仓库后可双击打开[未发生现象的解空间](products/engine/absence-space.html)，逐格查看角色身份组合、剪枝依据和各模组规则清单。

计划技术栈：React + Vite、Node.js + Fastify、TypeScript；Python + uv 用于未来辅助工具。
JS/TS 的版本、workspace 依赖和锁定记录已经配置。Python 环境是非打包环境，暂不声明 CLI 或构建包。

`facts/` 是独立静态规则资料站，图片、正文和来源快照随普通 Git 同步，无需 LFS 或 Wiki 登录。
克隆后从仓库根运行 `python3 -m http.server 5188 --bind 127.0.0.1`，打开 http://127.0.0.1:5188/facts/ 。

## 目录

```text
apps/
  web/                 package.json、tsconfig.json；src/ 空
  server/              package.json、tsconfig.json；src/ 空
packages/
  engine/              src/absence/ 独立反向解空间，src/runtime/ 正向规则结算
  contracts/           游戏输入和公开观察类型
  content/             官方规则包及其来源
python/
  src/tragedy_tools/    空
  tests/               空
tests/                 解空间回归、逐程序核验及剧本样本
e2e/                   空
scripts/engine/        解空间报告生成器
products/engine/       可离线查看的解空间报告
docs/
  architecture/        HTML 方案、术语阅读版和算法交接
  development/         空
facts/                 独立的“规则真源”任务维护；本次不修改
archive/               旧实现与归档说明；不参与 workspace 或检查
```

空目录通过 `.gitkeep` 保留。未来实现应从这些空目录开始，按需参考 archive；不以旧测试或
旧引擎实现自动认定规则正确。facts 的 wiki 结构和权威约定由该目录负责的任务决定。

## 设计阅读入口

- [核心状态机方案](docs/architecture/framework.html)
- [领域术语阅读版](docs/architecture/glossary.html)（对应根 [CONTEXT.md](CONTEXT.md)）
- [解空间与算法交接 Prompt](docs/architecture/handoff-prompt.html)
- [FS 完整对局交互原型](packages/engine/prototypes/fs-first-script.prototype.html)

克隆仓库后，用浏览器打开这些 HTML 文件即可阅读；原型单文件离线运行，无需安装依赖。
原型保留教学编排、实现范围和待验收标记，不作为活动引擎或规则权威。
方案文件总是以 HTML 格式交付。

## 当日保人决策求解器

```bash
pnpm solve:survival products/engine/day-survival-example.json
pnpm solve:policy products/engine/day-survival-example.json
```

示例重放到第一天的主人公能力阶段。医院已有密谋，住院患者的不安达到医院事故门槛。求解器找到医生发动能力并移除一枚不安的操作；若直接放弃，患者会在事件阶段死亡。

输入中的 `target` 是待保护的存活角色 ID，`candidates` 是与同一已知局面相符的候选重放，格式与最终决战示例一致。只有穷尽可行候选才能声明 `exhaustive: true`。自动搜索从当前菜单尝试放弃或发动一项能力，必要时补上队长后续的目标、数值等选择，然后放弃剩余任意能力。也可以用 `plans` 列出要比较的队长命令序列，包括连续发动多项能力。目标按实际弹出的 `select` 菜单填写，自动确定的唯一目标无需提交命令。未遇到的序列后缀不会执行。

`guaranteed` 表示在所有候选和剩余合法选择下，目标直到当日结束或轮回提前结束都存活在场；期间死亡后复活仍算失败。剧作家的拒绝、事件目标和日末能力都按正向内核展开。此目标允许主人公因其他原因失败。`no-guaranteed-plan` 只针对自动搜索的单次发动及预先约定的选择序列。显式方案返回 `counterexample` 时，原因区分死亡、离场和指令不可执行。`workPerPlan` 限制每个方案的正向步数，`maxPlans` 限制自动搜索的方案数（默认 100）；无法完成判定时返回 `unknown`。

`solve:policy` 支持主人公根据新观察连续发动能力。例如两名嫌疑人的不安都达到医院事故门槛，医生今天只能帮其中一人。若候选剧本中职员的两个可能身份分别对应不同当事人，可以先让职员公开身份，再决定医生的目标。若同一公开身份仍兼容两个当事人，该行动无法保证保人。

策略从 `policy.choice` 开始。下次轮到队长时，按 `responses[].when` 给出的新增报告、盘面与菜单匹配下一条 `then.choice`；引擎调用方可直接使用 `nextDayPolicy`。剧作家掌握的当事人和私下选择不会出现在条件中。`maxAbilities` 是每条路线允许声明的能力次数（默认 2，拒绝也计一次），`workLimit` 是整次搜索共享的正向推进与命令次数（默认 10000）。`no-guaranteed-policy` 表示该发动上限内穷尽后无解；候选不全、规则未支持、步数耗尽或单路线达到 128 个队长提问时返回 `unknown`，除非其他路线已足以确定结果。

## 最终决战决策求解器

在仓库根目录运行以下命令，可查看两个合法 BTX 候选剧本共有的安全回答。

```bash
pnpm solve:final products/engine/final-decision-example.json
pnpm check:decision
```

示例中医生与男学生的身份互换。求解器给出其余五人的安全回答，两个剧本各自单独输入时都能生成七步完整答题顺序。

输入 JSON 的 `candidates` 数组包含同一公开问题下仍可行的剧本，每项提供 `setup` 和按顺序记录的 `choices`（每步含 `actor`、`choice`）。重放应恰好停在等待回答的最终决战。候选已覆盖所有可能情况时填 `exhaustive: true`；只掌握部分候选时填 `false`。可选的 `worldLimit` 限制复核的候选数。宿主也可直接将已停在决战提问处的状态流传给 `solveFinalDecision`。反向解空间中的阶段有效身份需结合初始身份和行动历史补全后使用。

`safeChoices` 是所有候选都接受的下一步。只有每名待答角色都有共同正确的答案时，`plan` 才给出可连续提交的完整顺序。周年版因果残片可答平民，AHR 的表里身份按一对核验。LL 主人公 C 在专属提问中须一次提交各日当事人的联合答案。覆盖不足、超出预算或有未建模特规时返回 `unknown`；穷尽输入后无候选返回 `no-candidates`。

## 安装和配置检查

Node 版本见 `.node-version`（当前 22.22.1），pnpm 版本见 package.json（11.25.0），
Python 版本见 `.python-version`（3.12）；使用 uv 管理 Python 环境。

```bash
pnpm install --frozen-lockfile
uv sync --locked --python 3.12 --default-index https://pypi.org/simple
pnpm check
pnpm check:absence
```

本机联网安装在命令前加 `get-dep`。`pnpm check` 只校验配置格式和 Python 锁一致性；
CI 另外执行冻结安装，以及 `pnpm check:absence` 的类型检查和游戏规则回归。规则包发生变化时，运行
`pnpm exec tsx scripts/engine/absence-report.ts` 更新报告。CI 会检查提交的报告是否可复现。
TypeScript 配置已为 web/server 预置；等出现源码后再运行类型检查和构建。

根只有一套 pnpm/uv 活动锁文件。归档中的旧配置仅是历史副本，不参与自动安装。

[协作规范](AGENTS.md) · [GitHub 流程](CONTRIBUTING.md) · [归档与迁移清单](archive/README.md)
