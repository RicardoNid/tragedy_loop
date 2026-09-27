# Tragedy Loop 协作约定

## 目标与目录

这是两份 Tragedy Looper 项目的本地合并仓库。调整目录、整合规则内核或更新上游时，
先读 `docs/integration/plan.md`，并核对 `docs/integration/sources.json` 的来源 SHA。
安装或排查依赖时读 `docs/integration/environment.md`。

- `facts/`：有出处的游戏事实、审阅稿与结构化资料。
- `code/`：Python 资料服务、JavaScript Web 原型与测试。
- `products/`：教学课件与资料站产物。
- `docs/`：工程设计、开发说明、合并决策与验证记录。
- `integrations/lunhui/`：保留原路径的规则文档、TypeScript 引擎及 GUI；遵守其下 `AGENTS.md`。
- `.sources/`：忽略的独立原始 clone；不在这里开发。
- `.local-imports/`：忽略的源目录未提交资料副本；不自动发布。

## 环境与常用命令

Python 3.12 + uv，Node 22.22.1，根目录 npm，Lunhui 使用 pnpm 11.25.0。
依赖以 `uv.lock`、`package-lock.json` 和嵌套 `pnpm-lock.yaml` 为准。

- `npm run setup`：按锁文件安装三套依赖。
- `npm run check`：Python 检查、JS 测试、TS 规则指纹/格式/类型/测试和 GUI 构建。
- `npm run app:serve`：资料站及旧原型，127.0.0.1:5173。
- `npm run engine:serve`：Lunhui GUI，127.0.0.1:5174。
- `npm run engine:gui:test`：独立 5180 端口上的 Playwright 回归。

本机下载使用 `get-dep`；安装脚本在其他机器上允许直接使用包管理器。
不要提交虚拟环境、node_modules、运行日志、密钥或浏览器测试产物。
修改依赖时同步更新相应锁文件，不混用 npm 与 pnpm 的安装目录。

## 规则与测试

两套规则内核目前并存，不能宣称已经行为统一。未知规则先记录来源、差异和待裁定项，
不要凭空编码。不得为通过检查直接重写 Lunhui 的规则指纹或放宽测试预期。
游戏逻辑与 GUI 分离；隐藏身份、私有视图和存档必须留在可信宿主。
GUI 控件使用稳定、唯一的 data-testid，同时保留可访问名称和键盘语义。
自动检查、自动 GUI 测试和人工验收分别报告；未有人类确认时写“待人类验收”。
失败保留 trace、截图和日志，不覆盖人工服务或为了通过而重试掩盖失败。

## Git 与发布

统一上游为公开 GitHub 仓库 `RicardoNid/tragedy_loop`，远程名 `origin`，默认分支 `main`。
`ricardo` 和 `personal` 仅用于来源追踪；Issue、PR 和 merge 使用 GitHub CLI（`gh`），
不使用 Forgejo connector。后续开发遵守 `CONTRIBUTING.md` 的 Issue → 分支 → PR → merge 流程。
禁止直接推送 main 或强推共享分支。推送开发分支及创建 PR 按当前任务授权执行；部署须单独授权。
`code/tools/server_sync.py` 及历史文档中的 NAS/服务器地址属于原项目，未针对本仓库验证；
根 package.json 已移除其发布快捷命令。不要依据归档 AGENTS 或历史说明自动部署。
修改事实资料须保留来源；扫描原件与大体积素材不自动纳入 Git。
