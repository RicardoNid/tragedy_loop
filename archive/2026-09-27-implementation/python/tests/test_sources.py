import hashlib
import json
from tragedy_tools.sources import verify


def test_detects_changes_missing_files_and_path_escape(tmp_path):
    source = tmp_path / "rules.md"
    source.write_bytes(b"\xef\xbb\xbfrules\r\n")
    manifest = tmp_path / "manifest.json"
    entry = {"path": "rules.md", "sha256": hashlib.sha256(b"rules\n").hexdigest()}
    manifest.write_text(json.dumps({"files": [entry]}))
    assert verify(tmp_path, manifest) == []
    source.write_text("different\n")
    assert verify(tmp_path, manifest) == ["changed: rules.md"]
    source.unlink()
    assert verify(tmp_path, manifest) == ["missing: rules.md"]
    entry["path"] = "../outside"
    manifest.write_text(json.dumps({"files": [entry]}))
    assert verify(tmp_path, manifest) == ["outside source root: ../outside"]
