from __future__ import annotations

import argparse
import shlex
import subprocess
import textwrap
from collections.abc import Sequence

SERVER_ALIAS = "server-ltr"
SERVER_APP_DIR = "/home/ltr/apps/tragedy_loop"
SERVER_RUNTIME_ROOT = "/home/ltr/apps/tragedy_loop_runtime"
SERVER_SERVICE = "tragedy-loop-web.service"
SERVER_PORT = 18174
NAS_REMOTE = "origin"
SERVICE_UNIT = f"""[Unit]
Description=Tragedy Loop web prototype and reference site
After=default.target

[Service]
Type=simple
WorkingDirectory={SERVER_APP_DIR}
Environment=PYTHONUNBUFFERED=1
Environment=TRAGEDY_LOOP_RUNTIME_ROOT={SERVER_RUNTIME_ROOT}
ExecStart={SERVER_APP_DIR}/.venv/bin/tragedy-loop --host 0.0.0.0 --port {SERVER_PORT}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
"""


def run(command: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    printable = " ".join(shlex.quote(part) for part in command)
    print(f"$ {printable}", flush=True)
    return subprocess.run(command, check=check, text=True)


def run_capture() -> None:
    ssh_script(
        f"""
        set -euo pipefail
        cd {shlex.quote(SERVER_APP_DIR)}
        {remote_capture_script(reset_after_capture=False)}
        """
    )
    fetch_capture_refs()
    print_review_help()


def run_deploy(*, skip_tests: bool, skip_push: bool) -> None:
    if not skip_tests:
        run(["uv", "run", "pytest"])
        run(["npm", "run", "app:test"])
    if not skip_push:
        run(["git", "push", NAS_REMOTE, "HEAD:main"])

    ssh_script(build_remote_deploy_script())
    fetch_capture_refs()
    print_review_help()


def remote_capture_script(*, reset_after_capture: bool) -> str:
    reset_line = "git reset --hard origin/main" if reset_after_capture else ":"
    return textwrap.dedent(
        f"""
        git config user.name "ltr"
        git config user.email "lsfans@qq.com"
        mkdir -p runtime/prototype-logs {shlex.quote(SERVER_RUNTIME_ROOT)}/prototype-logs
        if [ -d {shlex.quote(SERVER_RUNTIME_ROOT)}/prototype-logs ]; then
          cp -a {shlex.quote(SERVER_RUNTIME_ROOT)}/prototype-logs/. runtime/prototype-logs/ 2>/dev/null || true
        fi

        CAPTURE_FACT_PATHS="$(git status --porcelain -- facts | sed 's/^...//')"
        git add facts
        git add -f runtime/prototype-logs 2>/dev/null || true

        if git diff --cached --quiet; then
          CAPTURE_BRANCH=""
          CAPTURE_COMMIT=""
          echo "No server fact edits or prototype logs to capture."
        else
          CAPTURE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
          CAPTURE_BRANCH="server/capture-$CAPTURE_STAMP"
          git commit -m "Capture server edits $CAPTURE_STAMP"
          CAPTURE_COMMIT="$(git rev-parse HEAD)"
          git push origin HEAD:refs/heads/$CAPTURE_BRANCH
          echo "Captured server edits in $CAPTURE_BRANCH ($CAPTURE_COMMIT)."
          {reset_line}
        fi
        export CAPTURE_BRANCH CAPTURE_COMMIT CAPTURE_FACT_PATHS
        """
    ).strip()


def build_remote_deploy_script() -> str:
    setup = textwrap.dedent(
        f"""
        set -euo pipefail
        if [ ! -d {shlex.quote(SERVER_APP_DIR)}/.git ]; then
          rm -rf {shlex.quote(SERVER_APP_DIR)}
          mkdir -p "$(dirname {shlex.quote(SERVER_APP_DIR)})"
          git clone --branch main qnap-nas-git:/srv/git/tragedy_loop.git {shlex.quote(SERVER_APP_DIR)}
        fi
        cd {shlex.quote(SERVER_APP_DIR)}
        """
    ).strip()
    deploy_before_service = textwrap.dedent(
        """
        git fetch origin main
        git checkout -B main origin/main
        git reset --hard origin/main

        if [ -n "${{CAPTURE_COMMIT:-}}" ] && [ -n "${{CAPTURE_FACT_PATHS:-}}" ]; then
          printf '%s\\n' "$CAPTURE_FACT_PATHS" \\
            | git restore --source "$CAPTURE_COMMIT" --worktree --pathspec-from-file=-
          echo "Reapplied captured server fact edits to deployed worktree."
        fi

        uv sync --python 3.12 --frozen --reinstall-package tragedy-loop
        mkdir -p /home/ltr/.config/systemd/user
        """
    ).strip()
    write_service = (
        f"cat > /home/ltr/.config/systemd/user/{SERVER_SERVICE} <<'EOF'\n"
        f"{SERVICE_UNIT.rstrip()}\n"
        "EOF"
    )
    deploy_after_service = textwrap.dedent(
        f"""
        systemctl --user daemon-reload
        systemctl --user enable --now {SERVER_SERVICE}
        systemctl --user restart {SERVER_SERVICE}
        sleep 1
        systemctl --user is-active {SERVER_SERVICE}
        curl -fsS -o /dev/null -w 'portal %{{http_code}}\\n' http://127.0.0.1:{SERVER_PORT}/
        curl -fsS -o /dev/null -w 'prototype %{{http_code}}\\n' \\
          http://127.0.0.1:{SERVER_PORT}/prototype/
        curl -fsS -o /dev/null -w 'site %{{http_code}}\\n' \\
          http://127.0.0.1:{SERVER_PORT}/site/slides/beginner-teaching.html
        ss -H -ltnp '( sport = :{SERVER_PORT} )'
        git status --short
        """
    ).strip()
    return "\n".join(
        [
            setup,
            remote_capture_script(reset_after_capture=True),
            deploy_before_service,
            write_service,
            deploy_after_service,
        ]
    )


def fetch_capture_refs() -> None:
    run(
        [
            "git",
            "fetch",
            NAS_REMOTE,
            "refs/heads/server/capture-*:refs/remotes/origin/server/capture-*",
        ],
        check=False,
    )


def print_review_help() -> None:
    print(
        textwrap.dedent(
            """

            Review captured server edits with:
              git branch -r --list 'origin/server/capture-*'
              git diff origin/main...origin/server/capture-<stamp> -- facts
              git checkout -p origin/server/capture-<stamp> -- facts

            Prototype logs are stored only on capture branches:
              git ls-tree -r --name-only origin/server/capture-<stamp> runtime/prototype-logs
              git show origin/server/capture-<stamp>:runtime/prototype-logs/<date>/<session>.jsonl
            """
        ).strip()
    )


def ssh_script(script: str) -> None:
    cleaned = textwrap.dedent(script).strip() + "\n"
    printable = f"ssh -o BatchMode=yes {SERVER_ALIAS} bash -s"
    print(f"$ {printable}", flush=True)
    subprocess.run(
        ["ssh", "-o", "BatchMode=yes", SERVER_ALIAS, "bash", "-s"],
        input=cleaned,
        check=True,
        text=True,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deploy and reconcile the Tragedy Loop server.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    deploy = subparsers.add_parser("deploy", help="Push current HEAD and deploy the server.")
    deploy.add_argument("--skip-tests", action="store_true", help="Do not run local tests first.")
    deploy.add_argument("--skip-push", action="store_true", help="Do not push HEAD to NAS main.")

    subparsers.add_parser("capture", help="Capture server fact edits and prototype logs to NAS.")
    subparsers.add_parser("review-help", help="Print selective merge commands.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "deploy":
        run_deploy(skip_tests=args.skip_tests, skip_push=args.skip_push)
        return 0
    if args.command == "capture":
        run_capture()
        return 0
    if args.command == "review-help":
        print_review_help()
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
