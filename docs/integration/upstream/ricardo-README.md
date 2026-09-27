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

`facts/` 和 `docs/` 的边界要刻意分清：

- `facts/` 记录“惨剧轮回本身是什么”。凡是能被纸质资料、公开资料或人工讲解校对的游戏事实，例如规则、角色、身份、事件、剧本、术语、扫描件、OCR 审阅稿和结构化事实数据，都放在这里。
- `docs/` 记录“我们怎样制作这个项目”。凡是关于程序设计、状态机决策、录入流程、开发约定、已知误解、项目愿景和未来实现取舍的说明，都放在这里。`docs/` 可以引用 `facts/`，但不应成为游戏事实的唯一来源。
- 判断方法：如果这句话回答“游戏规则/资料原本怎么说”，放 `facts/`；如果这句话回答“我们为什么这样建模、实现或协作”，放 `docs/`。

```text
.
├── facts/
│   ├── source_material/         # 游戏事实来源：纸质资料、上传件、归档 PDF、逐页图和审阅稿
│   │   ├── scans/               # 上传件和未整理扫描件；默认不提交扫描原件
│   │   └── reference/           # 已归档资料、逐页图、OCR/结构化审阅稿
│   │       ├── character-cards/ # 角色卡目录、逐页图、角色卡审阅表 cards.md
│   │       └── module/          # 模组目录、标注图、8 个模组审阅稿与身份特性池
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
    ├── architecture/            # 程序设计：规则核心、状态机和实现决策
    └── development/             # 项目流程：录入规范、开发约定和已知误解
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
- [模组审阅编辑器](docs/development/module-editor.md)
- [角色卡审阅编辑器](docs/development/character-card-editor.md)
- [重要误解记录](docs/development/known-misunderstandings.md)

纸质资料录入流程见 [source-ingestion.md](docs/development/source-ingestion.md)。当前 `module.pdf` 已归档到 `facts/source_material/reference/module/original-upload.pdf`，每个模块的规则表、身份表、事件表审阅稿位于 `facts/source_material/reference/module/modules/`。

模组审阅编辑器通过 `uv run tragedy-loop` 启动，地址为 `http://127.0.0.1:5173/editor.html`，保存目标目录固定为 `facts/source_material/reference/module/modules/`。规则表支持 `规则X`/`规则Y` 分类，并把登场身份保存为 `身份-数量-数量规则` 的列表；身份特性池通过 `http://127.0.0.1:5173/traits.html` 维护，保存到 `facts/source_material/reference/module/identity-traits.md`。

角色卡审阅编辑器地址为 `http://127.0.0.1:5173/characters.html`，保存到 `facts/source_material/reference/character-cards/cards.md`。原“新手本角色”资料已升级为角色卡目录，原 PDF、修正 PDF 和逐页图片保留在 `facts/source_material/reference/character-cards/`。
