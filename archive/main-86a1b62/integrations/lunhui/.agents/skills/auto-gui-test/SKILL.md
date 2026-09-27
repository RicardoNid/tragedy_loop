---
name: auto-gui-test
description: 执行本仓库的自动GUI测试，展示固定场景、程序化浏览器动作、断言及报告；用于增量回归或完整初始剧本演示。
---

# 自动GUI测试

执行契约见 [测试说明](../../../lunhui-engine/docs/gui-testing.md)。在 `lunhui-engine` 运行 `pnpm gui:test`，需要可见独立浏览器时运行 `pnpm gui:test:headed`。执行者是 Playwright Test，skill 只启动程序、读结果；Agent 不参与选牌、重试决策或页面驱动。环境安装以 README 为准。

1. 确认本轮代码和测试场景；保存 `git status`，保留其他任务改动。
2. 执行 `pnpm check`、`pnpm gui:build` 和 `pnpm gui:test`。端口冲突时报告阻塞，不连接人工服务或终止未知进程。
3. 检查退出码、测试结果、动作附件及浏览器异常附件；失败时保留证据并复现。所有动作和断言修改都必须有业务理由，不能为了通过而替换预期。
4. 用 `pnpm gui:test:report` 展示报告及录像，说明实际覆盖范围和未覆盖项。
5. 报告“自动GUI测试通过/失败”；人类验收单列，未确认就是“待人类验收”。

不得将现场 computer use 演示、直接调用 API 或引擎方法的运行，标记为本入口通过。
