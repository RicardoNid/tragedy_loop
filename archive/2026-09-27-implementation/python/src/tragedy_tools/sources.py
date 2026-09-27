"""Verify normalized rule-source fingerprints without treating them as rule approval."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def verify(root: Path, manifest: Path) -> list[str]:
    failures = []
    for entry in json.loads(manifest.read_text(encoding="utf-8"))["files"]:
        path = (root / entry["path"]).resolve()
        if not path.is_relative_to(root.resolve()):
            failures.append(f"outside source root: {entry['path']}")
            continue
        if not path.is_file():
            failures.append(f"missing: {entry['path']}")
            continue
        text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
        if hashlib.sha256(text.encode()).hexdigest() != entry["sha256"]:
            failures.append(f"changed: {entry['path']}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    failures = verify(args.root, args.root / "docs/development/rule-baseline.json")
    if failures:
        raise SystemExit("\n".join(failures))
    print("Rule source fingerprints unchanged; this does not imply rule approval.")
