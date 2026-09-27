# Tragedy Loop 工程协作

## 当前交付边界

本仓库目前是工程骨架，不包含活动游戏实现。技术方向为 React + Vite 前端、
Node.js + Fastify 后端、TypeScript 规则内核；Python + uv 仅用于辅助工具。
具体版本与依赖以各 package.json、根 pyproject.toml 及锁文件为准。

## 职责与边界

- `apps/web/src/`：未来 Web UI；`apps/server/src/`：未来服务入口。
- `packages/engine/src/`、`contracts/src/`、`content/src/`：未来规则、契约和运行内容。
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
源目录尚为空时，不添加虚假的成功构建、启动或测试入口；实现功能时再建立对应检查。

## 后续开发

方案文件总是以 HTML 格式交付。

保持 UI、服务、规则与公开契约分离；需要复用归档内容时显式选择、审阅并验证，不自动恢复旧应用。
有代码后运行匹配的检查；GUI 自动检查与人工验收分别记录，未经确认标记“待人类验收”。
GitHub 工作流见 CONTRIBUTING.md。保留其他任务的未提交内容，尤其不要暂存或提交 facts 的并行改动。
旧部署地址与历史 AGENTS/README 不构成部署授权。
