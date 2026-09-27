# Tragedy Loop · 项目骨架

当前交付的是**结构、配置和协作边界**。旧游戏、服务、资料页面、测试和生成工具均已移入
`archive/`，不再作为活动实现运行。尚无可启动游戏应用；不提供 dev/start/build/test 假入口。

计划技术栈：React + Vite、Node.js + Fastify、TypeScript；Python + uv 用于未来辅助工具。
JS/TS 的版本、workspace 依赖和锁定记录已经配置。Python 环境是非打包环境，暂不声明 CLI 或构建包。

`facts/` 是独立静态规则资料站，图片、正文和来源快照随普通 Git 同步，无需 LFS 或 Wiki 登录。
克隆后从仓库根运行 `python3 -m http.server 5188 --bind 127.0.0.1`，打开 http://127.0.0.1:5188/facts/ 。

## 目录

```text
apps/
  web/                 package.json、tsconfig.json；src/ 空
  server/              package.json、tsconfig.json；src/ 空
packages/
  engine/              src/ 空；prototypes/ 保存独立 HTML 设计原型
  contracts/           package.json；src/ 空
  content/             package.json；src/ 空
python/
  src/tragedy_tools/    空
  tests/               空
tests/                 空
e2e/                   空
scripts/               空
products/              空
docs/
  architecture/        HTML 方案、术语阅读版和算法交接
  development/         空
facts/                 独立的“规则真源”任务维护；本次不修改
archive/               旧实现与归档说明；不参与 workspace 或检查
```

空目录通过 `.gitkeep` 保留。未来实现应从这些空目录开始，按需参考 archive；不以旧测试或
旧引擎实现自动认定规则正确。facts 的 wiki 结构和权威约定由该目录负责的任务决定。

## 设计阅读入口

- [核心状态机方案](docs/architecture/framework.html)
- [领域术语阅读版](docs/architecture/glossary.html)（对应根 [CONTEXT.md](CONTEXT.md)）
- [解空间与算法交接 Prompt](docs/architecture/handoff-prompt.html)
- [FS 完整对局交互原型](packages/engine/prototypes/fs-first-script.prototype.html)

克隆仓库后，用浏览器打开这些 HTML 文件即可阅读；原型单文件离线运行，无需安装依赖。
原型保留教学编排、实现范围和待验收标记，不作为活动引擎或规则权威。
方案文件总是以 HTML 格式交付。

## 安装和配置检查

Node 版本见 `.node-version`（当前 22.22.1），pnpm 版本见 package.json（11.25.0），
Python 版本见 `.python-version`（3.12）；使用 uv 管理 Python 环境。

```bash
pnpm install --frozen-lockfile
uv sync --locked --python 3.12 --default-index https://pypi.org/simple
pnpm check
```

本机联网安装在命令前加 `get-dep`。`pnpm check` 只校验配置格式和 Python 锁一致性；
CI 另外执行冻结安装。当前没有活动应用代码或应用单元测试；独立原型已有浏览器操作检查，领域规则仍待人类验收。
TypeScript 配置已为 web/server 预置；等出现源码后再运行类型检查和构建。

根只有一套 pnpm/uv 活动锁文件。归档中的旧配置仅是历史副本，不参与自动安装。

[协作规范](AGENTS.md) · [GitHub 流程](CONTRIBUTING.md) · [归档与迁移清单](archive/README.md)
