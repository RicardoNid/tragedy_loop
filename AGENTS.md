# Agent Guide

## Project Intent

This project organizes material for the board game 惨剧轮回 / 惨劇RoopeR / Tragedy Looper and incrementally prototypes a digital version for online play.

The long-term vision has three product lines:

- A sourced reference site, including beginner-friendly teaching material.
- A Web-first online game that can reproduce the paper play flow.
- Advanced tools, including reasoning assistance and script authoring/validation.

Near-term work should favor:

- Accurate, sourced rules and terminology notes.
- A spoiler-light Marp teaching deck for new players.
- A UI-independent rules model that can support the browser prototype and later network play.

## Project Zones

- `facts/`: factual inputs and derived factual data. This includes paper scans, archived references, public research notes, human-reviewed extraction drafts, and structured data.
- `code/`: implementation. This includes the Python package, browser prototype, rules core, processing scripts, and tests.
- `products/`: deliverables and previews. This includes Marp slide sources, generated static pages, and future site/game build outputs.
- `docs/`: project meta documentation such as architecture notes, ingestion workflow, known misunderstandings, and vision.

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
- Put local scans and upload inbox files under `facts/source_material/scans/`; do not commit scans unless the user explicitly confirms that doing so is appropriate.
- Keep source PDFs, page images, OCR drafts, and extraction review docs under `facts/source_material/reference/`.
- Avoid copying long rulebook/card text or artwork into the repo. Prefer summaries, identifiers, and structured fields that can be verified against owned source material.
- Code should not invent game facts. If a rule, role, event, or card field is uncertain, record the uncertainty in `facts/` or `docs/development/known-misunderstandings.md` before encoding it as runtime behavior.

## Useful Commands

```bash
uv sync
uv run tragedy-loop
npm run app:serve
npm run app:test
uv run pytest
uv run ruff check .
```
