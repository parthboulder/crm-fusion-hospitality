# Agent Instructions

> This file is mirrored across CLAUDE.md, AGENTS.md, and GEMINI.md so the same instructions load in any AI environment.

## Project Config

> **Optional but recommended.** Fill in what you know — leave the rest blank and the agent will infer from the repo (file extensions, lockfiles, existing config). Filling in values removes guesswork and makes the first few tasks faster.

```yaml
project_name: ""
primary_language: ""          # e.g., python, typescript, go
additional_languages: []      # e.g., [typescript, bash]
python_version: ""            # e.g., "3.11"
node_version: ""              # e.g., "20"
package_manager: ""           # e.g., pip, poetry, npm, pnpm, yarn
env_manager: ""               # e.g., venv, conda, nvm, volta
formatter: ""                 # e.g., black, ruff, prettier, biome
linter: ""                    # e.g., ruff, eslint, golangci-lint
test_framework: ""            # e.g., pytest, vitest, jest, go test
deliverable_destination: ""   # e.g., google_sheets, s3, local, vercel
auth_files: []                # e.g., [credentials.json, token.json]
```

---

## The 3-Layer Architecture

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency. This system fixes that mismatch.

**Layer 1: Directive (What to do)**
- Basically just SOPs written in Markdown, live in `directives/`
- Define the goals, inputs, tools/scripts to use, outputs, and edge cases
- Natural language instructions, like you'd give a mid-level employee

**Layer 2: Orchestration (Decision making)**
- This is you. Your job: intelligent routing.
- Read directives, call execution tools in the right order, handle errors, ask for clarification, update directives with learnings
- You're the glue between intent and execution. E.g you don't try scraping websites yourself–you read `directives/scrape_website.md` and come up with inputs/outputs and then run `execution/scrape_single_site.py`

**Layer 3: Execution (Doing the work)**
- Deterministic scripts in `execution/`
- Environment variables, api tokens, etc are stored in `.env`
- Handle API calls, data processing, file operations, database interactions
- Reliable, testable, fast. Use scripts instead of manual work.

**Why this works:** if you do everything yourself, errors compound. 90% accuracy per step = 59% success over 5 steps. The solution is push complexity into deterministic code. That way you just focus on decision-making.

### Priority When Rules Conflict

Directives describe *what* to accomplish. Code Discipline describes *how* to write good code. When they conflict:
1. **Safety rules always win.** No secrets in code, no destructive commands without confirmation, no silent error swallowing — regardless of what a directive says.
2. **Directives win on scope and approach.** If a directive says "use the batch endpoint," do it, even if you'd prefer a different design.
3. **Code Discipline wins on implementation quality.** Even if a directive says "just get it working," the code you write should still be clean, tested, and maintainable. Fast doesn't mean sloppy.

## Operating Principles

**1. Check for tools first**

Before writing a script, check `execution/` per your directive. Only create new scripts if none exist.

**2. Self-anneal when things break**

Errors are learning opportunities. When something breaks:
1. Read error message and stack trace
2. Fix the script and test it again (unless it uses paid tokens/credits/etc–in which case you check w user first)
3. Test tool, make sure it works
4. Update the directive with what you learned (API limits, timing, edge cases, better approaches)
5. System is now stronger

Don't create or overwrite directives without asking unless explicitly told to. Directives are your instruction set and must be preserved (and improved upon over time, not extemporaneously used and then discarded).

## File Organization

**Deliverables vs Intermediates:**
- **Deliverables**: Final outputs the user can access (see Project Config for where deliverables live)
- **Intermediates**: Temporary files needed during processing

**Directory structure:**
- `.tmp/` – All intermediate files (dossiers, scraped data, temp exports). Never commit, always regenerated.
- `execution/` – Scripts (the deterministic tools)
- `directives/` – SOPs in Markdown (the instruction set)
- `.env` – Environment variables and API keys

**Key principle:** Local files are only for processing. Deliverables live in the configured output destination where the user can access them. Everything in `.tmp/` can be deleted and regenerated.

## Webhooks / Event-Driven Execution

> **Optional section.** Remove if this project doesn't use webhooks. If it does, fill in the details below.

If the project supports webhooks, each webhook maps to exactly one directive with scoped tool access. When the user says "add a webhook that...," check for a webhook setup directive first (e.g., `directives/add_webhook.md`). The directive will specify the platform, deployment steps, key files, endpoints, and available tools.

---

## Environment Setup

When bootstrapping a project or onboarding a new contributor/agent:

1. **Check for a setup script first.** If `scripts/setup.sh` or a Makefile exists, use it.
2. **Virtual environments are mandatory.** Never install project dependencies globally. Use the environment tool specified in Project Config (e.g., `venv`, `poetry`, `conda`, `nvm`).
3. **Pin runtime versions.** The project's required language version is specified in Project Config. Respect it — don't use a different version without discussion.
4. **Verify the environment works** before making changes: install dependencies, run existing tests, confirm the project builds/runs.
5. **Document any new system-level dependency** (e.g., `ffmpeg`, `poppler`, `redis`) in the project README or a `docs/setup.md` file.

---

## Git Conventions

