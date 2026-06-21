# Tragedy Loop

惨剧轮回 / 惨劇RoopeR / Tragedy Looper 的资料整理、资料站与在线版原型项目。

## 愿景

这个项目希望把《惨剧轮回》相关资料整理成可追溯、可教学、可运行、可扩展的一套数字化工程。

长期目标分为三条主线：

- 资料整理与资料站：沉淀来自纸质版、公开资料和人工讲解的规则、角色、剧本、术语和勘误；建立面向查阅与新手教学的资料站。
- 在线版游戏：实现 Web-first 的在线对战体验，基础功能应支持与纸质版一致的流程，包括隐藏信息、暗置行动、能力发动、事件、每日结算、轮回失败、最终猜测和日志回放。
- 扩展工具：在规则核心稳定后，发展推理辅助与剧本工具。推理辅助可以从规则约束、搜索剪枝、机器推理起步，未来再评估深度学习；剧本工具应支持剧本制作、合法性校验、可玩性检查和回放验证。

近期目标是先把新手资料、新手剧本和第一版 Web 原型串起来：来源可追溯，规则核心可测试，界面能跑完整闭环。

## 三大区域

项目根目录按职责分成三个主区域，另有 `docs/` 存放项目自身的设计和协作说明。

- `facts/`：事实区。只放来自纸质版、公开来源或人工输入的《惨剧轮回》事实，以及从这些事实整理出的结构化数据。这里的内容要保留来源、待校对状态和出处线索。
- `code/`：源代码区。放 Web 原型、UI 无关规则核心、Python 本地服务入口、数据处理脚本和测试。代码应以 `facts/` 中可追溯资料为依据。
- `products/`：产物区。放我们要交付或预览的内容，例如 Marp 教学 slides、构建后的静态页面、未来资料站和在线游戏发布产物。
- `docs/`：项目文档区。放架构、状态机、录入流程、已知误解和项目愿景等工程协作材料。

## 目录结构

```text
.
├── facts/
│   ├── source_material/
│   │   ├── scans/               # 上传件和未整理扫描件；默认不提交扫描原件
│   │   └── reference/           # 已归档资料、逐页图、OCR/结构化审阅稿
│   ├── structured/              # 程序可读取的结构化事实数据
│   └── research/                # 带链接和日期的公开研究笔记
├── code/
│   ├── src/tragedy_loop/        # Python 包与本地 Web 服务入口
│   ├── web/                     # 浏览器原型与 UI 无关 JS 规则核心
│   ├── tools/                   # 资料处理、slides 生成等脚本
│   └── tests/                   # Python 测试
├── products/
│   ├── slides/                  # Marp 教学课件源文件及图表资产
│   └── public/                  # 构建后的静态预览产物
└── docs/
    ├── architecture/            # 规则核心、状态机等设计说明
    └── development/             # 录入流程和已知误解
```

## 开发

```bash
uv sync
uv run tragedy-loop
npm run app:serve
npm run app:test
uv run pytest
uv run ruff check .
```

Python 虚拟环境固定在项目根目录的 `.venv/`，由 `uv` 管理。`uv run tragedy-loop` 会在本地启动 Web 原型服务，默认地址为 `http://127.0.0.1:5173/`。

Marp slides 源文件在 `products/slides/`。可用 `npm run slides:build` 生成到 `products/public/`。

## 关键文档

- [项目愿景](docs/project-vision.md)
- [核心状态机设计](docs/architecture/core-state-machine.md)
- [纸质资料录入流程](docs/development/source-ingestion.md)
- [重要误解记录](docs/development/known-misunderstandings.md)

纸质资料录入流程见 [source-ingestion.md](docs/development/source-ingestion.md)。当前 `module.pdf` 已归档到 `facts/source_material/reference/module/original-upload.pdf`，每个模块的规则表、身份表、事件表审阅稿位于 `facts/source_material/reference/module/modules/`。
