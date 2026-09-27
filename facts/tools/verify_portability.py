"""Verify local reader assets without depending on an existing checkout or login."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import re

ROOT = Path(__file__).resolve().parents[1]
references = set()

def visit(value):
    if isinstance(value, dict):
        for child in value.values():
            visit(child)
    elif isinstance(value, list):
        for child in value:
            visit(child)
    elif isinstance(value, str) and value.startswith(('media/', 'text/', 'sources/', 'data/')):
        references.add(value)

for path in (ROOT / 'data').rglob('*.json'):
    visit(json.loads(path.read_text()))
for link in re.findall(r'(?:src|href)="([^"]+)"', (ROOT / 'index.html').read_text()):
    if not urlsplit(link).scheme and not link.startswith('#'):
        references.add(link)
for reference in sorted(references):
    path = (ROOT / unquote(urlsplit(reference).path)).resolve()
    assert path.is_relative_to(ROOT), reference
    assert path.is_file(), reference
for path in (ROOT / 'media').rglob('*'):
    if path.is_file():
        assert not path.read_bytes().startswith(b'version https://git-lfs.github.com/spec/v1'), path
print(f'Verified {len(references)} local reader references and real media files (no LFS pointers).')
