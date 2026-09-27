from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SLIDES = ROOT / "products" / "slides" / "beginner-teaching.marp.md"


@dataclass(frozen=True)
class SourceDoc:
    label: str
    path: Path
    spoiler: bool = False


@dataclass(frozen=True)
class ModuleTableDoc:
    title: str
    subtitle: str
    path: Path
    source_tag: str
    include_titles: tuple[str, ...] | None = None
    class_name: str = "module-ref"


STRUCTURED_DOCS = [
    SourceDoc("基础教学 / 结构化整理稿", ROOT / "facts/sources/ricardo/reference/基础教学/structured-text.md"),
    SourceDoc(
        "新手剧本 / 结构化整理稿",
        ROOT / "facts/sources/ricardo/reference/新手剧本/structured-text.md",
        spoiler=True,
    ),
]

RAW_DOCS = [
    SourceDoc("基础教学 / Raw OCR", ROOT / "facts/sources/ricardo/reference/基础教学/pdf2md/基础教学.md"),
    SourceDoc(
        "新手剧本 / Raw OCR",
        ROOT / "facts/sources/ricardo/reference/新手剧本/pdf2md/新手剧本.md",
        spoiler=True,
    ),
]

MODULE_TABLE_DOCS = [
    ModuleTableDoc(
        "First Steps / Basic Tragedy X 速查表",
        "来自 fs|btx.pdf；规则、身份、事件已结构化为表格，等待人工校对。",
        ROOT / "facts/sources/ricardo/reference/fs-btx/structured-tables.md",
        "fs|btx.pdf / structured-tables.md",
    ),
    ModuleTableDoc(
        "Midnight Zone 速查表",
        "来自 mz|mc.pdf 第 1 页；本局不使用 10 周年扩展，仅保留规则、身份、事件三表。",
        ROOT / "facts/sources/ricardo/reference/mz-mc/structured-tables.md",
        "mz|mc.pdf page-01 / structured-tables.md",
        ("Midnight Zone：规则", "Midnight Zone：身份", "Midnight Zone：事件"),
        "module-ref mz",
    ),
]


STYLE = r"""
<style>
:root {
  --paper: #f7f5ef;
  --ink: #202020;
  --muted: #66625c;
  --accent: #8b1d2c;
  --accent-2: #24685d;
  --line: #d8d0c3;
  --panel: #fffaf0;
  --dark: #171717;
}

section {
  background: var(--paper);
  color: var(--ink);
  font-family: "Hiragino Sans", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  letter-spacing: 0;
  padding: 54px 64px;
}

h1 {
  color: #151515;
  font-size: 58px;
}

h2 {
  color: #151515;
  font-size: 34px;
  margin-bottom: 20px;
}

h3 {
  color: #34312e;
  font-size: 25px;
}

p, li {
  font-size: 23px;
  line-height: 1.42;
}

li + li {
  margin-top: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 18px;
}

th, td {
  border: 1px solid var(--line);
  padding: 5px 8px;
}

th {
  background: #eee8dd;
}

code {
  color: var(--accent);
}

strong {
  color: var(--accent);
}

.note {
  color: var(--muted);
  font-size: 20px;
}

.kicker {
  color: var(--accent);
  font-size: 22px;
  font-weight: 700;
}

.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 22px;
}

.card,
.panel,
.review-note,
.ocr-meta {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 5px solid var(--accent);
  border-radius: 6px;
  padding: 16px 18px;
}

.card h3,
.panel h3,
.review-note h3,
.ocr-meta h3 {
  margin-top: 0;
}

section.cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background:
    linear-gradient(90deg, rgba(139, 29, 44, 0.12), rgba(36, 104, 93, 0.12)),
    var(--paper);
}

section.cover h1 {
  font-size: 70px;
  margin-bottom: 8px;
}

section.cover p {
  width: 70%;
}

section.divider {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #eee8dd;
}

section.divider h1 {
  font-size: 64px;
}

section.spoiler {
  border-top: 10px solid var(--accent);
}

section.flow h2 {
  margin-bottom: 10px;
}

.flow-img {
  display: block;
  width: 100%;
  max-height: 472px;
  object-fit: contain;
  margin: 10px auto 0;
}

.flow-caption {
  color: var(--muted);
  font-size: 18px;
  margin-top: 6px;
}

section.structured {
  padding-right: 344px;
}

section.structured h2 {
  font-size: 31px;
}

section.structured p,
section.structured li {
  font-size: 20px;
}

section.structured .review-note {
  position: absolute;
  top: 104px;
  right: 52px;
  width: 252px;
  border-left-color: var(--accent-2);
}

section.structured .review-note p,
section.structured .review-note li {
  font-size: 16px;
}

.source-tag {
  position: absolute;
  right: 56px;
  bottom: 35px;
  color: var(--muted);
  font-size: 15px;
}

.ocr-grid {
  display: grid;
  grid-template-columns: 270px 1fr;
  gap: 22px;
  align-items: stretch;
}

.ocr-meta {
  border-left-color: var(--accent-2);
}

.ocr-meta p {
  font-size: 16px;
  line-height: 1.35;
}

.ocr-text {
  background: var(--dark);
  color: #f7f5ef;
  border-radius: 6px;
  padding: 16px 18px;
  font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
  font-size: 14.2px;
  line-height: 1.28;
  white-space: pre-wrap;
  overflow: hidden;
  max-height: 492px;
}

section.ocr-review h2 {
  font-size: 28px;
}

section.ocr-review.spoiler .ocr-text {
  border: 2px solid var(--accent);
}

section.module-ref {
  padding: 34px 42px;
}

section.module-ref h2 {
  font-size: 27px;
  margin-bottom: 10px;
}

section.module-ref p,
section.module-ref li {
  font-size: 16px;
}

section.module-ref table {
  font-size: 14px;
  line-height: 1.18;
}

section.module-ref th,
section.module-ref td {
  padding: 4px 6px;
  vertical-align: top;
}

section.module-ref td:last-child {
  font-size: 13.2px;
}

section.module-ref.mz table {
  font-size: 12.4px;
  line-height: 1.08;
}

section.module-ref.mz th,
section.module-ref.mz td {
  padding: 3px 5px;
}

section.module-ref.mz td:last-child {
  font-size: 11.6px;
}

section.hand-layout {
  padding: 44px 72px;
}

section.hand-layout h2 {
  font-size: 36px;
  margin-bottom: 14px;
}

.hand-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  margin-top: 18px;
}

.hand-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 6px solid var(--accent-2);
  border-radius: 6px;
  padding: 18px 24px;
  min-height: 410px;
}

.hand-card.gm {
  border-left-color: var(--accent);
}

.hand-card h3 {
  font-size: 28px;
  margin: 0 0 10px;
}

.hand-card ul {
  margin: 0;
  padding-left: 26px;
}

.hand-card li {
  font-size: 25px;
  line-height: 1.34;
}

.hand-count {
  color: var(--muted);
  font-size: 17px;
  margin: 0 0 12px;
}
</style>
"""


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def clean_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("#"):
            title = re.sub(r"^#+\s*", "", line).strip()
            title = re.sub(r"[*_`<>]", "", title)
            if title:
                return title[:48]
    for line in text.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("![]("):
            return stripped[:48]
    return fallback


