# 代理协作指南

## 项目意图

本项目整理桌游《惨剧轮回 / 惨劇RoopeR / Tragedy Looper》的相关资料，并逐步制作一个可在线游玩的数字版本。

长期愿景有三条产品线：

- 有来源追溯的资料站，包括适合新人的教学内容。
- Web-first 的在线版游戏，尽量复现纸质版的对战流程。
- 扩展工具，包括推理辅助、剧本制作器和剧本校验器。

近期工作优先考虑：

- 准确、有出处的规则、术语和资料整理。
- spoiler-light 的 Marp 新手教学课件。
- UI 无关的规则模型，支撑浏览器原型，并为后续联机做准备。

## 项目分区

- `facts/`：事实区。存放关于《惨剧轮回》本身的事实输入和派生事实数据，包括纸质扫描、归档资料、公开研究、人工审阅稿和结构化数据。
- `code/`：源代码区。存放 Python 包、浏览器原型、规则核心、资料处理脚本和测试。
- `products/`：产物区。存放可交付或可预览的内容，包括 Marp slides、生成后的静态页面，以及未来资料站和在线游戏构建产物。
- `docs/`：项目文档区。存放程序设计、状态机决策、录入流程、已知误解、项目愿景等工程协作材料。

`facts/` 和 `docs/` 不要混用：前者回答“游戏资料怎么说”，后者回答“我们为什么这样设计、实现和协作”。

## 工具约定

新规则引擎位于 `code/packages/engine/`，独立重写；设计、开发及验证该引擎时，先读取其 `AGENTS.md`，按任务加载分层契约。`code/web/core/` 仍是旧 Web 原型的实现。

- 使用 Python 3.12，并通过 `uv` 管理。
- 使用项目根目录的 `.venv/` 虚拟环境。
- 命令优先使用 `uv run`，例如 `uv run pytest` 和 `uv run tragedy-loop`。
- 可玩原型是 Web-first；除非用户明确要求桌面应用，不要引入第二套 GUI 工具链。
- Marp slide 源文件位于 `products/slides/`；Marp 渲染属于 Node 生态，不放进 Python 包。

## 仓库约定

- 尽量让游戏逻辑与 GUI 代码分离。
- 派生的结构化事实数据放在 `facts/structured/`。
- 带来源链接和日期的公开研究笔记放在 `facts/research/`。
- 本地扫描和上传件放在 `facts/source_material/scans/`；除非用户明确确认，不要提交扫描原件。
- 归档 PDF、逐页图片、OCR 草稿和提取审阅稿放在 `facts/source_material/reference/`。
- 避免把大段规则书文本、卡牌原文或美术资源复制进仓库。优先使用摘要、标识符和能被来源校对的结构化字段。
- 代码不要凭空发明游戏事实。如果规则、身份、事件或卡牌字段不确定，先把不确定性记录到 `facts/` 或 `docs/development/known-misunderstandings.md`，再决定是否编码为运行时行为。

## 常用命令

```bash
uv sync
uv run tragedy-loop
npm run app:serve
npm run app:test
uv run pytest
uv run ruff check .
npm run server:deploy
npm run server:capture
```

## 长期部署与协作者改动回收

这个项目虽然主要在 MacBook 上编辑，但给协作者审阅事实、测试 Web 原型的入口长期部署在 Linux 服务器 `server-ltr` 的 `ltr` 账户下。

固定部署形态：

- 服务器 checkout：`/home/ltr/apps/tragedy_loop`
- 运行时目录：`/home/ltr/apps/tragedy_loop_runtime`
- NAS Git 远端：`qnap-nas-git:/srv/git/tragedy_loop.git`
- systemd 用户服务：`tragedy-loop-web.service`
- 单端口：`18174`
- 首页入口：`http://<公网映射>/`
- Web 原型：`http://<公网映射>/prototype/`
- 资料站点：`http://<公网映射>/site/`

每次主要提交后，应使用仓库脚本部署，而不是手写 SSH 步骤：

```bash
npm run server:deploy
```

部署脚本会先把服务器上的协作者事实编辑和 Web 原型运行日志捕获到 NAS 临时分支 `server/capture-<timestamp>`，再更新服务器 checkout 到 NAS `main` 并重启服务。不要直接在服务器上 `git reset --hard` 或覆盖 `facts/`，除非已经确认捕获分支存在。

协作者通过编辑器产生的事实改动主要落在 `facts/` 下。Web 原型测试日志由 `/api/prototype-log` 写入服务器运行时目录，并由捕获流程快照到 `runtime/prototype-logs/`，只保存在 `server/capture-*` 分支中，不应直接合入 `main`。

取回并选择性合并服务器改动：

```bash
npm run server:capture
git branch -r --list 'origin/server/capture-*'
git diff origin/main...origin/server/capture-<timestamp> -- facts
git checkout -p origin/server/capture-<timestamp> -- facts
```

查看原型日志：

```bash
git ls-tree -r --name-only origin/server/capture-<timestamp> runtime/prototype-logs
git show origin/server/capture-<timestamp>:runtime/prototype-logs/<date>/<session>.jsonl
```

选择性合并后再跑测试、提交，并用 `npm run server:deploy` 发布到服务器。部署脚本会尽量把尚未合并的服务器事实编辑重放回部署工作树，避免协作者正在审阅的事实内容被代码更新直接覆盖；如果主分支和服务器事实编辑改到同一文件，先检查捕获分支 diff，再决定以哪边为准。
