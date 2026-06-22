from __future__ import annotations

import argparse
import functools
import json
import mimetypes
import os
import re
from collections.abc import Sequence
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PROJECT_NAME = "惨剧轮回"
VERSION = "0.1.0"


def find_project_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "pyproject.toml").is_file():
            return parent
    raise RuntimeError("Could not locate project root from tragedy_loop package.")


ROOT = find_project_root()
WEB_ROOT = ROOT / "code" / "web"
HOME_PATH = WEB_ROOT / "home.html"
SITE_ROOT = ROOT / "products" / "public"
RUNTIME_ROOT = Path(os.environ.get("TRAGEDY_LOOP_RUNTIME_ROOT", ROOT / "runtime"))
PROTOTYPE_LOG_ROOT = RUNTIME_ROOT / "prototype-logs"
MODULE_REFERENCE_ROOT = ROOT / "facts" / "source_material" / "reference" / "module"
MODULE_REVIEW_ROOT = MODULE_REFERENCE_ROOT / "modules"
TRAIT_POOL_PATH = MODULE_REFERENCE_ROOT / "identity-traits.md"
CHARACTER_REFERENCE_ROOT = ROOT / "facts" / "source_material" / "reference" / "character-cards"
CHARACTER_CARDS_PATH = CHARACTER_REFERENCE_ROOT / "cards.md"

MODULE_ORDER = [
    "midnight-zone",
    "mystery-circle",
    "another-horizon-r",
    "weird-mythology",
    "haunted-stage-a",
    "basic-tragedy-x",
    "first-steps",
    "last-liar",
]

TABLES = {
    "rules": {
        "heading": "规则表",
        "columns": ["规则类型", "规则名", "登场身份", "追加规则"],
        "source_key": "rule_source_refs",
    },
    "roles": {
        "heading": "身份表",
        "columns": ["身份名", "数量上限", "身份特性", "能力"],
        "source_key": "role_source_refs",
    },
    "incidents": {
        "heading": "事件表",
        "columns": ["事件名", "事件效果"],
        "source_key": "incident_source_refs",
    },
}

RULE_APPEARANCE_COLUMN = "登场身份"
ROLE_TRAITS_COLUMN = "身份特性"
RULE_TYPE_OPTIONS = ["规则Y", "规则X"]
APPEARANCE_COUNT_OPTIONS = ["1", "2", "3", "4", "5"]
APPEARANCE_COUNT_RULE_OPTIONS = ["默认", "最多", "至少"]
TRAIT_TABLE_COLUMNS = ["名称", "解释"]
CHARACTER_TABLE_COLUMNS = [
    "首次引入模组",
    "页码",
    "页图",
    "角色名",
    "不安限度",
    "友好限度",
    "出生点",
    "禁行区域",
    "标签",
    "友好能力",
    "备注",
]
CHARACTER_TAGS_COLUMN = "标签"
CHARACTER_FORBIDDEN_COLUMN = "禁行区域"
CHARACTER_ABILITIES_COLUMN = "友好能力"
CHARACTER_LOCATION_OPTIONS = ["学校", "神社", "都市", "医院", "无"]
CHARACTER_FREQUENCY_OPTIONS = ["每天", "每轮限 1 次", "待校对"]
CHARACTER_TIMING_OPTIONS = ["主人公能力阶段", "剧作家能力阶段", "主人公/剧作家能力阶段", "待校对"]
CHARACTER_ACTOR_OPTIONS = ["主人公", "剧作家", "主人公/剧作家", "队长", "待校对"]
CHARACTER_GOODWILL_OPTIONS = ["1", "2", "3", "4", "5"]
CHARACTER_LIMIT_OPTIONS = ["1", "2", "3", "4", "5"]
DEFAULT_TRAIT_EXPLANATIONS = {
    "无视友好": "主人公能力阶段，该角色可以拒绝主人公的友好能力请求。",
    "必定无视友好": "主人公能力阶段，该角色必须拒绝主人公的友好能力请求。",
    "不死": "该角色不会死亡。",
    "傀儡无视友好": "该角色的友好能力结算受剧作家控制；具体文本需按模组原图校对。",
}

