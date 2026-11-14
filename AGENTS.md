# Tragedy Loop 工程协作

## 当前交付边界

本仓库已有独立 TypeScript 规则内核、双方输入输出契约和官方规则内容包；
Web UI 与服务仍是工程骨架。技术方向为 React + Vite 前端、
Node.js + Fastify 后端；Python + uv 仅用于辅助工具。
具体版本与依赖以各 package.json、根 pyproject.toml 及锁文件为准。

## 职责与边界

- `apps/web/src/`：未来 Web UI；`apps/server/src/`：未来服务入口。
- `packages/engine/src/`、`packages/contracts/src/`、`packages/content/src/`：规则内核、契约和运行内容；`runtime/` 与 `official/` 为当前执行实现。
- `python/src/tragedy_tools/`、`python/tests/`：未来 Python 辅助工具与测试。
- `tests/`、`e2e/`、`scripts/`、`products/`、`docs/`：为后续工作预留。
- **`facts/` 由“规则真源”任务独立维护本地 wiki。本工程整理任务不得写入、移动、删除、格式化或生成该目录下的内容。**
- `archive/` 保存旧代码、页面和说明，仅供参考，不是活动应用、规则权威或当前执行指令。

将来开发规则相关功能时，读取 facts 当时的入口说明，不在本文件复制其内部目录设计或权威裁定。
资料由项目维护者自行校对；不得从旧代码恢复对外协作者在线校对与资料回收流程。

## 环境与验证

JS/TS 只使用根 pnpm workspace 和 pnpm-lock.yaml；Python 只使用根 pyproject.toml 和 uv.lock。
新增依赖写入实际使用它的 workspace，更新相应锁文件。安装方法见 README.md。
命令显式限定活动目录；禁止对全仓运行会写入 facts 或 archive 的格式化、生成、修复命令。
当前 `pnpm check` 只验证配置格式和 Python 锁文件，不能报告为应用测试通过。
`pnpm check:engine` 验证内核类型和回归；`pnpm check:rules` 验证独立机器规则资产。
`pnpm report:engine` 重跑内核检查并生成 `products/engine/` 实现与验收 HTML、基准和重放记录。
源目录尚为空时，不添加虚假的成功构建、启动或测试入口；实现功能时再建立对应检查。

## 后续开发

方案文件总是以 HTML 格式交付。供人工使用的本地测试 HTML 应可直接双击运行。优先交付自包含入口，尽量避免新增 CMD、BAT 或其他启动包装程序。

## 工作产物与临时文件清理

- 工作过程中及时清理已被替代的旧方案和重复产物，默认只保留当前有效方案；仅保留对来源追溯、关键决策或验证复现确有必要的历史数据。
- 每次任务交付前，核对并删除本任务用完的一次性脚本、命令行文件（如 BAT、CMD、PowerShell 或 Shell 脚本）、临时测试文件及其他临时产物，包括运行日志、中间数据、检查截图和临时导出文件。
- 需要长期复用的工具、正式回归测试和必要的验证证据按项目约定保留，并在交付时说明仍需保留的临时文件及原因。
- 清理前确认最新交付完整可用，核对待清理文件的归属与用途；仅清理本任务可确认的产物，不删除其他任务的未提交内容或用户原始资料。
- 清理后更新受影响的引用与交付说明，避免继续引导用户访问已删除的旧方案。
- 本清理要求不扩大目录权限：仍不得改动 `facts/`，也不据此清理 `archive/`。不要对全仓或系统临时目录执行无差别删除。

## 协作与交付

保持 UI、服务、规则与公开契约分离；需要复用归档内容时显式选择、审阅并验证，不自动恢复旧应用。
有代码后运行匹配的检查；GUI 自动检查与人工验收分别记录，未经确认标记“待人类验收”。
GitHub 工作流见 CONTRIBUTING.md。保留其他任务的未提交内容，尤其不要暂存或提交 facts 的并行改动。
旧部署地址与历史 AGENTS/README 不构成部署授权。
