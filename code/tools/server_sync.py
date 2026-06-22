from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
import textwrap
from collections.abc import Sequence

SERVER_ALIAS = "server-ltr"
SERVER_APP_DIR = "/home/ltr/apps/tragedy_loop"
SERVER_RUNTIME_ROOT = "/home/ltr/apps/tragedy_loop_runtime"
SERVER_SERVICE = "tragedy-loop-web.service"
SERVER_PORT = 18174
GITHUB_REMOTE = "origin"
NAS_REPO = "qnap-nas-git:/srv/git/tragedy_loop.git"
CAPTURE_REFSPEC = "refs/heads/server/capture-*:refs/remotes/nas/server/capture-*"
DEFAULT_DEPLOY_BRANCH = "main"
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


def run_text(command: Sequence[str], *, check: bool = True) -> str:
    printable = " ".join(shlex.quote(part) for part in command)
    print(f"$ {printable}", flush=True)
    result = subprocess.run(command, check=check, capture_output=True, text=True)
    if result.stderr:
        sys.stderr.write(result.stderr)
    if result.stdout:
        print(result.stdout, end="")
    return result.stdout


def run_capture() -> None:
    ssh_script_output(
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
        run(["git", "push", NAS_REPO, "HEAD:main"])

    ssh_script_output(build_remote_deploy_script(capture_before_deploy=True, branch=DEFAULT_DEPLOY_BRANCH))
    fetch_capture_refs()
    print_review_help()


def run_reconcile(*, skip_tests: bool) -> None:
    branch = run_text(["git", "branch", "--show-current"]).strip()
    if branch not in {"main", "master"}:
        raise SystemExit(f"Refusing to reconcile from {branch!r}; run this from main/master.")
    ensure_clean_worktree()

    run(["git", "fetch", GITHUB_REMOTE, branch])
    run(["git", "merge", "--ff-only", f"{GITHUB_REMOTE}/{branch}"])

    capture_output = ssh_script_output(
        f"""
        set -euo pipefail
        cd {shlex.quote(SERVER_APP_DIR)}
        {remote_capture_script(reset_after_capture=False)}
        """
    )
    capture_branch = parse_capture_branch(capture_output)
    fetch_capture_refs()

    if capture_branch:
        merged_facts = merge_capture_facts(capture_branch)
        if merged_facts:
            run(["git", "commit", "-m", f"Merge server facts {capture_branch.removeprefix('server/capture-')}"])
        else:
            print(f"Capture {capture_branch} had no facts changes to merge into {branch}.")
    else:
        print("No server-side changes were captured.")

    if not skip_tests:
        run(["uv", "run", "pytest"])
        run(["npm", "run", "app:test"])
        run(["uv", "run", "ruff", "check", "."])

    run(["git", "push", GITHUB_REMOTE, branch])
    run(["git", "push", NAS_REPO, f"HEAD:{branch}"])
    ssh_script_output(build_remote_deploy_script(capture_before_deploy=False, branch=branch))
    fetch_capture_refs()


def remote_capture_script(*, reset_after_capture: bool, reset_branch: str = DEFAULT_DEPLOY_BRANCH) -> str:
    reset_line = f"git reset --hard origin/{shlex.quote(reset_branch)}" if reset_after_capture else ":"
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
          git branch -f "$CAPTURE_BRANCH" "$CAPTURE_COMMIT"
          git push origin HEAD:refs/heads/$CAPTURE_BRANCH
          echo "Captured server edits in $CAPTURE_BRANCH ($CAPTURE_COMMIT)."
          rm -rf runtime/prototype-logs/* {shlex.quote(SERVER_RUNTIME_ROOT)}/prototype-logs/*
          {reset_line}
        fi
        echo "__TRAGEDY_CAPTURE_BRANCH=$CAPTURE_BRANCH"
        echo "__TRAGEDY_CAPTURE_COMMIT=$CAPTURE_COMMIT"
        export CAPTURE_BRANCH CAPTURE_COMMIT CAPTURE_FACT_PATHS
        """
    ).strip()


def build_remote_deploy_script(*, capture_before_deploy: bool, branch: str) -> str:
    setup = textwrap.dedent(
        f"""
        set -euo pipefail
        if [ ! -d {shlex.quote(SERVER_APP_DIR)}/.git ]; then
          rm -rf {shlex.quote(SERVER_APP_DIR)}
          mkdir -p "$(dirname {shlex.quote(SERVER_APP_DIR)})"
          git clone --branch {shlex.quote(branch)} qnap-nas-git:/srv/git/tragedy_loop.git {shlex.quote(SERVER_APP_DIR)}
        fi
        cd {shlex.quote(SERVER_APP_DIR)}
        """
    ).strip()
    capture = (
        remote_capture_script(reset_after_capture=True, reset_branch=branch) if capture_before_deploy else ""
    )
    deploy_before_service = textwrap.dedent(
        f"""
        git fetch origin {shlex.quote(branch)}
        git checkout -B {shlex.quote(branch)} origin/{shlex.quote(branch)}
        git reset --hard origin/{shlex.quote(branch)}

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
        [part for part in [setup, capture, deploy_before_service, write_service, deploy_after_service] if part]
    )


def fetch_capture_refs() -> None:
    run(
        [
            "git",
            "fetch",
            NAS_REPO,
            CAPTURE_REFSPEC,
        ],
        check=False,
    )


def parse_capture_branch(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("__TRAGEDY_CAPTURE_BRANCH="):
            return line.removeprefix("__TRAGEDY_CAPTURE_BRANCH=").strip()
    return ""


def ensure_clean_worktree() -> None:
    status = run_text(["git", "status", "--porcelain=v1"])
    if status.strip():
        raise SystemExit("Refusing to reconcile with a dirty local worktree.")


def merge_capture_facts(capture_branch: str) -> bool:
    capture_ref = f"refs/remotes/nas/{capture_branch}"
    capture_commit = run_text(["git", "rev-parse", capture_ref]).strip()
    parent_commit = run_text(["git", "rev-parse", f"{capture_commit}^"]).strip()
    diff = subprocess.run(
        ["git", "diff", "--binary", parent_commit, capture_commit, "--", "facts"],
        check=True,
        capture_output=True,
    ).stdout
    if not diff.strip():
        return False
    print(f"Applying facts changes from {capture_branch}.", flush=True)
    subprocess.run(["git", "apply", "--3way", "--index"], input=diff, check=True)
    return subprocess.run(["git", "diff", "--cached", "--quiet", "--", "facts"]).returncode != 0


def print_review_help() -> None:
    print(
        textwrap.dedent(
            """

            Review captured server edits with:
              git branch -r --list 'nas/server/capture-*'
              git diff origin/main...nas/server/capture-<stamp> -- facts
              git checkout -p nas/server/capture-<stamp> -- facts

            Prototype logs are stored only on capture branches:
              git ls-tree -r --name-only nas/server/capture-<stamp> runtime/prototype-logs
              git show nas/server/capture-<stamp>:runtime/prototype-logs/<date>/<session>.jsonl
            """
        ).strip()
    )


def ssh_script_output(script: str) -> str:
    cleaned = textwrap.dedent(script).strip() + "\n"
    printable = f"ssh -o BatchMode=yes {SERVER_ALIAS} bash -s"
    print(f"$ {printable}", flush=True)
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", SERVER_ALIAS, "bash", "-s"],
        input=cleaned,
        check=True,
        capture_output=True,
        text=True,
    )
    if result.stderr:
        sys.stderr.write(result.stderr)
    if result.stdout:
        print(result.stdout, end="")
    return result.stdout


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deploy and reconcile the Tragedy Loop server.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    deploy = subparsers.add_parser("deploy", help="Push current HEAD and deploy the server.")
    deploy.add_argument("--skip-tests", action="store_true", help="Do not run local tests first.")
    deploy.add_argument("--skip-push", action="store_true", help="Do not push HEAD to NAS main.")

    reconcile = subparsers.add_parser(
        "reconcile",
        help="Capture server edits, merge facts into main/master, push, and deploy.",
    )
    reconcile.add_argument("--skip-tests", action="store_true", help="Do not run local tests first.")

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
    if args.command == "reconcile":
        run_reconcile(skip_tests=args.skip_tests)
        return 0
    if args.command == "review-help":
        print_review_help()
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
