# 环境与安装

Node 基线 22.22.1，pnpm 11.25.0，Python 3.12，uv 0.12.7。
版本约束分别在 `.node-version`、`package.json`、`.python-version`、`pyproject.toml`。
首次执行 `pnpm setup`；CI 与本地均使用冻结安装。

根 `package.json` 编排命令，各 workspace 显式记录依赖。只有一个 JS/TS 锁文件，
不要运行 npm install 或在子目录引入另一个锁文件。`pnpm-workspace.yaml` 明确允许 esbuild
构建，禁用 Puppeteer 自动下载；课件 HTML 构建不需自动安装浏览器。

本机下载通过 get-dep，安装脚本自动检测；Python 显式使用锁中官方索引以免注入缓存索引
导致 locked 校验失败。其他机器可以直接使用 pnpm/uv。系统 Python 库不是项目依赖来源。

Python 命令：`uv run --locked tragedy-sources` 校验原规则指纹；
`pnpm atlas:build` 重建规则展示；`pnpm slides:generate` 生成教学稿。
旧教学生成仅用于复现历史材料，不参与当前规则解释。它会读取历史扫描转录，其中部分原始文件尚未进入仓库；缺少时会明确报错，
不将已保留教学 HTML 的可读性宣称为全量重生成已验证。

GUI 测试首次安装：`pnpm exec playwright install chromium`；Linux 按提示安装系统库。
本机联网下载加 get-dep。GUI 测试运行在 5180，开发默认 5173，PORT 可覆盖。

本地验证按 Linux/Bash。其他系统尚未验证；Python 工具和 TS 配置本身不绑定私有服务器。
