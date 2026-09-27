# Tragedy Loop

《惨剧轮回》的资料整理、教学内容与 Web 游戏开发仓库。现已把 Ricardo 的资料/原型项目与
personal 中的 Lunhui 引擎项目纳入一个 Git 仓库，保留双方提交历史。
**目前完成目录与开发环境整合，两套规则内核尚未统一。**

## 快速开始

安装 Python 3.12、uv 0.12.7、Node.js 22.22.1、npm 9+、pnpm 11.25.0 后：

新规则引擎在独立 package [code/packages/engine](code/packages/engine/README.md) 中从零重写；目前提供声明式执行骨架、CLI 模拟与重放，尚未覆盖真实游戏规则。设计原则与后续范围通过 package 内的分层上下文维护。使用 `npm run engine:test` 验证，使用 `npm run engine:simulate -- --seed 42` 运行合成场景。现有 Web 原型仍使用旧核心。

```bash
npm run setup
npm run check
npm run app:serve       # http://127.0.0.1:5173，资料站和 Ricardo 原型
# 在另一个终端
npm run engine:serve    # http://127.0.0.1:5174，Lunhui 游戏 GUI
```

端口被占用时可用 `APP_PORT=5273 npm run app:serve` 或
`GUI_PORT=5274 npm run engine:serve` 指定空闲端口，不影响已有服务。

自动 GUI 测试额外需要浏览器和系统依赖：

```bash
cd integrations/lunhui/lunhui-engine
pnpm exec playwright install chromium
# Linux 缺少共享库时按 Playwright 提示安装系统依赖
cd ../../..
npm run engine:gui:test
```

本机联网下载在命令前加 `get-dep`；`npm run setup` 会自动检测并使用它。
Playwright 使用独立端口 5180，端口被占用时应先确认用途，不终止未知服务。

## 项目入口

| 路径 | 用途 |
| --- | --- |
| `facts/` | 资料、事实审阅、结构化输入 |
| `code/` | Python 服务、JavaScript 原型及测试 |
| `products/` | 教学幻灯片、资料站 |
| `integrations/lunhui/lunhui-engine/` | TypeScript 规则引擎、内容、传输契约及 GUI |
| `integrations/lunhui/` | 引擎依赖的原始规则文档与本地协作技能 |
| `docs/integration/` | 来源清单、合并方案、环境及验证记录 |

根目录 npm 负责教学工具和统一命令，嵌套 pnpm workspace 负责引擎，uv 负责 Python。
三套锁文件都保留；安装使用冻结锁文件，不依赖全局 Python 包。

- [合并方案与后续工作](docs/integration/plan.md)
- [运行环境和依赖](docs/integration/environment.md)
- [验证记录](docs/integration/validation.md)
- [协作规范](AGENTS.md)
- [Ricardo 原 README（路径相对原仓库根目录）](docs/integration/upstream/ricardo-README.md)
- [Lunhui 使用说明](integrations/lunhui/lunhui-engine/README.md)

本次未发布到远端，也未部署或重启原服务器。历史部署脚本须重新适配后才能使用。