MODULE_ELEMENT_SUMMARY = [
    {
        "name": "规则表",
        "purpose": "定义模组使用的规则、每条规则下登场的身份集合，以及规则附带的失败条件或追加处理。",
        "fields": TABLES["rules"]["columns"],
    },
    {
        "name": "身份表",
        "purpose": "定义模组可用身份、数量上限、身份特性和能力文本。",
        "fields": TABLES["roles"]["columns"],
    },
    {
        "name": "事件表",
        "purpose": "定义模组可用事件，以及事件发生时的效果。",
        "fields": TABLES["incidents"]["columns"],
    },
]

CHARACTER_ELEMENT_SUMMARY = [
    {
        "name": "卡面定位",
        "purpose": "记录角色卡首次由哪个模组引入、对应页码和原图，方便审阅时回到扫描来源。",
        "fields": ["首次引入模组", "页码", "页图"],
    },
    {
        "name": "公开数值",
        "purpose": "记录双方都能看到的角色卡公开信息，包括不安限度、友好限度、出生点和禁行区域。",
        "fields": ["角色名", "不安限度", "友好限度", "出生点", "禁行区域"],
    },
    {
        "name": "标签与能力",
        "purpose": "记录角色标签，以及按友好门槛解锁的友好能力、使用频率、阶段、使用方和效果摘要。",
        "fields": ["标签", "友好能力", "备注"],
    },
]

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
RULE_APPEARANCE_SEPARATOR_RE = re.compile(r"\s*[;；]\s*")
RULE_APPEARANCE_PART_RE = re.compile(
    r"^\s*(?P<identity>.+?)\s*[-:：]\s*(?P<count>[1-5])\s*[-:：]\s*"
    r"(?P<count_rule>默认|最多|至少)\s*$"
)
TRAIT_SEPARATOR_RE = re.compile(r"\s*[、,，;；]\s*")
CHARACTER_LIST_SEPARATOR_RE = re.compile(r"\s*[、,，;；]\s*")
CHARACTER_ABILITY_RE = re.compile(
    r"^\s*友好\s*(?P<required_goodwill>[1-5])\s*[;；]\s*"
    r"(?P<frequency>[^;；]+)\s*[;；]\s*"
    r"(?P<timing>[^;；]+)\s*[;；]\s*"
    r"(?P<actor>[^:：]+)\s*[:：]\s*(?P<effect>.*)\s*$"
)
LOG_SESSION_RE = re.compile(r"[^A-Za-z0-9_.-]+")
MAX_PROTOTYPE_LOG_BYTES = 2_000_000
SITE_WEB_FILES = {
    "editor.html",
    "characters.html",
    "traits.html",
    "module-editor.css",
    "module-editor.mjs",
    "character-editor.mjs",
    "trait-editor.mjs",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tragedy-loop",
        description="Serve the web prototype for the Tragedy Looper project.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--port", type=int, default=5173, help="Port to bind. Defaults to 5173.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return parser


def split_markdown_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]

    cells: list[str] = []
    current: list[str] = []
    index = 0
    while index < len(stripped):
        char = stripped[index]
        if char == "\\" and index + 1 < len(stripped):
            current.append(stripped[index + 1])
            index += 2
            continue
        if char == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        index += 1
    cells.append("".join(current).strip())
    return cells


def escape_markdown_cell(value: object) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\n", "<br>")


def is_separator_row(line: str) -> bool:
    cells = split_markdown_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.strip()) for cell in cells)


def extract_metadata(lines: list[str], label: str) -> str:
    prefix = f"{label}："
    for line in lines:
        if line.startswith(prefix):
            value = line.removeprefix(prefix).strip()
            if value.startswith("`") and value.endswith("`"):
                return value[1:-1]
            return value
    return ""


def extract_source_refs(lines: list[str], start_index: int) -> list[str]:
    for line in lines[start_index:]:
        stripped = line.strip()
        if stripped.startswith("出处："):
            refs = stripped.removeprefix("出处：")
            return [ref.strip() for ref in refs.split(",") if ref.strip()]
        if stripped.startswith("## "):
            break
    return []


def extract_table(lines: list[str], heading: str, columns: list[str]) -> tuple[list[dict[str, str]], list[str]]:
    heading_line = f"## {heading}"
    try:
        heading_index = next(index for index, line in enumerate(lines) if line.strip() == heading_line)
    except StopIteration:
        return [], []

    table_start = None
    for index in range(heading_index + 1, len(lines) - 1):
        if lines[index].lstrip().startswith("|") and is_separator_row(lines[index + 1]):
            table_start = index
            break
        if lines[index].startswith("## "):
            return [], []
    if table_start is None:
        return [], []

    headers = split_markdown_row(lines[table_start])
    header_positions = {header: position for position, header in enumerate(headers)}

    rows: list[dict[str, str]] = []
    index = table_start + 2
    while index < len(lines) and lines[index].lstrip().startswith("|"):
        cells = split_markdown_row(lines[index])
        row = {}
        for position, column in enumerate(columns):
            source_position = header_positions.get(column, position)
            row[column] = cells[source_position] if source_position < len(cells) else ""
        if any(value for value in row.values()):
            rows.append(row)
        index += 1
    return rows, extract_source_refs(lines, index)


