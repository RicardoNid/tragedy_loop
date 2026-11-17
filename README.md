# Tragedy Loop

独立的 TypeScript 规则内核和官方内容包支持基于缺席观察的推理。可在本地决策工作台查看主人公盘面、寻找策略并独立复核。
下载仓库后可双击打开[未发生现象的解空间](products/engine/absence-space.html)，逐格查看角色身份组合、剪枝依据和各模组规则清单。

本地工作台使用 React、Vite、Fastify 和 TypeScript。Python + uv 用于辅助工具。
JS/TS 的版本、workspace 依赖和锁定记录已经配置。Python 环境是非打包环境，暂不声明 CLI 或构建包。

`facts/` 是独立静态规则资料站，图片、正文和来源快照随普通 Git 同步，无需 LFS 或 Wiki 登录。
克隆后从仓库根运行 `python3 -m http.server 5188 --bind 127.0.0.1`，打开 http://127.0.0.1:5188/facts/ 。

## 目录

```text
apps/
  web/src/decision/    本地决策工作台
  server/src/decision/ 本地服务、示例与独立计算进程
packages/
  engine/              src/absence/ 独立反向解空间，src/runtime/ 正向规则结算
  contracts/           游戏输入和公开观察类型
  content/             官方规则包及其来源
python/
  src/tragedy_tools/    空
  tests/               空
tests/                 解空间回归、逐程序核验及剧本样本
e2e/                   决策台服务与浏览器回归
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

## 本地决策工作台

安装依赖后运行 `pnpm decision:local`，在浏览器打开 [本地决策台](http://127.0.0.1:4179/)。用 Ctrl+C 关闭服务。若默认端口已占用，可通过环境变量 `DECISION_PORT` 设置端口。

从局面库选择学校暗牌、医院事故、职员调查、LL 个人推理或最终决战。点「求解策略」后，可以逐个展开新观察并查看对应行动。点「独立复核」检查策略是否覆盖所有后续分支。「导入问题」接受 CLI 使用的候选重放或完整观察 JSON，「导入策略复核」可检查外部策略。界面会区分无保证、候选不全和预算耗尽；反例只展示主人公可见证据。

服务只监听本机，每次执行一项分析。单次输入上限 2 MiB，计算最长 90 秒。超过该范围的离线分析仍可使用 CLI。运行 `pnpm check:decision-ui` 验证前后端类型、生产构建、服务和真实浏览器交互。自动检查覆盖桌面和窄屏。人工验收状态为**待人类验收**。测试优先使用系统 Chrome 或 Edge，也可用 `DECISION_TEST_BROWSER` 指定浏览器，或安装 Playwright Chromium。

## 历史重建中的剧本剪枝

工作台的「两人独处的日末」给出一个完整 BTX 实例。医院里只有医生和住院患者，两人从日末活到次日。十二套合法剧本中保留八套、共 32 条相容历史。医院中有杀人狂时，另一人是时间旅者的两种排列均保留。调整暗牌与其他角色身份会产生不同历史，故历史数与剧本数分开计算。打开「日末静默排除」可看到观察序号及被排除的候选组合示例。

决策重建只在记录完整闭合且正向裁判已将强制能力加入本次日末批次时，应用独立缺席规则的条件约束。护卫、免死、合法的替代目标和多目标分支按各候选实际情况核对。时序不符合条件时继续逐步重放。观察输入设置 `"dayEndAbsence": false` 可单独关闭这层剪枝；不改变独立反向求解器。

完整观察重建会提前读取能约束初始剧本的公告，包括已公开的事件当事人、最终决战的身份裁定和本人的 Ex。C 的联合答案错误只能排除所有日期同时相符的那组当事人。职员等角色在场上的身份公告、忍者代报的身份和后续轮回中的有效身份仍按正向历史处理。工作台的「剧本剪枝依据」可以查看对应的原始观察序号，以及生成与重放各自跳过的数量。

在 BTX 最终决战回归中，起初有 360 个合法剧本。连续答对三名角色后，关闭提前剪枝的完整重放用了 5188 步，得到 4 个相容世界。开启剪枝后，剧本生成从 33342 步降到 175 步，重放 76 步得到同样的 4 个世界。`pnpm check:decision` 会逐状态比对两条计算路线。

## 通过行动调查身份或当事人

```bash
pnpm investigate products/engine/investigation-example.json
pnpm investigate products/engine/investigation-example.json identity officeWorker 1
```

示例从第二天的主人公能力阶段开始。两个合法剧本将职员的身份与第二天不安扩散的当事人关联。调查职员后，无论公开哪种身份，当事人都只剩一人。工作台的「调查解空间」可更换目标、调整发动上限，并按实际观察查看仍然可能的答案。命令行支持 `identity <角色 ID>` 和 `culprit <事件日>`，也可在候选重放或完整观察 JSON 里提供 `investigation.target`。

调查从当前友好能力菜单出发，截止于主动结束调查或离开该阶段。每条路线最多声明 `maxAbilities` 次能力（默认 1），剧作家拒绝也计一次。已经声明的能力必须完成目标或数值等后续选择。解空间按不同的初始身份（含表里）或不同当事人计数；重复暗牌历史不会给某个答案增加权重。搜索比较所有可见回应，包括目标无变化、能力被拒绝和阶段直接结束。合作者共享主人公视角；LL 个人调查须指定当前行动座位。

`optimal` 表示已证明最坏情况下的最小剩余数。`plan` 的每个停止节点列出该观察下仍成立的答案。有限预算用尽时，`unknown` 可能附带可执行路线和已证明的上界 `worstRemaining`，仍可能有更好的路线。输入候选本身未穷尽时不会给出这个保证。调查目标只评价获得的信息量；当日保人与整局胜利须分别求解。

## 整局获胜决策求解器

若只掌握主人公看到的记录，可以先重建隐藏历史，再求解：

```bash
pnpm solve:observed products/engine/observed-game-example.json
```

此示例提供角色候选身份、已知规则组合、事件当事人及主人公的观察记录。偶像和大小姐均可能是关键人物，也均可能是平民。身份配额只允许两个完整剧本。医院事故前已经翻牌，但两张不安 +1 实体牌仍可互换，总计四条相容历史。四种情况下医生都能保住患者。翻牌前只能用已经公开的暗置目标缩减枚举。

输入可提供完整候选剧本数组 `setups`，也可提供若干个 `setupDomains`。每个域给出一份完整角色表，`roles` 可限制该角色的身份（AHR 表里身份写成二元数组）。省略 `plots` 时枚举当前模组的 Y 和有序 X 槽。省略某日的 `names`、`culprits` 时按公开事件表枚举该模组支持的实际事件、伪造事件和合法当事人。核验包括身份配额、模仿犯复制、局外人、成对身份、可选暴徒、周年残片和 LL 座位分配。转校生和神灵未指定登场时点时枚举所有合法日、轮。仙人的 X 无规则上限，需要在各域里给出待检验的取值。

`exhaustiveSetups` 声明输入是否覆盖所有可能的角色名单和配置。`evidence` 是从开局到当前主人公提问的完整观察，可用 `pnpm observe:decision products/engine/day-survival-example.json` 从首条候选重放导出。普通整局目标使用 `goal: {"kind":"game"}` 或省略；当日保人目标使用 `{"kind":"survival","target":"patient","maxAbilities":2}`。输出分别报告剧本生成、历史重建和决策搜索。`generationWorkLimit` 默认 100000，`historyWorkLimit` 默认 50000，`worldLimit` 默认 512。超出上限、范围不全或特规未建模时，不能据已找到的部分世界给出保证。剧本和内部运行状态只供宿主使用。

```bash
pnpm solve:game products/engine/game-policy-example.json
```

示例从 FS 最后一轮最后一天的第三名主人公出牌开始。学校暗置的牌在两个候选里分别是密谋 +1 和 +2，剧作家随后还可以通过「流言四起」加密谋。策略给出在学校使用禁止密谋牌，正向裁判在两个候选的全部后续选择中均判主人公胜利。

输入沿用候选剧本与行动记录格式，重放停在任一主人公提问处。三名主人公按项目的共享视野协同选择；每个公开局面只允许一项应对。结果 `guaranteed` 随附可执行的 `policy`，`no-guaranteed-policy` 表示这些候选中没有可以确保整局胜利的策略。轮回失败后仍继续搜索下一轮或最终决战，只有正向引擎裁定主人公获胜才完成目标。最终决战按共同正确答案剪枝，普通讨论可选择全体同意决战或继续游戏。

`workLimit` 默认为 10000 次正向推进或提交命令，`frontierLimit` 默认为每个行动最多保留 512 个尚待主人公应对的分支。搜索最多深入 128 个主人公提问。无法作出完整判定时返回 `unknown`，包括候选未穷尽、超出搜索预算和未支持的特规。七个合作模组支持阵营目标，LL 使用下面的座位目标。

运行 `pnpm bench:decision` 可从这份 FS 示例的暗置记录重建全部 720 种分配，再分别关闭和打开终局证明缓存。两次搜索使用相同的行动顺序，均选在学校禁止密谋；关闭缓存用了 304560 步，打开后用了 18816 步，复用了 1436 次证明。记录重建另计 5770 步。只有从同一规则状态出发、在下次需要主人公选择前已能判定的终局才可复用。翻牌后仍需要选择医生目标等行动时，每种可见观察都保留自己的应对。

### 复核一份策略

在仓库根目录保存求解结果，再用同一份问题逐步检查策略树。下面两条命令适用于 PowerShell 7 和 Bash。

```bash
pnpm --silent solve:game products/engine/game-policy-example.json > policy.json
pnpm verify:policy products/engine/game-policy-example.json policy.json
```

复核入口接受整局、LL 个人和当日保人策略，以及从完整观察重建的问题。它在每个主人公提问处按可见记录匹配唯一应对，在其余提问处展开对手选择，直接运行正向规则直到目标达成或落空。`verified` 表示所有输入候选和后续分支均通过。`winningLeaves` 统计到达目标的分支次数，同一剧本可能产生多个分支。`workLimit` 同时适用于这里的正向复核，默认 100000；较复杂的成功策略可能比搜索时需要更多复核步数。

`counterexample` 随附发生问题的轮、日、阶段及从起点新增的可见记录，可区分败局、角色死亡、缺失或重复应对、指令非法等情形。只掌握部分世界时，一个实际反例仍能推翻策略，其余情况保留 `unknown`。宿主可以在命令末尾加 `--host-witness` 获取含真实剧本、暗牌和对手选择的重放，适合在揭晓后复盘。

### LL 个人获胜

```bash
pnpm solve:game products/engine/seat-policy-example.json
pnpm observe:decision products/engine/seat-policy-example.json p0
```

示例中巨型炸弹的轮回败北已经结算，轮到 C 推理第一天「骤变」的当事人。座位 p0 回答职员即可单独获胜。使用候选重放时，填入 `seat: "p0"`；使用完整观察时，由校对过的个人导出配合 `goal: {"kind":"seat-win","seat":"p0"}`。搜索起点是该座位自己的提问。Ex 发放后只读取本人的字母，其他两席的排列继续作为隐藏候选。

个人策略只决定本人行动。剧作家与另外两席的所有合法应对都必须能让该座位进入最终获胜者名单。因此队友有机会答错、竞争者 C 有机会独胜，都可能使个人保证落空。A 的死亡标志、B 的沟通标志、C 的联合答案和「最终计划」的希望均由正向引擎裁定。

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

## 事件公告与当事人

`pnpm solve:observed products/engine/incident-outcome-example.json` 重建第一轮的医院事故。三名候选中，医生的不安已达界限，公告明确说事件未发生，因此只留下男学生和巫女，共 8 条历史。设置 `incidentEvidence: false` 可逐状态用原正向历史复核。发生公告和效果公告分开处理，即使医院没有密谋、事故没有造成死亡，也保留宣告发生的历史。HSA 的区域事件同时计算角色尸体和区域的受害者标记；隐蔽触发、替班或抑制条件仍有可能时，交给正向重放。

## 评估指定行动

在工作台展开「评估指定行动」可以选择一张牌及目标、能力或最终答案。命令行使用 `pnpm solve:action products/engine/game-policy-example.json products/engine/school-block-choice.json`。同一张「禁止密谋」放在学校能保证获胜，放在医院则存在可击败主人公的应对。返回策略的第一步固定为指定行动，后续仍可依据新公告改变决策。公开观察问题、候选重放和剧作家问题均可输入；`illegal-opening` 表示该行动无法在全部候选中合法提交，`unknown` 表示搜索或候选覆盖不足。

## 剧作家决策

`pnpm solve:mastermind products/engine/mastermind-policy-example.json` 从剧作家正在选择的时点出发。示例中 FS「守护此地」的学校已有一枚密谋，在「流言四起」中选择学校，轮回末两枚密谋使剧作家获胜。输出的 `policy` 可以交给 `pnpm verify:policy <问题.json> <策略.json>` 独立重放。

问题文件使用 `perspective: "mastermind"`。目标 `loop-failure` 要求本轮尚未发生的主人公败北或死亡之后必然触发；`mastermind-win` 一直检查到正向裁定公布剧作家为整局胜者。在允许最终决战的模组，主人公碰巧全部答对也属于合法应对。只有对每个候选和所有应对都成立的行动才会得到保证。策略按剧作家收到的公告、自己选过的行动、自己的手牌和当前公开盘面分支；LL 的三张私人身份牌继续保密。输入候选应具有同一私有剧本和剧作家观察，`exhaustive` 填写候选是否完备。搜索超过 `workLimit` 或 `frontierLimit` 会返回 `unknown`。

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
CI 也运行 `pnpm check:decision` 和 `pnpm check:decision-ui`，分别检查决策内核和本地工作台。

根只有一套 pnpm/uv 活动锁文件。归档中的旧配置仅是历史副本，不参与自动安装。

[协作规范](AGENTS.md) · [GitHub 流程](CONTRIBUTING.md) · [归档与迁移清单](archive/README.md)
