import pytest

from tragedy_loop.app import PROJECT_NAME, WEB_ROOT, build_parser


def test_project_name() -> None:
    assert PROJECT_NAME == "惨剧轮回"


def test_cli_help_exits_without_launching_gui() -> None:
    with pytest.raises(SystemExit) as exc_info:
        build_parser().parse_args(["--help"])

    assert exc_info.value.code == 0


def test_web_root_exists() -> None:
    assert (WEB_ROOT / "index.html").is_file()
