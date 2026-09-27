# 整合验证记录

2026-09-27，Linux x86_64；Node 22.22.1、pnpm 11.25.0、Python 3.12。

| 验证 | 结果 |
| --- | --- |
| 冻结安装 `pnpm setup` | 通过，只有根 pnpm/uv 两个锁文件 |
| 五份原规则文档指纹 | 通过，SHA256 值与迁移前完全一致 |
| Python 来源工具与 pytest | 通过，1 项测试覆盖内容变化、缺失与越界路径 |
| Ruff / Prettier / TypeScript | 通过 |
| Vitest | 15 文件、240 测试通过（原引擎 238 + 新服务边界 2） |
| 生产构建 | React/Vite 与 Node/Fastify bundle 通过 |
| GUI | 4 通过：原 66 步整局、重置、错误恢复，以及资料导航/检索/本地来源链接 |
| 干净副本 | 排除 .venv、node_modules、dist、本机备份后重新冻结安装与完整 check，通过 |
| 原研究笔记 | 与迁移前副本逐字节一致 |
| 人工 GUI 验收 | 待人类验收 |
| 远端 CI / PR / 部署 | 本轮未推送、未运行远端 CI、未部署 |

原 Python 资料服务的 9 项测试和旧 JS 原型的 29 项测试随对应实现退出活动代码，
没有将其计入新内核覆盖。新通过数字不代表规则已获独立资格认可。

失败与修复：新增服务测试起初将隐藏文件的显式 403 拒绝误写为 404，已分别验证
隐藏文件拒绝与旧 API 不存在；资料展示测试发现原页面指向忽略目录中的完整性分析，
已将该稿按原文移至 facts/working/lunhui 并更新链接，不开放忽略目录。
失败 trace 保存在本机 `.local-imports/migration-failures/`，未通过重试绕过。

当前报告：根 `playwright-report/index.html`；trace、视频、截图在 `test-results/`。
干净副本检查日志与本机验证日志快照位于 `.local-imports/unified-validation/`（不随 clone 分发）。

当前工作区同时包含另一项规则整理工作。本次未将混合工作区直接提交或推送；
后续按 CONTRIBUTING.md 分离可审阅的提交并通过 PR 交付。
