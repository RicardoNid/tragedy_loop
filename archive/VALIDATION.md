# 骨架重整验证（2026-09-27）

本次验收对象是空工程骨架，旧实现通过过的应用测试不计入本次结果。

| 目标 | 当前证据 |
| --- | --- |
| 不操作 facts | 迁移脚本和检查显式排除该子树；未写入、移动、删除或格式化它，也未暂存/提交其改动 |
| 旧实现只作参考 | 144 个迁移文件逐项 SHA256 校验通过；另 102 个旧代码文件与 Git 404d8eb 逐字节一致 |
| 活动源目录为空 | 13 个预留目录均只有 .gitkeep；其余活动包只含 package.json / tsconfig.json |
| 统一项目配置 | 根 pnpm workspace 与 pnpm-lock.yaml；根 pyproject.toml 与 uv.lock；Python package=false，无旧 CLI |
| 不残留旧执行入口 | 根 scripts 没有 dev/start/build/test/gui/baseline/atlas/slides；无活动 Playwright/Vitest 应用配置 |
| 编译器配置可用 | web/server 配置通过 TypeScript 配置解析，源码文件数为 0（预期） |
| 可重建环境 | 不复制 facts、archive、node_modules 或 .venv 的干净副本，冻结离线安装和 pnpm check 均通过 |
| 停止旧演示 | 原本由本任务启动的 5273 服务已停止，端口监听检查为空 |
| 协作规范 | 根 AGENTS.md 明确骨架状态、facts 独立所有权、archive 只读参考、配置检查的实际含义 |

没有应用行为、GUI 或规则语义验收声明。本次不提交、推送或合并混合工作区。
干净副本验证日志在本机 /tmp/tragedy-scaffold-clean.log；归档清单见 migration-map.json。
