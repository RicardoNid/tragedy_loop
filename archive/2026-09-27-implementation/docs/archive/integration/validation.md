# 本次验证

日期：2026-09-27（Asia/Shanghai）。本地 Linux x86_64，版本见 environment.md。

| 验证 | 结果 |
| --- | --- |
| `npm run setup` | 通过；uv locked、npm ci、pnpm frozen lockfile |
| Python pytest | 9 通过 |
| Ruff `check code` | 通过 |
| Ricardo JS 规则测试 | 29 通过 |
| Lunhui 规则文档指纹 | 5 份通过，未改写指纹 |
| Lunhui Prettier / TypeScript | 通过 |
| Lunhui Vitest | 14 文件、238 测试通过 |
| Vite GUI 构建 | 通过 |
| Playwright GUI | 3 通过，含 66 次 GUI 选择的完整 First Steps 对局、重置取消/确认和断线重试 |
| Python 服务启动 | 临时端口 40387，首页、/prototype/、/site/ 均 HTTP 200 且非空 |
| Lunhui 服务启动 | 临时端口 39603，首页 HTTP 200 且非空 |
| 人工 GUI 验收 | 待人类验收 |
| GitHub Actions 远端 CI | 已配置，未推送，未在远端运行 |
| 教学课件全量重新生成 | 本次未运行 |

默认端口已有服务占用，未连接或终止已有服务。启动冒烟采用本次临时创建的独立进程，
结束后已终止这些进程。HTTP 200 只证明路由与本地资源可访问，不替代 GUI 回归。

初次 get-dep uv sync --locked 因其注入 NAS 索引、与锁中官方索引不同而拒绝；
安装脚本增加显式官方索引后，完整 setup 通过。三套依赖锁定版本未升级。
仍存在上游依赖提示：MathJax 3 废弃提示，以及 uv 与上游 uv_build 范围不相同的构建提示；
本次实际构建、安装和测试通过，未为消除提示无关升级依赖。

本机完整命令日志位于 `.local-imports/validation/`（忽略、不随 clone 分发）。
GUI HTML 报告位于 `integrations/lunhui/lunhui-engine/playwright-report/index.html`，
trace/动作附件位于相邻 `test-results/`。这次通过只覆盖现有测试场景，不证明两套内核等价。
