# Tragedy Loop

统一的《惨剧轮回》Web 工程：**React + Vite、Node.js + Fastify、TypeScript 规则内核**。
Python + uv 用于资料整理、来源校验和教学生成。两份来源项目的规则与设计保留出处，
不再作为两套独立应用运行。

## 本地运行

使用 `.node-version` 指定的 Node、`package.json` 指定的 pnpm 和 Python 3.12 / uv：

```bash
pnpm setup           # 按两个锁文件安装 JS/TS 与 Python 依赖
pnpm check           # 来源指纹、Python、格式、类型、测试、展示生成与生产构建
pnpm dev             # 单入口开发服务 http://127.0.0.1:5173
# 或生产构建后：
pnpm build
pnpm start
```

`PORT=5273 pnpm dev` 可使用其他空闲端口。当前保留可切换席位的单机演示，
监听本地环回地址；本次未添加房间、账户或联机权限，勿当成保密联机服务。

- `/`：React 游戏基线。
- `/site/`：只读资料导航与原有教学页面。
- `/products/rules-atlas/index.html`：复用的规则/模组/剧本资料展示。

资料由项目维护者自行校对，已移除在线协作者校对和旧部署入口。
规则采用范围见 `facts/canonical/source-policy.md`；框架迁移不意味着所有规则组合已经通过验收。

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` / `apps/server` | React 界面 / Fastify 服务 |
| `packages/engine` | 唯一执行规则内核 |
| `packages/contracts` / `content` / `transport` | 公共契约、内容、传输适配 |
| `python/src/tragedy_tools` | 来源校验、教学生成辅助工具 |
| `facts/sources` / `working` / `canonical` | 来源 / 待核对资料 / 已批准规范 |
| `products` | 规则展示、教学源文件与静态产物 |
| `tests` / `e2e` | 内核与服务测试 / 自动 GUI 回归 |
| `docs/architecture` / `development` / `archive` | 现行设计 / 操作说明 / 历史证据 |

JS/TS 只有根 `pnpm-lock.yaml`；每个 workspace 的 `package.json` 声明实际依赖。
Python 只有根 `pyproject.toml` 和 `uv.lock`，不依赖系统安装的 Python 库。

[运行环境](docs/development/environment.md) · [测试](docs/development/testing.md) ·
[架构](docs/architecture/foundation.md) · [规则来源政策](docs/development/rule-sources.md) ·
[迁移清单](docs/development/migration.md) · [验证记录](docs/development/validation.md) · [协作规范](AGENTS.md)