def parse_rule_appearances(value: object) -> list[dict[str, str]]:
    if isinstance(value, list):
        appearances: list[dict[str, str]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            identity = str(item.get("identity") or item.get("身份") or "").strip()
            count = str(item.get("count") or item.get("数量") or "1").strip()
            count_rule = str(item.get("count_rule") or item.get("数量规则") or "默认").strip()
            if not identity:
                continue
            appearances.append(
                {
                    "identity": identity,
                    "count": count if count in APPEARANCE_COUNT_OPTIONS else "1",
                    "count_rule": count_rule
                    if count_rule in APPEARANCE_COUNT_RULE_OPTIONS
                    else "默认",
                }
            )
        return appearances

    text = str(value or "").replace("<br>", "\n").strip()
    if not text or text.startswith("待校对"):
        return []

    appearances = []
    for part in RULE_APPEARANCE_SEPARATOR_RE.split(text):
        if not part:
            continue
        match = RULE_APPEARANCE_PART_RE.match(part)
        if not match:
            continue
        appearances.append(
            {
                "identity": match.group("identity").strip(),
                "count": match.group("count"),
                "count_rule": match.group("count_rule"),
            }
        )
    return appearances


def format_rule_appearances(value: object) -> str:
    appearances = parse_rule_appearances(value)
    return "；".join(
        f"{appearance['identity']}-{appearance['count']}-{appearance['count_rule']}"
        for appearance in appearances
    )


def parse_role_traits(value: object) -> list[str]:
    if isinstance(value, list):
        traits = [str(item).strip() for item in value]
    else:
        text = str(value or "").replace("<br>", "\n").strip()
        traits = [part.strip() for part in TRAIT_SEPARATOR_RE.split(text)]
    deduped: list[str] = []
    for trait in traits:
        if trait and trait not in deduped:
            deduped.append(trait)
    return deduped


def format_role_traits(value: object) -> str:
    return "；".join(parse_role_traits(value))


def normalize_rule_row(row: dict[str, str]) -> dict[str, object]:
    rule_type = str(row.get("规则类型") or "").strip()
    if rule_type not in RULE_TYPE_OPTIONS:
        rule_type = ""
    return {
        "规则类型": rule_type,
        "规则名": row.get("规则名", ""),
        RULE_APPEARANCE_COLUMN: parse_rule_appearances(row.get(RULE_APPEARANCE_COLUMN, "")),
        "追加规则": row.get("追加规则", ""),
    }


def normalize_role_row(row: dict[str, str]) -> dict[str, object]:
    return {
        "身份名": row.get("身份名", ""),
        "数量上限": row.get("数量上限", ""),
        ROLE_TRAITS_COLUMN: parse_role_traits(row.get(ROLE_TRAITS_COLUMN, "")),
        "能力": row.get("能力", ""),
    }


def module_path_from_slug(slug: str) -> Path:
    stem = slug.removesuffix(".md")
    if not SLUG_RE.fullmatch(stem):
        raise ValueError("Invalid module id.")
    path = (MODULE_REVIEW_ROOT / f"{stem}.md").resolve()
    root = MODULE_REVIEW_ROOT.resolve()
    if path.parent != root:
        raise ValueError("Module path escapes review root.")
    return path


def parse_module_markdown(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    title = path.stem
    for line in lines:
        if line.startswith("# "):
            title = line.removeprefix("# ").strip()
            break

    tables: dict[str, object] = {}
    source_refs: dict[str, list[str]] = {}
    for key, config in TABLES.items():
        rows, refs = extract_table(lines, config["heading"], config["columns"])
        if key == "rules":
            rows = [normalize_rule_row(row) for row in rows]
        if key == "roles":
            rows = [normalize_role_row(row) for row in rows]
        tables[key] = rows
        source_refs[key] = refs

    return {
        "id": path.stem,
        "filename": path.name,
        "title": title,
        "status": extract_metadata(lines, "状态") or "待人工校对",
        "page_image": extract_metadata(lines, "页图"),
        "annotated_image": extract_metadata(lines, "标注图"),
        "tables": tables,
        "source_refs": source_refs,
    }


def render_table(columns: list[str], rows: list[dict[str, object]]) -> list[str]:
    output = [
        "| " + " | ".join(columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        cells = []
        for column in columns:
            value = row.get(column, "")
            if column == RULE_APPEARANCE_COLUMN:
                value = format_rule_appearances(value)
            if column == ROLE_TRAITS_COLUMN:
                value = format_role_traits(value)
            cells.append(escape_markdown_cell(value))
        output.append("| " + " | ".join(cells) + " |")
    return output


def parse_trait_pool_markdown(path: Path = TRAIT_POOL_PATH) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    rows, _refs = extract_table(lines, "身份特性池", TRAIT_TABLE_COLUMNS)
    traits: list[dict[str, str]] = []
    for row in rows:
        name = row.get("名称", "").strip()
        if not name:
            continue
        traits.append({"name": name, "description": row.get("解释", "").strip()})
    return traits


def render_trait_pool_markdown(traits: list[dict[str, str]]) -> str:
    rows = [
        {"名称": trait.get("name", "").strip(), "解释": trait.get("description", "").strip()}
        for trait in traits
        if trait.get("name", "").strip()
    ]
    return (
        "# 身份特性池\n\n"
        "状态：待人工校对  \n"
        "用途：供模组审阅编辑器的身份表“身份特性”下拉列表使用。\n\n"
        "## 身份特性池\n\n"
        + "\n".join(render_table(TRAIT_TABLE_COLUMNS, rows))
        + "\n"
    )


def collect_traits_from_modules() -> list[str]:
    traits: list[str] = []
    for path in sorted(MODULE_REVIEW_ROOT.glob("*.md")):
        module = parse_module_markdown(path)
        for role in module["tables"]["roles"]:
            for trait in parse_role_traits(role.get(ROLE_TRAITS_COLUMN, [])):
                if trait not in traits:
                    traits.append(trait)
    return traits


def list_trait_pool() -> list[dict[str, str]]:
    traits_by_name: dict[str, dict[str, str]] = {}
    for name, description in DEFAULT_TRAIT_EXPLANATIONS.items():
        traits_by_name[name] = {"name": name, "description": description}
    for trait in parse_trait_pool_markdown():
        traits_by_name[trait["name"]] = trait
    for name in collect_traits_from_modules():
        traits_by_name.setdefault(
            name,
            {"name": name, "description": DEFAULT_TRAIT_EXPLANATIONS.get(name, "")},
        )
    return sorted(traits_by_name.values(), key=lambda trait: trait["name"])


def write_trait_pool(payload: object) -> None:
    if isinstance(payload, dict):
        traits = payload.get("traits", [])
    else:
        traits = payload
    if not isinstance(traits, list):
        raise ValueError("Expected a traits list.")
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in traits:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("名称") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        normalized.append(
            {
                "name": name,
                "description": str(item.get("description") or item.get("解释") or "").strip(),
            }
        )
    TRAIT_POOL_PATH.write_text(render_trait_pool_markdown(normalized), encoding="utf-8")


def parse_character_list(value: object) -> list[str]:
    if isinstance(value, list):
        items = [str(item).strip() for item in value]
    else:
        text = str(value or "").replace("<br>", "\n").strip()
        if not text or text == "无":
            return []
        items = [part.strip() for part in CHARACTER_LIST_SEPARATOR_RE.split(text)]
    deduped: list[str] = []
    for item in items:
        if item and item != "无" and item not in deduped:
            deduped.append(item)
    return deduped


def format_character_list(value: object) -> str:
    items = parse_character_list(value)
    return "；".join(items) if items else "无"


def normalize_character_ability(item: dict[str, object]) -> dict[str, str]:
    required_goodwill = str(
        item.get("required_goodwill") or item.get("友好") or item.get("友好门槛") or ""
    ).strip()
    if required_goodwill not in CHARACTER_GOODWILL_OPTIONS:
        required_goodwill = "1"
    frequency = str(item.get("frequency") or item.get("使用频率") or "每天").strip()
    timing = str(item.get("timing") or item.get("阶段") or "主人公能力阶段").strip()
    actor = str(item.get("actor") or item.get("使用方") or "主人公").strip()
    effect = str(item.get("effect") or item.get("效果") or "").strip()
    return {
        "required_goodwill": required_goodwill,
        "frequency": frequency or "每天",
        "timing": timing or "主人公能力阶段",
        "actor": actor or "主人公",
        "effect": effect,
    }


def parse_character_abilities(value: object) -> list[dict[str, str]]:
    if isinstance(value, list):
        abilities = []
        for item in value:
            if isinstance(item, dict):
                ability = normalize_character_ability(item)
                if ability["effect"] or ability["required_goodwill"]:
                    abilities.append(ability)
        return abilities

    text = str(value or "").replace("<br>", "\n").strip()
    if not text:
        return []

    abilities: list[dict[str, str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = CHARACTER_ABILITY_RE.match(stripped)
        if match:
            abilities.append(normalize_character_ability(match.groupdict()))
            continue
        abilities.append(
            {
                "required_goodwill": "1",
                "frequency": "待校对",
                "timing": "待校对",
                "actor": "待校对",
                "effect": stripped,
            }
        )
    return abilities


def format_character_abilities(value: object) -> str:
    return "\n".join(
        "友好{required_goodwill}；{frequency}；{timing}；{actor}：{effect}".format(**ability)
        for ability in parse_character_abilities(value)
    )


def normalize_character_card(row: dict[str, object]) -> dict[str, object]:
    page_image = str(row.get("页图") or row.get("page_image") or "").strip()
    if page_image.startswith("`") and page_image.endswith("`"):
        page_image = page_image[1:-1]
    first_module = str(
        row.get("首次引入模组") or row.get("first_module") or row.get("批次") or row.get("source_batch") or ""
    ).strip()
    if first_module == "新手本角色":
        first_module = "first-steps"
    return {
        "first_module": first_module,
        "page_code": str(row.get("页码") or row.get("page_code") or "").strip(),
        "page_image": page_image,
        "name": str(row.get("角色名") or row.get("name") or "").strip(),
        "paranoia_limit": str(row.get("不安限度") or row.get("paranoia_limit") or "").strip(),
        "goodwill_limit": str(row.get("友好限度") or row.get("goodwill_limit") or "").strip(),
        "initial_location": str(row.get("出生点") or row.get("initial_location") or "").strip(),
        "forbidden_locations": parse_character_list(
            row.get(CHARACTER_FORBIDDEN_COLUMN) or row.get("forbidden_locations") or ""
        ),
        "tags": parse_character_list(row.get(CHARACTER_TAGS_COLUMN) or row.get("tags") or ""),
        "abilities": parse_character_abilities(
            row.get(CHARACTER_ABILITIES_COLUMN) or row.get("abilities") or []
        ),
        "notes": str(row.get("备注") or row.get("notes") or "").strip(),
    }


def parse_character_cards_markdown(path: Path = CHARACTER_CARDS_PATH) -> list[dict[str, object]]:
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    rows, _refs = extract_table(lines, "角色卡", CHARACTER_TABLE_COLUMNS)
    return [normalize_character_card(row) for row in rows]


def render_character_cards_markdown(cards: list[dict[str, object]]) -> str:
    rows: list[dict[str, object]] = []
    for card in cards:
        normalized = normalize_character_card(card)
        if not normalized["name"]:
            continue
        rows.append(
            {
                "首次引入模组": normalized["first_module"],
                "页码": normalized["page_code"],
                "页图": normalized["page_image"],
                "角色名": normalized["name"],
                "不安限度": normalized["paranoia_limit"],
                "友好限度": normalized["goodwill_limit"],
                "出生点": normalized["initial_location"],
                "禁行区域": format_character_list(normalized["forbidden_locations"]),
                "标签": format_character_list(normalized["tags"]),
                "友好能力": format_character_abilities(normalized["abilities"]),
                "备注": normalized["notes"],
            }
        )

    output = [
        "# 角色卡目录",
        "",
        "状态：待人工校对  ",
        "用途：供角色卡编辑器维护公开角色卡信息，并作为后续结构化运行时数据的来源。",
        "",
        "## 共性字段",
        "",
        "- 卡面定位：首次引入模组、页码、页图。",
        "- 公开数值：角色名、不安限度、友好限度、出生点、禁行区域。",
        "- 标签与能力：标签、友好能力、备注。",
        "",
        "## 角色卡",
        "",
        *render_table(CHARACTER_TABLE_COLUMNS, rows),
        "",
    ]
    return "\n".join(output).rstrip() + "\n"


def write_character_cards(payload: object) -> None:
    if isinstance(payload, dict):
        cards = payload.get("cards", [])
    else:
        cards = payload
    if not isinstance(cards, list):
        raise ValueError("Expected a cards list.")
    CHARACTER_REFERENCE_ROOT.mkdir(parents=True, exist_ok=True)
    normalized = [normalize_character_card(card) for card in cards if isinstance(card, dict)]
    CHARACTER_CARDS_PATH.write_text(render_character_cards_markdown(normalized), encoding="utf-8")


def render_module_markdown(module: dict[str, object]) -> str:
    title = str(module.get("title") or f"{module.get('id', '')} - 模组信息审阅稿").strip()
    status = str(module.get("status") or "待人工校对").strip()
    page_image = str(module.get("page_image") or "").strip()
    annotated_image = str(module.get("annotated_image") or "").strip()
    tables = module.get("tables") if isinstance(module.get("tables"), dict) else {}
    source_refs = module.get("source_refs") if isinstance(module.get("source_refs"), dict) else {}

    output = [
        f"# {title}",
        "",
        f"状态：{status}  ",
    ]
    if page_image:
        output.append(f"页图：`{page_image}`  ")
    if annotated_image:
        output.append(f"标注图：`{annotated_image}`")
    output.append("")

    for key, config in TABLES.items():
        rows = tables.get(key, []) if isinstance(tables, dict) else []
        if not isinstance(rows, list):
            rows = []
        refs = source_refs.get(key, []) if isinstance(source_refs, dict) else []
        refs_text = ", ".join(str(ref) for ref in refs) if refs else "待补充"
        output.extend(
            [
                f"## {config['heading']}",
                "",
                *render_table(config["columns"], rows),
                "",
                f"出处：{refs_text}",
                "",
            ]
        )

    return "\n".join(output).rstrip() + "\n"


def list_module_summaries() -> list[dict[str, object]]:
    modules: list[dict[str, object]] = []
    paths = {path.stem: path for path in MODULE_REVIEW_ROOT.glob("*.md")}
    ordered_stems = [stem for stem in MODULE_ORDER if stem in paths]
    ordered_stems.extend(sorted(stem for stem in paths if stem not in MODULE_ORDER))
    for stem in ordered_stems:
        module = parse_module_markdown(paths[stem])
        tables = module["tables"]
        modules.append(
            {
                "id": module["id"],
                "filename": module["filename"],
                "title": module["title"],
                "status": module["status"],
                "page_image": module["page_image"],
                "annotated_image": module["annotated_image"],
                "counts": {
                    "rules": len(tables["rules"]),
                    "roles": len(tables["roles"]),
                    "incidents": len(tables["incidents"]),
                },
            }
        )
    return modules


def safe_log_session_id(value: object) -> str:
    session_id = LOG_SESSION_RE.sub("-", str(value or "anonymous").strip()).strip(".-")
    return session_id[:80] or "anonymous"


def write_prototype_log(payload: object, *, remote_addr: str, user_agent: str) -> Path:
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object.")

    received_at = datetime.now(timezone.utc)
    session_id = safe_log_session_id(payload.get("sessionId"))
    log_dir = PROTOTYPE_LOG_ROOT / received_at.strftime("%Y-%m-%d")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{session_id}.jsonl"
    entry = {
        "received_at": received_at.isoformat(),
        "remote_addr": remote_addr,
        "user_agent": user_agent,
        "payload": payload,
    }
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")
    return log_path


class TragedyLoopRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def do_GET(self) -> None:
        split_url = urlsplit(self.path)
        path = split_url.path
        if self.maybe_serve_home_path(path, split_url.query, head=False):
            return
        if self.maybe_serve_prototype_path(path, head=False):
            return
        if self.maybe_serve_site_path(path, head=False):
            return
        if path == "/api/module-editor/config":
            self.send_json(
                {
                    "target_directory": str(MODULE_REVIEW_ROOT.relative_to(ROOT)),
                    "absolute_target_directory": str(MODULE_REVIEW_ROOT),
                    "reference_directory": str(MODULE_REFERENCE_ROOT.relative_to(ROOT)),
                    "trait_pool_file": str(TRAIT_POOL_PATH.relative_to(ROOT)),
                    "absolute_trait_pool_file": str(TRAIT_POOL_PATH),
                    "elements": MODULE_ELEMENT_SUMMARY,
                    "tables": {key: value["columns"] for key, value in TABLES.items()},
                    "rule_types": RULE_TYPE_OPTIONS,
                    "appearance_count_options": APPEARANCE_COUNT_OPTIONS,
                    "appearance_count_rules": APPEARANCE_COUNT_RULE_OPTIONS,
                }
            )
            return
        if path == "/api/character-cards/config":
            self.send_json(
                {
                    "target_file": str(CHARACTER_CARDS_PATH.relative_to(ROOT)),
                    "absolute_target_file": str(CHARACTER_CARDS_PATH),
                    "reference_directory": str(CHARACTER_REFERENCE_ROOT.relative_to(ROOT)),
                    "absolute_reference_directory": str(CHARACTER_REFERENCE_ROOT),
                    "elements": CHARACTER_ELEMENT_SUMMARY,
                    "columns": CHARACTER_TABLE_COLUMNS,
                    "locations": CHARACTER_LOCATION_OPTIONS,
                    "modules": [module["id"] for module in list_module_summaries()],
                    "limit_options": CHARACTER_LIMIT_OPTIONS,
                    "goodwill_options": CHARACTER_GOODWILL_OPTIONS,
                    "frequencies": CHARACTER_FREQUENCY_OPTIONS,
                    "timings": CHARACTER_TIMING_OPTIONS,
                    "actors": CHARACTER_ACTOR_OPTIONS,
                }
            )
            return
        if path == "/api/character-cards":
            self.send_json(
                {
                    "target_file": str(CHARACTER_CARDS_PATH.relative_to(ROOT)),
                    "absolute_target_file": str(CHARACTER_CARDS_PATH),
                    "cards": parse_character_cards_markdown(),
                }
            )
            return
        if path == "/api/module-editor/traits":
            self.send_json(
                {
                    "trait_pool_file": str(TRAIT_POOL_PATH.relative_to(ROOT)),
                    "absolute_trait_pool_file": str(TRAIT_POOL_PATH),
                    "traits": list_trait_pool(),
                }
            )
            return
        if path == "/api/module-editor/modules":
            self.send_json({"modules": list_module_summaries()})
            return
        if path.startswith("/api/module-editor/modules/"):
            slug = unquote(path.removeprefix("/api/module-editor/modules/"))
            try:
                module_path = module_path_from_slug(slug)
                if not module_path.is_file():
                    self.send_error(404, "Module not found.")
                    return
                self.send_json(parse_module_markdown(module_path))
            except ValueError as error:
                self.send_error(400, str(error))
            return
        if path.startswith("/module-assets/"):
            self.serve_module_asset(path.removeprefix("/module-assets/"))
            return
        if path.startswith("/character-assets/"):
            self.serve_character_asset(path.removeprefix("/character-assets/"))
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        split_url = urlsplit(self.path)
        path = split_url.path
        if self.maybe_serve_home_path(path, split_url.query, head=True):
            return
        if self.maybe_serve_prototype_path(path, head=True):
            return
        if self.maybe_serve_site_path(path, head=True):
            return
        super().do_HEAD()

    def maybe_serve_home_path(self, path: str, query: str, *, head: bool) -> bool:
        if path not in {"/", "/index.html"}:
            return False
        if query.startswith("view=") or "&view=" in query:
            suffix = f"?{query}" if query else ""
            self.send_response(302)
            self.send_header("Location", f"/prototype/{suffix}")
            self.end_headers()
            return True
        self.serve_file(HOME_PATH, head=head)
        return True

    def maybe_serve_prototype_path(self, path: str, *, head: bool) -> bool:
        if path == "/prototype":
            self.send_response(301)
            self.send_header("Location", "/prototype/")
            self.end_headers()
            return True
        if path.startswith("/prototype/"):
            self.serve_static_path(WEB_ROOT, path.removeprefix("/prototype"), head=head)
            return True
        return False

    def maybe_serve_site_path(self, path: str, *, head: bool) -> bool:
        if path == "/site":
            self.send_response(301)
            self.send_header("Location", "/site/")
            self.end_headers()
            return True
        if path.startswith("/site/"):
            site_path = path.removeprefix("/site")
            file_name = site_path.removeprefix("/")
            if file_name in SITE_WEB_FILES:
                self.serve_static_path(WEB_ROOT, site_path, head=head)
            else:
                self.serve_site_path(site_path, head=head)
            return True
        return False

    def serve_site_path(self, site_path: str, *, head: bool = False) -> None:
        self.serve_static_path(SITE_ROOT, site_path, head=head)

    def serve_static_path(self, directory: Path, static_path: str, *, head: bool = False) -> None:
        original_directory = self.directory
        original_path = self.path
        split_url = urlsplit(self.path)
        query = f"?{split_url.query}" if split_url.query else ""
        self.directory = str(directory)
        self.path = f"{static_path or '/'}{query}"
        try:
            if head:
                super().do_HEAD()
            else:
                super().do_GET()
        finally:
            self.directory = original_directory
            self.path = original_path

    def serve_file(self, path: Path, *, head: bool = False) -> None:
        if not path.is_file():
            self.send_error(404, "File not found.")
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_PUT(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/character-cards":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                write_character_cards(payload)
                self.send_json(
                    {
                        "target_file": str(CHARACTER_CARDS_PATH.relative_to(ROOT)),
                        "absolute_target_file": str(CHARACTER_CARDS_PATH),
                        "cards": parse_character_cards_markdown(),
                    }
                )
            except ValueError as error:
                self.send_error(400, str(error))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON.")
            return
        if path == "/api/module-editor/traits":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                write_trait_pool(payload)
                self.send_json(
                    {
                        "trait_pool_file": str(TRAIT_POOL_PATH.relative_to(ROOT)),
                        "absolute_trait_pool_file": str(TRAIT_POOL_PATH),
                        "traits": list_trait_pool(),
                    }
                )
            except ValueError as error:
                self.send_error(400, str(error))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON.")
            return
        if not path.startswith("/api/module-editor/modules/"):
            self.send_error(404, "Unknown API endpoint.")
            return
        slug = unquote(path.removeprefix("/api/module-editor/modules/"))
        try:
            module_path = module_path_from_slug(slug)
            if not module_path.is_file():
                self.send_error(404, "Module not found.")
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                self.send_error(400, "Expected a JSON object.")
                return
            payload["id"] = module_path.stem
            module_path.write_text(render_module_markdown(payload), encoding="utf-8")
            self.send_json(parse_module_markdown(module_path))
        except ValueError as error:
            self.send_error(400, str(error))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON.")

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/prototype-log":
            self.send_error(404, "Unknown API endpoint.")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "Invalid Content-Length.")
            return

        if content_length > MAX_PROTOTYPE_LOG_BYTES:
            self.send_error(413, "Prototype log payload is too large.")
            return

        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            log_path = write_prototype_log(
                payload,
                remote_addr=self.client_address[0],
                user_agent=self.headers.get("User-Agent", ""),
            )
            self.send_json({"ok": True, "path": str(log_path.relative_to(RUNTIME_ROOT))})
        except ValueError as error:
            self.send_error(400, str(error))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON.")

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_character_asset(self, relative_url_path: str) -> None:
        relative_path = Path(unquote(relative_url_path))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            self.send_error(400, "Invalid asset path.")
            return
        asset_path = (CHARACTER_REFERENCE_ROOT / relative_path).resolve()
        root = CHARACTER_REFERENCE_ROOT.resolve()
        if root not in asset_path.parents and asset_path != root:
            self.send_error(400, "Asset path escapes reference root.")
            return
        if not asset_path.is_file():
            self.send_error(404, "Asset not found.")
            return
        content_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
        body = asset_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_module_asset(self, relative_url_path: str) -> None:
        relative_path = Path(unquote(relative_url_path))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            self.send_error(400, "Invalid asset path.")
            return
        asset_path = (MODULE_REFERENCE_ROOT / relative_path).resolve()
        root = MODULE_REFERENCE_ROOT.resolve()
        if root not in asset_path.parents and asset_path != root:
            self.send_error(400, "Asset path escapes reference root.")
            return
        if not asset_path.is_file():
            self.send_error(404, "Asset not found.")
            return
        content_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
        body = asset_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve_web(host: str, port: int) -> None:
    handler = functools.partial(TragedyLoopRequestHandler)
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{port}/"
    print(f"{PROJECT_NAME} portal: {url}", flush=True)
    print(f"Web prototype: {url}prototype/", flush=True)
    print(f"Reference site: {url}site/", flush=True)
    print(f"Module editor: {url}editor.html", flush=True)
    print(f"Character card editor: {url}characters.html", flush=True)
    print(f"Module editor target: {MODULE_REVIEW_ROOT}", flush=True)
    print(f"Character card target: {CHARACTER_CARDS_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    serve_web(args.host, args.port)