def page_refs(text: str) -> str:
    refs = sorted({int(match.group(1)) + 1 for match in re.finditer(r"_page_(\d+)", text)})
    if not refs:
        return "未检测到页码锚点"
    if len(refs) <= 6:
        return "推定页码：" + ", ".join(str(ref) for ref in refs)
    return f"推定页码：{refs[0]}-{refs[-1]}"


def visible_raw_text(text: str) -> str:
    return re.sub(r"!\[\]\(([^)]+)\)", r"[图片占位: \1]", text)


def split_lines(text: str, max_lines: int, max_chars: int) -> list[tuple[int, int, str]]:
    lines = text.splitlines()
    chunks: list[tuple[int, int, str]] = []
    start = 1
    current: list[str] = []
    chars = 0

    def flush(end_line: int) -> None:
        nonlocal start, current, chars
        if current:
            chunks.append((start, end_line, "\n".join(current).strip()))
        start = end_line + 1
        current = []
        chars = 0

    for index, line in enumerate(lines, start=1):
        if current and line.startswith("#") and (len(current) >= 6 or chars >= max_chars // 2):
            flush(index - 1)
        current.append(line)
        chars += len(line) + 1
        should_break = len(current) >= max_lines or chars >= max_chars
        if should_break and (not line.strip() or line.startswith("#") or line.startswith("|")):
            flush(index)
        elif should_break and len(current) >= max_lines + 6:
            flush(index)

    flush(len(lines))
    return [chunk for chunk in chunks if chunk[2]]


def markdown_slide(title: str, body: str, class_name: str = "") -> str:
    cls = f"\n\n<!-- _class: {class_name} -->" if class_name else ""
    return f"---{cls}\n\n## {title}\n\n{body.strip()}\n"


def divider(title: str, subtitle: str = "", class_name: str = "divider") -> str:
    body = f"# {title}\n\n"
    if subtitle:
        body += f"<p class=\"note\">{html.escape(subtitle)}</p>\n"
    return f"---\n\n<!-- _class: {class_name} -->\n\n{body}"


def extract_bullet_list(lines: list[str], start_label: str, stop_label: str | None = None) -> list[str]:
    items: list[str] = []
    capturing = False
    for line in lines:
        stripped = line.strip()
        if stripped == start_label:
            capturing = True
            continue
        if stop_label and stripped == stop_label:
            break
        if capturing and stripped.startswith("- "):
            items.append(stripped[2:].strip())
    return items


def hand_list(items: list[str]) -> str:
    return "\n".join(f"<li>{html.escape(item)}</li>" for item in items)


def initial_hand_slide(doc: SourceDoc, number: int, start: int, end: int, chunk: str) -> str:
    lines = chunk.splitlines()
    protagonist_cards = extract_bullet_list(lines, "主人公手牌：", "剧作家手牌：")
    mastermind_cards = extract_bullet_list(lines, "剧作家手牌：")
    body = f"""
<p class="note">初始手牌分为主人公手牌与剧作家手牌；此页为版式化审阅稿。</p>

<div class="hand-grid">
<div class="hand-card">
<h3>主人公手牌</h3>
<p class="hand-count">{len(protagonist_cards)} 张</p>
<ul>
{hand_list(protagonist_cards)}
</ul>
</div>

<div class="hand-card gm">
<h3>剧作家手牌</h3>
<p class="hand-count">{len(mastermind_cards)} 张</p>
<ul>
{hand_list(mastermind_cards)}
</ul>
</div>
</div>

<div class="source-tag">{html.escape(doc.label)} | {number:03d} | 来源行：{start}-{end}</div>
"""
    return markdown_slide("初始手牌", body, "hand-layout")


def structured_slides(doc: SourceDoc) -> list[str]:
    text = read_text(doc.path)
    chunks = split_lines(text, max_lines=24, max_chars=1700)
    slides: list[str] = []
    for number, (start, end, chunk) in enumerate(chunks, start=1):
        title = clean_title(chunk, doc.label)
        if title == "初始手牌" and "主人公手牌：" in chunk and "剧作家手牌：" in chunk:
            slides.append(initial_hand_slide(doc, number, start, end, chunk))
            continue
        note = (
            "<div class=\"review-note\"><h3>审阅提示</h3>"
            "<p>这里是整理后的结构稿。请检查术语、遗漏、剧透边界和表格含义。</p>"
            f"<p>来源行：{start}-{end}</p></div>"
        )
        source = f"<div class=\"source-tag\">{html.escape(doc.label)} | {number:03d}</div>"
        class_name = "structured spoiler" if doc.spoiler else "structured"
        slides.append(markdown_slide(title, f"{note}\n\n{chunk}\n\n{source}", class_name))
    return slides


def raw_ocr_slides(doc: SourceDoc) -> list[str]:
    text = read_text(doc.path)
    chunks = split_lines(text, max_lines=26, max_chars=1500)
    slides: list[str] = []
    for number, (start, end, chunk) in enumerate(chunks, start=1):
        title = clean_title(chunk, f"{doc.label} {number:03d}")
        escaped = html.escape(visible_raw_text(chunk))
        meta = (
            "<div class=\"ocr-meta\">"
            f"<h3>{html.escape(doc.label)}</h3>"
            f"<p>块号：{number:03d}</p>"
            f"<p>源文件行：{start}-{end}</p>"
            f"<p>{html.escape(page_refs(chunk))}</p>"
            "<p>此页保留 raw OCR 形态，用于直接找错字、乱码、重复段和表格识别问题。</p>"
            "</div>"
        )
        body = f"<div class=\"ocr-grid\">{meta}<pre class=\"ocr-text\">{escaped}</pre></div>"
        class_name = "ocr-review spoiler" if doc.spoiler else "ocr-review"
        slides.append(markdown_slide(f"OCR 原文审阅 {number:03d}｜{title}", body, class_name))
    return slides


def split_markdown_sections(text: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = []
    current_title = "说明"
    current_lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current_lines:
                sections.append((current_title, current_lines))
            current_title = line[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append((current_title, current_lines))
    return [(title, "\n".join(lines).strip()) for title, lines in sections if "\n".join(lines).strip()]


def split_table(section_body: str) -> tuple[list[str], list[str], list[str]]:
    table_lines = [line for line in section_body.splitlines() if line.strip().startswith("|")]
    non_table_lines = [line for line in section_body.splitlines() if not line.strip().startswith("|")]
    if len(table_lines) < 3:
        return non_table_lines, [], []
    header = table_lines[:2]
    rows = table_lines[2:]
    return non_table_lines, header, rows


def module_reference_slides() -> list[str]:
    slides: list[str] = []

    for doc in MODULE_TABLE_DOCS:
        text = read_text(doc.path)
        slides.append(divider(doc.title, doc.subtitle))

        for title, body in split_markdown_sections(text):
            if doc.include_titles is not None and title not in doc.include_titles:
                continue
            if title == "审阅说明":
                slides.append(markdown_slide(title, body, doc.class_name))
                continue
            intro, header, rows = split_table(body)
            if not header:
                if doc.include_titles is None:
                    slides.append(markdown_slide(title, body, doc.class_name))
                continue
            body_parts = []
            if intro:
                body_parts.append("\n".join(intro).strip())
            body_parts.append("\n".join(header + rows))
            body_parts.append(f'<div class="source-tag">{html.escape(doc.source_tag)}</div>')
            slides.append(markdown_slide(title, "\n\n".join(body_parts), doc.class_name))
    return slides


def build_deck() -> str:
    slides: list[str] = [
        "---\nmarp: true\ntheme: default\npaginate: true\nsize: 16:9\ntitle: 惨剧轮回 OCR 审阅与新手教学\n---\n",
        STYLE,
        "<!-- _class: cover -->\n\n# 惨剧轮回\n\n## OCR 审阅与新手教学结构稿\n\n"
        "<p>这份 deck 将结构化整理稿和 raw OCR 原文全部放入 Marp，供逐页校对。</p>\n\n"
        "<p class=\"note\">来源：基础教学.pdf、新手剧本.pdf，经已部署 PDF2MD 服务生成 OCR。</p>\n",
        markdown_slide(
            "如何审阅这份 Slides",
            """
<div class="columns">
<div class="panel">
<h3>前半：结构化整理稿</h3>
<p>用于检查我对原文的归纳是否准确，包括术语、流程、剧透边界、表格含义。</p>
</div>
<div class="panel">
<h3>后半：Raw OCR 原文</h3>
<p>用于检查原始提取错误。错字、乱码、重复段和识别失败的表格都会尽量原样保留。</p>
</div>
</div>

<p class="note">带红色顶边或红框的页面包含新手剧本非公开信息，请不要在主人公开局前展示。</p>
""",
            "agenda",
        ),
        markdown_slide(
            "资料与输出路径",
            """
<div class="cards">
<div class="card"><h3>PDF 归档</h3><p><code>facts/sources/ricardo/reference/*/*.pdf</code></p></div>
<div class="card"><h3>逐页图片</h3><p><code>facts/sources/ricardo/reference/*/pages/</code></p></div>
<div class="card"><h3>OCR 原文</h3><p><code>facts/sources/ricardo/reference/*/pdf2md/*.md</code></p></div>
</div>
""",
            "agenda",
        ),
        markdown_slide(
            "整局流程（LR）",
            '<img class="flow-img" src="assets/game-flow.png" alt="整局流程图">\n\n'
            '<p class="flow-caption">LR 单页图：从准备、轮回、失败判断到最终决战。</p>',
            "flow",
        ),
        markdown_slide(
            "每日回合流程（LR）",
            '<img class="flow-img" src="assets/round-flow.png" alt="每日回合流程图">\n\n'
            '<p class="flow-caption">LR 单页图：把一天内的行动、能力、事件和换天完整放在一页。</p>',
            "flow",
        ),
    ]

    slides.extend(module_reference_slides())
    slides.append(divider("结构化整理稿", "这部分是用于教学和校对的整理视图。"))

    for doc in STRUCTURED_DOCS:
        slides.append(divider(doc.label, "含剧透内容会以红色样式标记。", "divider spoiler" if doc.spoiler else "divider"))
        slides.extend(structured_slides(doc))

    slides.append(divider("Raw OCR 原文审阅", "以下页面尽量保留 PDF2MD 输出的原始文字形态。"))
    for doc in RAW_DOCS:
        slides.append(divider(doc.label, "请以这些页面为准检查 OCR 错误。", "divider spoiler" if doc.spoiler else "divider"))
        slides.extend(raw_ocr_slides(doc))

    slides.append(
        markdown_slide(
            "审阅后待处理",
            """
<div class="columns">
<div class="panel">
<h3>文本</h3>
<ul>
<li>统一繁简和术语。</li>
<li>修复 OCR 重复、漏字和表格错位。</li>
<li>确认新手剧本的规则名、身份名和事件当事人。</li>
</ul>
</div>
<div class="panel">
<h3>教学版</h3>
<ul>
<li>从审阅稿中抽取正式教学 slides。</li>
<li>保留公共信息和必要规则。</li>
<li>将剧作家信息移到隐藏或单独 deck。</li>
</ul>
</div>
</div>
""",
            "agenda",
        )
    )
    return "\n".join(slides).rstrip() + "\n"


def main() -> None:
    SLIDES.write_text(build_deck(), encoding="utf-8")
    print(f"wrote {SLIDES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
