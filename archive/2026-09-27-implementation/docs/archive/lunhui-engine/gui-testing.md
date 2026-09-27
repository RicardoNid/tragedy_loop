# GUI 测试入口

## 自动GUI测试

自动GUI测试是仓库内独立的 Playwright Test 程序。运行不需要 Codex、Agent、模型 API 或 computer use 会话。浏览器可以有头或无头；两者执行同一组测试。

```bash
# 在 lunhui-engine 下；首次安装
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
# Linux CI 缺少浏览器系统库时按环境安装所需依赖：
# pnpm exec playwright install --with-deps chromium

pnpm gui:test
pnpm gui:test:headed
pnpm gui:test:report
```

本机联网安装遵循 get-dep 入口：在安装命令前加 `get-dep`。

配置为 `playwright.config.ts`，固定动作在 `e2e/first-steps-path.ts`，断言在 `e2e/first-steps.spec.ts`。测试自行启动 5180 端口的独立引擎，退出后由测试框架停止，拒绝复用已经占用的端口。5173/5174 上的人工或演示对局不参与测试。

First Steps 当前场景不使用随机洗牌。66 次选择明确指定席位、阶段、卡牌与目标，不根据引擎提供的第一项来猜下一步；只通过 DOM 控件操作对局。每步检查按钮可用状态、选中状态、状态修订推进、控件 ID 完整性和唯一性。每日检查角色友好与医生密谋计数；结尾检查第一轮第四日主人公获胜、医院事故与自杀未发生。浏览器 warning/error、未捕获异常、网络失败与 HTTP 4xx/5xx 使主路径失败。

另有重新开局取消/确认、席位身份可见性和连接失败后重试用例。连接失败用例明确注入网络故障；完整游戏用例使用真实引擎和网络，不 mock。

覆盖边界：当前是一个初始剧本 happy path，不覆盖第二/三轮、事件成功触发、死亡分支、所有卡牌能力、其他模组或完整多人保密。它证明 GUI 可完成这条路径，不证明全部规则正确。

`playwright-report/` 为 HTML 报告，`test-results/` 保存录像、trace、失败截图、每日盘面截图及动作/异常附件。它们是本地生成物，已忽略；代码、配置、场景和规范应版本化。缺少浏览器、端口被占用、断言失败都应使命令非零退出。保留失败证据后才重跑；本配置默认不重试。

## 陪同GUI测试

人类操作真实页面，Agent 观察、读取实际可用的日志、收集反馈，之后将可重复问题补入自动GUI测试。当前尚未实现统一日志采集器、反馈按钮或自动唤醒；这些能力作为后续增量，不属于本次自动测试交付。

验收状态分别记录：代码检查、自动GUI测试、陪同GUI测试、人类验收。自动通过只能进入待人类验收。
