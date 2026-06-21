# Tragedy Loop

惨剧轮回资料整理、教学文档与电子化原型项目。

本仓库先做三件事：

- 整理公开资料与纸质扫描资料，形成可追溯的规则、角色、剧本和术语库。
- 用 Marp 编写新人教学 slides，优先做无剧透、能快速开局的说明。
- 用 Web 前端逐步实现在线游玩原型，并把规则引擎保持为 UI 无关、可测试的核心模块。

## Development

```bash
uv sync
uv run tragedy-loop
npm run app:serve
npm run app:test
uv run pytest
uv run ruff check .
```

Python 虚拟环境固定在项目根目录的 `.venv/`，由 `uv` 管理。
`uv run tragedy-loop` 会在本地启动 Web 原型服务，默认地址为 `http://127.0.0.1:5173/`。

Marp slides 放在 `products/slides/`。Marp CLI 属于 Node 生态，后续可以用 VS Code Marp 插件或 `@marp-team/marp-cli` 渲染。

## Project Layout

- `code/src/tragedy_loop/`: Python package and local web server entry point.
- `code/web/`: browser prototype and UI-independent JavaScript rules core.
- `code/tests/`: focused tests for project code.
- `docs/project-vision.md`: project vision and implementation direction.
- `docs/architecture/`: rules core and state machine design notes.
- `docs/development/`: development notes, including important known misunderstandings.
- `facts/research/`: public research notes with source links.
- `products/slides/`: Marp teaching material.
- `facts/structured/`: derived structured data for rules, characters, scripts, and scenarios.
- `facts/source_material/scans/`: local paper scans; ignored by git by default.

## Directory Structure

```text
.
├── code/
│   ├── src/tragedy_loop/        # Python 包与本地 Web 服务入口
│   ├── tests/                   # Python 测试
│   ├── tools/                   # 构建与资料整理脚本
│   └── web/                     # 浏览器原型与 UI 无关规则核心
├── docs/
│   ├── architecture/            # 规则核心、状态机等设计说明
│   └── development/             # 开发流程、录入流程和已知误区
├── facts/
│   ├── research/                # 带来源链接的公开研究笔记
│   ├── structured/              # 程序可读取的结构化资料草稿
│   └── source_material/         # 本地源材与 OCR 工作区，默认不提交
└── products/
    ├── public/                  # 已渲染产物
    └── slides/                  # Marp 教学课件源文件
```

纸质资料录入流程见 `docs/development/source-ingestion.md`。当前 `module.pdf` 已归档到 `facts/source_material/reference/module/original-upload.pdf`，每个模块的规则表、身份表、事件表审阅稿位于 `facts/source_material/reference/module/modules/`。
