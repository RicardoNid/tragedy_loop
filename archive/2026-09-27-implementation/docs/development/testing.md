# 验证

1. `pnpm check`：规则来源指纹、Python 来源校验/测试/Ruff、Prettier、TS 类型、Vitest、资料展示生成和生产构建。
2. `pnpm exec playwright install chromium`（首次需要；本机用 get-dep）。
3. `pnpm gui:test`：使用生产构建启动独立 5180 服务；端口占用则报告，不复用或终止人工服务。
4. 检查 `playwright-report/`、`test-results/` 的动作、trace、截图和异常记录。
5. 人类操作真实页面并明确反馈，之后才记录人工验收。

完整对局仍沿用原来的 66 步固定选择与独立预期，不依赖模型决定动作。
既有 238 项规则测试验证的是迁移后的既有行为，不是对官方规则或全部组合的认证。
服务测试另覆盖只读展示、旧写入口退出、来源与请求校验。资料展示 GUI 用例覆盖导航和检索。

失败先保留日志与 trace，再修复。不能重录预期、改规则指纹或用重试掩盖问题。
`pnpm gui:report` 可以打开报告；生成的运行产物保持忽略。
