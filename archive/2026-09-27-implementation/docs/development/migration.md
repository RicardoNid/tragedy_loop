# 项目整合清单

关联 GitHub Issue #5。用户已确认 React/Vite + Node/Fastify + TypeScript 交付物，
Python/uv 辅助工具，单一职责目录与基础 AGENTS.md；明确取消协作者在线资料校对。

| 原位置/能力 | 处理 | 新位置/说明 |
| --- | --- | --- |
| `integrations/lunhui/lunhui-engine/packages` | 保留行为、统一包名与显式依赖 | `packages/*`，`@tragedy/*` |
| 原 `apps/web/main.ts` | 用 React 重写界面，保留 test ID 与原对局预期 | `apps/web/src` |
| 原手写 HTTP 服务 | Fastify 替换；生产构建与开发共享 API | `apps/server/src` |
| 原 tests/e2e | 原规则测试与 66 步 GUI 路径迁移 | 根 `tests` / `e2e` |
| Lunhui 根规则正文/附录/图片 | 内容不改，保留来源身份 | `facts/sources/lunhui` |
| Ricardo 来源与结构化资料 | 归档保留，不参与现行规则解释 | `facts/sources/ricardo` / `facts/working/ricardo` |
| 旧引擎设计说明及两仓集成报告 | 标记历史，仅供追溯 | `docs/archive` |
| 规则全景和资料站 | 保留展示、调整来源路径、移除编辑导航 | `products/rules-atlas` / `products/public` |
| Python HTTP 服务、在线校对与回收部署脚本 | 从活动树删除 | Git 历史保留；无替代在线写入口 |
| Ricardo JS 游戏原型及测试 | 退出活动树 | Git 历史保留；不同时运行第二内核 |
| Python 工具 | 根 pyproject/uv.lock 管理 | `python/src/tragedy_tools` |
| npm 根锁 + 嵌套 pnpm 锁 | 合为单一 pnpm workspace | 根 `pnpm-lock.yaml` |
| 旧嵌套 AGENTS/技能/工作流 | 移除失效入口，现行要求集中维护 | 根 AGENTS、测试说明、CI |

## 规则与并行工作边界

本任务开始时工作区已有规则研究与展示页，已在 `.local-imports/pre-unify/` 保留迁移前副本。
迁移过程中另一项规则整理工作添加了 `facts/CONTEXT.md`、`facts/decisions/scope.md` 和
`facts/canonical/source-policy.md`。工程说明引用其最新政策，未代替它重新裁定规则。
展示页的路径适配与规则内容的变更须分别理解；资料来源 SHA256 仍可追溯。

五份引擎基线文档只改 manifest 中的路径，SHA256 值未改。保留了所有原引擎测试与 GUI
动作预期；原 JS 原型测试不计入新内核覆盖数。

## 分支基础

工作从 `404d8eb` 创建 `codex/5-unified-web-foundation`，依赖前一项
`codex/github-upstream-workflow` 尚未合入 main 的整合与上游配置提交。
没有在本任务中擅自合并那项工作或推送 main。

## 未包含

本次不是联机产品开发、规则全文仲裁、剧本编辑器开发或服务器部署。
未决定的席位分配、找回和剧本编辑细节留给后续任务。
