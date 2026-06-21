from __future__ import annotations

import argparse
import functools
from collections.abc import Sequence
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROJECT_NAME = "惨剧轮回"
VERSION = "0.1.0"


def find_project_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "pyproject.toml").is_file():
            return parent
    raise RuntimeError("Could not locate project root from tragedy_loop package.")


ROOT = find_project_root()
WEB_ROOT = ROOT / "code" / "web"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tragedy-loop",
        description="Serve the web prototype for the Tragedy Looper project.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--port", type=int, default=5173, help="Port to bind. Defaults to 5173.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return parser


def serve_web(host: str, port: int) -> None:
    handler = functools.partial(SimpleHTTPRequestHandler, directory=WEB_ROOT)
    server = ThreadingHTTPServer((host, port), handler)
    url = f"http://{host}:{port}/"
    print(f"{PROJECT_NAME} Web prototype: {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    serve_web(args.host, args.port)
