from pathlib import Path

import pytest
import tragedy_loop.app as app

from tragedy_loop.app import (
    HOME_PATH,
    PROJECT_NAME,
    SITE_ROOT,
    WEB_ROOT,
    build_parser,
    parse_character_cards_markdown,
    parse_module_markdown,
    parse_trait_pool_markdown,
    render_character_cards_markdown,
    render_module_markdown,
    render_trait_pool_markdown,
    safe_log_session_id,
    write_prototype_log,
)


def test_project_name() -> None:
    assert PROJECT_NAME == "惨剧轮回"


def test_cli_help_exits_without_launching_gui() -> None:
    with pytest.raises(SystemExit) as exc_info:
        build_parser().parse_args(["--help"])

    assert exc_info.value.code == 0


def test_web_root_exists() -> None:
    assert HOME_PATH.is_file()
    assert (WEB_ROOT / "home.css").is_file()
    assert (WEB_ROOT / "index.html").is_file()
    assert (WEB_ROOT / "editor.html").is_file()
    assert (WEB_ROOT / "traits.html").is_file()
    assert (WEB_ROOT / "characters.html").is_file()


def test_site_root_exists() -> None:
    assert (SITE_ROOT / "slides" / "beginner-teaching.html").is_file()


def test_prototype_log_writes_jsonl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app, "RUNTIME_ROOT", tmp_path)
    monkeypatch.setattr(app, "PROTOTYPE_LOG_ROOT", tmp_path / "prototype-logs")

    assert safe_log_session_id("../bad session?") == "bad-session"

    log_path = write_prototype_log(
        {"sessionId": "../bad session?", "eventSeq": 1},
        remote_addr="127.0.0.1",
        user_agent="pytest",
    )

    assert log_path.parent.parent == tmp_path / "prototype-logs"
    assert log_path.name == "bad-session.jsonl"
    assert '"eventSeq": 1' in log_path.read_text(encoding="utf-8")


def test_module_markdown_round_trip(tmp_path: Path) -> None:
    source = tmp_path / "sample.md"
    source.write_text(
        """# Sample - 模组信息审阅稿

状态：待人工校对
页图：`../pages/page-01.png`
标注图：`../annotated/page-01-blocks.png`

## 规则表

| 规则类型 | 规则名 | 登场身份 | 追加规则 |
| --- | --- | --- | --- |
| 规则Y | 规则 A | 身份 A-1-默认；身份 B-2-最多 | 追加 A |

出处：P01-03, P01-04

## 身份表

| 身份名 | 数量上限 | 身份特性 | 能力 |
| --- | --- | --- | --- |
| 身份 A | 1 | 无视友好，不死 | 能力 A |

出处：P01-05

## 事件表

| 事件名 | 事件效果 |
| --- | --- |
| 事件 A | 效果 A |

出处：P01-06
""",
        encoding="utf-8",
    )

    parsed = parse_module_markdown(source)
    appearances = parsed["tables"]["rules"][0]["登场身份"]
    assert parsed["tables"]["rules"][0]["规则类型"] == "规则Y"
    assert parsed["tables"]["rules"][0]["规则名"] == "规则 A"
    assert appearances == [
        {"identity": "身份 A", "count": "1", "count_rule": "默认"},
        {"identity": "身份 B", "count": "2", "count_rule": "最多"},
    ]
    assert parsed["tables"]["roles"][0]["身份特性"] == ["无视友好", "不死"]
    assert parsed["source_refs"]["rules"] == ["P01-03", "P01-04"]

    rendered = tmp_path / "rendered.md"
    rendered.write_text(render_module_markdown(parsed), encoding="utf-8")
    reparsed = parse_module_markdown(rendered)
    assert reparsed["tables"] == parsed["tables"]
    assert reparsed["source_refs"] == parsed["source_refs"]


def test_trait_pool_markdown_round_trip(tmp_path: Path) -> None:
    source = tmp_path / "traits.md"
    source.write_text(
        render_trait_pool_markdown(
            [
                {"name": "无视友好", "description": "说明 A"},
                {"name": "不死", "description": "说明 B"},
            ]
        ),
        encoding="utf-8",
    )

    assert parse_trait_pool_markdown(source) == [
        {"name": "无视友好", "description": "说明 A"},
        {"name": "不死", "description": "说明 B"},
    ]


def test_character_cards_markdown_round_trip(tmp_path: Path) -> None:
    source = tmp_path / "cards.md"
    cards = [
        {
            "first_module": "first-steps",
            "page_code": "page-01",
            "page_image": "pages/page-01.png",
            "name": "测试角色",
            "paranoia_limit": "2",
            "goodwill_limit": "3",
            "initial_location": "学校",
            "forbidden_locations": ["都市"],
            "tags": ["学生", "少女"],
            "abilities": [
                {
                    "required_goodwill": "2",
                    "frequency": "每天",
                    "timing": "主人公能力阶段",
                    "actor": "主人公",
                    "effect": "测试效果。",
                }
            ],
            "notes": "测试备注",
        }
    ]
    source.write_text(render_character_cards_markdown(cards), encoding="utf-8")

    parsed = parse_character_cards_markdown(source)
    assert parsed == cards

    rendered = tmp_path / "rendered-cards.md"
    rendered.write_text(render_character_cards_markdown(parsed), encoding="utf-8")
    assert parse_character_cards_markdown(rendered) == cards
