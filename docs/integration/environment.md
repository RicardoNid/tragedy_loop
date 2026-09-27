# 开发环境与依赖

基线：Linux x86_64 / Bash；Python 3.12，Node.js 22 LTS（>=22.12 <23）。
本次实测 Node 22.22.1、npm 9.2.0、pnpm 11.25.0、uv 0.12.7、Python 3.12.14。
`.node-version` 固定 Node 补丁版本，`.python-version` 选择 Python 3.12 系列。
macOS/Windows 尚未验证；根 shell 脚本和 `GUI_PORT=...` 语法需要 Bash/POSIX 环境。

| 范围 | 声明 / 锁 | 安装 | 说明 |
| --- | --- | --- | --- |
| Python | `pyproject.toml` / `uv.lock` | `uv sync --locked --python 3.12` | 根 `.venv`，运行服务无第三方运行依赖；开发含 pytest、ruff；uv_build 构建 |
| 教学工具 | `package.json` / `package-lock.json` | `npm ci` | Marp、Mermaid CLI，渲染依赖浏览器 |
| TS 引擎 | `integrations/lunhui/lunhui-engine/package.json` / `pnpm-lock.yaml` | 该目录 `pnpm install --frozen-lockfile` | Zod、TypeScript、Vitest、Vite、tsx、Playwright；pnpm workspace |

具体传递依赖和版本以锁文件为准，不在文档重复维护一份依赖清单。
根 npm 不管理嵌套 workspace；不要在引擎目录运行 npm install。
首次 GUI 测试需要 `pnpm exec playwright install chromium`，Linux 系统库按实际缺失安装。
课件渲染需要的 Puppeteer 浏览器与 Playwright 浏览器独立管理。

默认监听本地环回地址：Ricardo 5173、Lunhui 5174，GUI 自动回归 5180。
运行资料编辑器会写入当前仓库 facts；游戏日志写 runtime（忽略）。
无需模型 API key 或数据库；不要把这些本地服务直接当作经过认证的公网多人服务。

CI 跑基础自动检查和 GUI 回归；完整课件重新生成与人工 GUI 验收独立记录。

Python 锁文件记录官方 PyPI 来源。安装脚本显式指定官方索引，避免 get-dep 注入的
NAS 索引导致 `--locked` 要求重写来源；仍通过 get-dep 选择网络路径。
