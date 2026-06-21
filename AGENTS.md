# Agent Guide

## Project Intent

This project organizes material for the board game 惨剧轮回 / 惨劇RoopeR / Tragedy Looper and incrementally prototypes a digital version for online play.

Near-term work should favor:

- Accurate, sourced rules and terminology notes.
- A spoiler-light Marp teaching deck for new players.
- A UI-independent rules model that can support the browser prototype and later network play.

## Tooling

- Use Python 3.12 through `uv`.
- Use the project-local virtual environment at `.venv/`.
- Run commands with `uv run`, for example `uv run pytest` and `uv run tragedy-loop`.
- The playable prototype is web-first; avoid adding a second GUI toolkit unless the user explicitly asks for a desktop app.
- Marp slide sources live in `products/slides/`; Marp rendering is handled outside Python.

## Repository Conventions

- Keep game logic separate from GUI code whenever possible.
- Put derived structured data in `facts/structured/`.
- Put public research notes in `facts/research/` with source links and dates where useful.
- Put local scans under `facts/source_material/scans/`; do not commit scans unless the user explicitly confirms that doing so is appropriate.
- Avoid copying long rulebook/card text or artwork into the repo. Prefer summaries, identifiers, and structured fields that can be verified against owned source material.

## Useful Commands

```bash
uv sync
uv run tragedy-loop
uv run pytest
uv run ruff check .
```