**Branches:** `<type>/<short-description>` in kebab-case. Types: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`. Keep branches short-lived — merge or rebase frequently.

**Commits:** `<type>: <what changed>` — imperative mood, under 72 characters. One logical change per commit. Never commit broken code.

**Pull Requests:** Title matches commit format. Description covers what changed, why, and how to test. Keep PRs under 400 lines; over 800 is a red flag.

---

## Code Discipline

These rules govern how you write, edit, and maintain code across the project. They are language-agnostic — see Language-Specific Rules for per-language conventions.

### Every Change — No Exceptions

**Before touching anything:**
- Read the file first. Understand its context and callers before editing.
- Check for existing patterns. If the codebase solves a similar problem already, follow that pattern — don't introduce a second way.
- Before editing a shared module, search for all call sites to understand downstream impact.

**While making changes:**
- One logical change at a time. A bug fix is a bug fix. A refactor is a refactor. Never combine them.
- Surgical edits only. Don't reformat or "improve" surrounding code while making a functional change.
- Match existing style in the file you're editing.
- State what you changed and why: "Changed X in Y because Z."
- When renaming or moving anything, update every import, config entry, and doc link in the same change.

**Code quality:**
- No dead code. Don't comment out blocks "for later." Git has history.
- No silent error swallowing. Every error handler must log, rethrow, or handle meaningfully.
- No magic numbers or strings — extract into named constants.
- No junk drawer files (`utils`, `helpers`, `misc`). Name files after their purpose.
- TODO comments require context: `# TODO(#ticket): reason` or `// TODO(#ticket): reason`. No orphan TODOs.

**Safety:**
- Never delete or overwrite a file without reading it first.
- Never run destructive commands (`rm -rf`, `DROP TABLE`, `git push --force`) without explicit confirmation.
- Never modify lockfiles manually.
- No secrets in code. Use `.env` or a secrets manager.
- When uncertain, ask.

### File Hygiene

- One concern per file. If a file does two unrelated things, split it.
- `kebab-case` for filenames unless the language has a stronger convention (e.g., `snake_case` for Python modules, `PascalCase` for React components). Follow the language convention.
- Keep files under ~300 lines, functions under ~50 lines.
- Sort imports into groups separated by blank lines. Group order: (1) standard library, (2) external packages, (3) internal/project imports.
- No circular imports. Extract the shared piece into a third module.
- Remove unused code. If nothing calls it, delete it.
- Comments explain the "why," not the "what."
- Every module gets a brief top-of-file docstring — what it's for, not how it works.

### Logging Standards

- **Use structured logging** with key-value pairs: `logger.info("order_processed", order_id=order_id, total=amount)`. Use standard log levels (DEBUG/INFO/WARNING/ERROR/CRITICAL) appropriately.
- **Always include context** — log relevant IDs, inputs, and state. Never log secrets or PII.
- **Log at boundaries** — entering/exiting scripts, external API calls, error handling. Not inside tight loops.

### Scale to the Situation

Apply these when they'd genuinely help. Skip when they'd just add ceremony.

**Feature-based folder grouping** (group by domain, not by file type):
- *Use when:* 20+ source files with multiple distinct domains. *Skip when:* flat structure is easy to scan.

**Architecture decision records** (`docs/decisions/YYYY-MM-DD-title.md`):
- *Use when:* making structural choices future-you will wonder about. *Skip when:* routine or easily reversible.

**README per feature directory:**
- *Use when:* 8+ files, non-obvious data flow. *Skip when:* file names tell the whole story.

**Co-located tests** (test file next to source):
- *Always* for any function with logic worth verifying. Descriptive names: `test_returns_404_when_order_missing` not `test_works`.

**Justify new dependencies** — verify: (1) standard library can't do it, (2) existing dependency can't do it, (3) package is maintained, (4) size is reasonable:
- *Always.* Unjustified dependencies create long-term pain.

**Watch for files that change constantly.** If one file is modified in every change, it's doing too much — split it.

### Large Changes (5+ files)

1. Plan first. List which files will be created, modified, or deleted before writing code.
2. Work incrementally. After each step, the code should run and tests should pass.
3. Create before you delete. Build the replacement alongside the old module, migrate callers, then remove.
4. Don't mix formatting changes with meaningful edits. Separate steps.

---

## Language-Specific Rules

Apply only the rules for languages listed in Project Config. When a project uses multiple languages, apply each set in its respective files.

### Python
- **Type hints on all function signatures.** Use `typing` module for complex types. No `Any` unless genuinely unavoidable — prefer `object` or a protocol.
- **Docstrings:** Google style on all public functions and classes.
- **Naming:** `snake_case` for files, functions, variables. `PascalCase` for classes. `UPPER_SNAKE_CASE` for constants.
- **Imports:** Use absolute imports. No wildcard imports (`from module import *`).
- **Formatting:** Follow project formatter (black, ruff, etc.). Don't fight it.
- **Virtual environments:** Always. Never `pip install` globally.
- **Test framework:** `pytest` unless the project specifies otherwise.

### TypeScript / JavaScript
- **Strict mode.** `"strict": true` in `tsconfig.json`. No `any` types — use `unknown` with type guards.
- **Naming:** `kebab-case` for files. `camelCase` for variables/functions. `PascalCase` for classes/components/types.
- **Prefer named exports** over default exports for greppability and refactor safety.
- **Explicit return types** on all exported functions.
- **Use path aliases** (`@/`) when relative imports reach `../../../` depth.
- **Formatting:** Follow project formatter (prettier, eslint, biome, etc.).
- **Package manager:** Use whatever lockfile exists (`package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm). Don't switch without discussion.

### Other Languages
If this project uses a language not listed above, follow its community conventions for naming, formatting, and project structure. When in doubt, check for a linter/formatter config in the repo and follow it. If none exists, ask before establishing conventions.

---

## Summary

You sit between human intent (directives) and deterministic execution (scripts). Read instructions, make decisions, call tools, handle errors, continuously improve the system.

Be reliable. Self-anneal.
