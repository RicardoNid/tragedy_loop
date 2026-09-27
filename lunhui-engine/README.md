# 轮回规则引擎 · 流程重构版 v2

按全阶段图、事件阶段图与独立步骤稿重写的无界面规则引擎。保留 TypeScript strict、pnpm workspace、Zod、Vitest 框架。玩家仅提交选择，引擎自行推进阶段和结算后续。

当前已接入八个模组的规则、身份、事件和角色内容，并有各模组合法配置的整局测试；这不等于所有规则交叉组合已经逐条验收。具体证据和剩余边界见 [进度记录](docs/progress.md)。

## 运行

在本目录 PowerShell 中执行：

```powershell
.\run.ps1 check
.\run.ps1 demo
```

需要 Node.js 22 或更新版本。启动器优先选择本机 Codex 附带的 Node；已安装依赖时直接调用实际检查程序，不通过备用包管理器转发。首次安装可使用 `pnpm install --frozen-lockfile`。其他环境使用 `pnpm check` 和 `pnpm demo`。演示与测试不需要模型密钥或网络。

`check` 依次执行五份源文档指纹检查、格式检查、严格类型检查和测试。演示是 First Steps 自动选择走完一局，不是游戏界面，也不是智能玩家。

## 使用

```ts
import { Engine, createGame } from './packages/engine/src/index.js';
import { createCatalog, firstStepsScenario } from './packages/content/src/index.js';

const catalog = createCatalog();
const engine = new Engine(createGame(firstStepsScenario(), catalog), catalog);
engine.start(); // 无须宿主手动指定阶段或来源

const waiting = engine.waiting; // 仅供可信宿主，玩家用 view(seat).waiting
if (waiting) {
  const receipt = engine.submit(waiting.actor, {
    protocolVersion: 2,
    sessionId: 'local',
    branchId: 'main',
    commandId: 'example-command-1',
    expectedRevision: waiting.revision,
    waitingInputId: waiting.id,
    command: {
      kind: 'choose',
      optionIds: waiting.options.slice(0, waiting.minSelections).map((o) => o.id),
    },
  });
}

const saved = engine.serialize(); // 含秘密和执行栈，只能保存于宿主
const restored = Engine.restore(saved, catalog);
const playerView = restored.view('protagonistA');
```

公开视图只包含公开盘面、公开事件表、本席手牌、本席秘密字母及本席当前选择。实际事件名、当事人、未公开身份、内部来源和原始存档不能发给玩家。

## 实现入口

- `packages/contracts`：选择命令、席位视图和本机传输契约。
- `packages/engine`：自主阶段机、同时批次、常驻派生、死亡保护与替代、事件、延迟任务、轮回重置、最终决战、存档。
- `packages/content`：八模组内容表、身份和角色能力；`appendix-data.json` 从本地附录导入。
- `packages/transport`：由宿主绑定席位的本机适配器；不是远端认证服务。
- `tests`：动作、结算、能力、模组边界、完整流程和恢复测试。
- [流程映射](docs/flow-implementation.md)、[裁定及信任边界](docs/rulings.md)、[内容与测试映射](docs/rule-index.md)、[公开日志](docs/public-announcement-plan.md)。

v1 的 `start(sources)`、`beginLoopEnd`、`announcementsFor` 等接口不再适用。存档版本为 2；不承诺迁移旧模型存档。UI、网络服务器、数据库和模型玩家不属于本轮规则内核重构。

## 本地 Web GUI

基础 GUI 使用 TypeScript + Vite；Node 本地服务持有引擎，通过 HTTP 提供席位快照和选择提交。引擎依赖 `node:crypto`，因此不把引擎或原始存档打包到浏览器。无需 Qt 或模型密钥。

```bash
pnpm install --frozen-lockfile
pnpm gui
# 浏览器打开 http://127.0.0.1:5173
```

入口为 `apps/web/server.ts`（服务）和 `apps/web/main.ts`（界面）。支持 First Steps 剧本、四地点角色盘面、当前选择、席位切换、手牌、公开事件与日志、结局和重新开局。先选择初始队长，再按右侧提示提交选择；等待其他席位时点击“切换到当前行动席位”。

这是单机共用屏幕的演示工具：任意操作人均可切换剧作家或主人公席位，不能当作保密多人对局。服务仅绑定本机 `127.0.0.1:5173`，所有标签页共享同一局。刷新页面保留服务中的进度，重启服务或重新开局会丢弃当前对局；尚未提供存档和联网认证。

`pnpm gui:build` 验证前端构建，产物位于 `apps/web/dist/`；该静态产物需要配套 API，不能独立作为完整游戏运行。`pnpm check` 继续检查整个项目。

## GUI 测试入口

- **自动GUI测试**：`pnpm gui:test`，独立 Playwright 程序，无需 Agent；`pnpm gui:test:headed` 可观看执行，`pnpm gui:test:report` 查看录像、步骤和报告。
- **陪同GUI测试**：人类操作，Agent 观察和整理反馈，人类决定验收。

首次需 `pnpm exec playwright install chromium`。详细范围、隔离策略及证据位置见 [GUI 测试说明](docs/gui-testing.md)，控件 test ID 规范见仓库根 `AGENTS.md`。本地服务可通过 `GUI_PORT` 指定端口，默认 5173。
