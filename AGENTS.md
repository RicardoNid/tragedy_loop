# GUI 开发与验收

本仓库使用两个测试入口：

- **自动GUI测试**：运行 `lunhui-engine` 中的 `pnpm gui:test`。场景、动作、断言、配置必须纳入版本控制；执行不依赖 Agent、模型或 computer use。操作流程见 [.agents/skills/auto-gui-test/SKILL.md](.agents/skills/auto-gui-test/SKILL.md)。
- **陪同GUI测试**：人类操作真实 GUI，Agent 观察、收集日志并整理反馈。流程见 [.agents/skills/accompanied-gui-test/SKILL.md](.agents/skills/accompanied-gui-test/SKILL.md)。

## 控件标识规范

所有 GUI 交互控件必须具有非空、稳定的 `data-testid`，包括链接、按钮、表单、弹窗内控件、自定义可点击/键盘操作控件以及错误重试入口。列表项用业务 ID，禁止使用数组位置、随机值、翻译文案作为标识。当前 DOM 内 ID 唯一；同一业务控件跨重渲染保持 ID。关键只读状态（阶段、计数器、结果、日志）同样提供 test ID 作为断言入口。浏览器原生弹窗通过其标准 dialog API 测试。

新增控件与 test ID 同时提交。用例覆盖的新状态必须执行控件 ID 审计；新增交互类型时扩充审计选择器。test ID 不替代可访问名称、键盘支持或正确的 HTML 语义。

## 每轮增量

代码与规则检查 → 自动GUI测试 → 部署实际页面 → 陪同GUI测试 → 人类明确验收。分别报告机器检查、自动GUI测试、人类验收的状态。人类未确认时记录“待人类验收”。修改验收中的代码前先结束该轮操作并保留现场，避免热更新污染证据。

自动测试使用独立进程、端口和对局，保留人工对局。失败先保留报告、trace、截图和日志；修复后重新执行，不能静默改写预期或用重试掩盖失败。HTTP/引擎测试不能替代 GUI 操作路径。
