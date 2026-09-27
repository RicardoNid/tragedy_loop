# Tragedy Loop

## 当前目标

维护一个 Web 项目：React/TypeScript 前端、Fastify/TypeScript 后端、独立规则内核。
Python 由 uv 管理，只承担资料整理、校验与生成工具，不提供第二套游戏或资料编辑服务。
当前整合以保留已有行为并通过迁移验证为目标，未实施的联机功能不得宣称已支持。

## 目录与配置

- `apps/web`、`apps/server`：界面与 HTTP 服务；`packages/`：规则、契约、内容与传输适配。
- `python/`：辅助工具；`products/`：规则展示、教学材料与静态资源。
- `facts/sources/`：来源材料；`facts/working/`：待核对稿；`facts/canonical/`：明确批准的统一规范。
- `docs/architecture/`、`docs/development/`：现行工程说明；`docs/archive/`：仅供追溯的历史材料。

安装、启动或改依赖时读 `README.md` 和 `docs/development/environment.md`。
JS/TS 使用根 pnpm workspace 与唯一 `pnpm-lock.yaml`；Python 使用根 `pyproject.toml` 与 `uv.lock`。
每个包显式声明实际依赖，跨包使用 workspace 名称。版本和命令以配置为准，避免在说明中维护另一份清单。

## 资料与规则

资料校对由项目维护者自行完成；保留资料与规则的只读展示，不建设或恢复邀请协作者在线校对的流程。
修改规则、移动来源或生成内容时，先读 `docs/development/rule-sources.md`。
规则权威和适用范围先读 `facts/CONTEXT.md`、`facts/canonical/source-policy.md` 与 `facts/decisions/scope.md`。
多个来源不是可切换的执行规则。Agent整理未决冲突、出处、样例和建议，由 ltr 最终仲裁。
既有代码、测试和文件指纹只用于迁移对照，不能自行升级为批准的统一规范。
未决项影响正式支持范围；保留来源、状态和裁定记录，不凭空补规则或为通过检查改指纹。

## 验证与交付

代码修改运行 `pnpm check`；GUI 或服务行为变化还运行 `pnpm gui:test`，步骤见 `docs/development/testing.md`。
保持游戏逻辑与 UI/HTTP 解耦。秘密状态由引擎持有，页面仅消费公开契约；当前本地演示允许切换席位，不是保密联机产品。
交互控件提供稳定唯一的 `data-testid`、可访问名称和键盘语义。
保留失败证据，分别报告自动检查、GUI 回归和人工验收；未经人类确认始终标记“待人类验收”。

GitHub Issue/分支/PR 流程遵守 `CONTRIBUTING.md`；保留其他任务未提交的内容。
历史 NAS/服务器路径与归档说明不是部署指令。推送、合并和部署按当前任务授权执行，禁止直接推送 main。
