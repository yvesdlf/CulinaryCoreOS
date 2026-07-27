<!--
Guidance for AI coding agents working in this repository.
This file was generated automatically after a repository scan.
If this repository gets populated with source files, update this file
to include concrete build/test commands and examples discovered in the tree.
-->

# Copilot / AI Agent Instructions (Concise)

Purpose: help an AI agent become productive here quickly. The repository currently contains no source files (only `.git`), so these instructions focus on safe discovery, user-confirmation patterns, and how to update this file when code is added.

- **Repository state:** empty of source code; root path: `.`. If you expect code, ask the user which subfolder contains it.

- **Primary goal:** discover the project's language, build/test commands, and key components before making non-trivial edits.

Discovery checklist (run before coding):
- Look for manifests in the repo root and common subfolders: `package.json`, `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `go.mod`, `Cargo.toml`, `pom.xml`, `Makefile`, `Dockerfile`, `README.md`.
- Search for CI/workflow files: `.github/workflows/**`, `Jenkinsfile`, `circle.yml`.
- Search for docs or agent hints: `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md` (merge if present).
- If none of the above exist, prompt the user with a short list of options: provide repo entrypoint, intended language, or point to a folder that contains the code.

How to probe (examples):
- Run: `ls -la` and `git status` to confirm repository contents and branch.
- Run quick searches: `git grep -n "^FROM\|python\|node\|go\|make" -- . || true` to discover likely stack hints.

Rules for editing and PRs:
- Never add or refactor significant functionality until you have: a) identified build/test steps, b) confirmed the user's acceptance for the intended change.
- Small, focused patches only. Include a concise commit message and describe the intent in the PR body.

What to put in this file once code exists (guidance for future updates):
- Add concrete build/test commands (examples with exact paths). Example: `cd api && go test ./...` or `python -m pytest tests/`.
- Add common developer workflows (run server, run migrations, run linter/formatter) using exact commands discovered in the repo.
- Document any nonstandard conventions discovered (monorepo layouts, generated-code folders, custom script names).

If you are the human owner: please update this file with actual examples and commands after initial code is added — AI agents will rely on them.

Questions for the owner (ask concisely):
- Which folder contains the application source?
- What are the canonical build and test commands?
- Any nonstandard development steps (DB setup, credentials, external services)?

If you want, I can now:
- scan the repository again for new files, or
- create a short template `README.md` and example `Makefile` to bootstrap developer workflows.
