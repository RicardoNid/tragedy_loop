# 纸质资料录入流程

本文定义纸质版资料进入项目的标准路径与三层产物。流程优先使用 Codex 多模态能力读图、分块、录入；本地工具只负责文件整理、PDF 拆页、旋转、标注编号和格式校验，不部署本地 OCR 或视觉模型作为主转换来源。

## 参考资料路径

所有参考资料统一放在 `facts/source_material/reference/` 下，每份资料使用一个稳定目录名：

```text
facts/source_material/reference/<document-id>/
```

约定：

- `facts/source_material/scans/` 只作为临时接收区或未整理扫描件存放处。
- 整理完成后，原始上传文件复制到 `facts/source_material/reference/<document-id>/original-upload.pdf`。
- 不把本地扫描件视为公开素材；对外文档和程序数据优先使用摘要、标识符和可校对结构化字段。

## 三层产物

### A. 原始扫描信息

放在 `facts/source_material/reference/<document-id>/`：

- `original-upload.pdf`：原始上传 PDF，不改动。
- `raw-pages/`：由 PDF 渲染得到的原始方向逐页图。
- `pages/`：按阅读方向整理后的逐页图。
- `annotated/`：带块编号锚点的逐页图。
- `block-index.json`：Codex 目视分块索引。

分块原则：

- 由 Codex 直接观察页面，按语义块编号，例如 `P07-05`。
- 块可以是表格、说明框、图片说明、页面标题、右栏资料等。
- 编号锚点只用于定位块，不表示精确裁切边界。
- 宁可块稍粗，也不要使用会切断文字或错位的固定模板框。

### B. 电子版原始信息

放在 `facts/source_material/reference/<document-id>/source.md`。

要求：

- Markdown 中每一段、每个表格、每个图片说明都必须带出处。
- 出处格式使用块编号，例如 `出处：P07-05`。
- 如果内容来自多个块，写成 `出处：P07-05, P07-06`。
- 未完成或无法确认的文本必须标注 `待校对`，不要伪装成已确认信息。

### C. 运行时结构化信息

放在 `facts/structured/` 下，按用途分目录，例如：

```text
facts/structured/modules/<module-id>.json
```

要求：

- 每条结构化记录保留 `source_refs`。
- 字段值不确定时保留 `review_status` 或 `notes`，不要把猜测写成事实。
- 程序只读取结构化层；Markdown 层用于人工校对和追溯。

## 标准步骤

1. 将上传文件归档到 `facts/source_material/reference/<document-id>/original-upload.pdf`。
2. 用 Poppler 将 PDF 渲染成 `raw-pages/page-XX.png`。
3. 按阅读方向生成 `pages/page-XX.png`。
4. Codex 直接观察每页图片，建立 `block-index.json`。
5. 根据 `block-index.json` 生成 `annotated/page-XX-blocks.png`。
6. Codex 按块读取图片，将内容录入 `source.md`，每段都写出处。
7. 人工校对 `source.md`。
8. 将已校对内容整理进 `facts/structured/`，每条结构化数据保留出处。
9. 运行项目校验命令，例如 `uv run pytest`。

## module.pdf 当前示例

`module.pdf` 已按本流程整理到：

```text
facts/source_material/reference/module/
```

当前状态：

- 原始 PDF、逐页图、阅读方向页图已归档。
- `block-index.json` 已改为 Codex 语义分块索引。
- `annotated/` 中的图片只放编号锚点，不再使用固定模板大框。
- `source.md` 和 `facts/structured/modules/first-steps.json` 是示范稿，仍需人工校对后才能作为完整规则数据使用。
