# MeridianOS — Agent Instructions

> **Project**: MeridianOS — provider/harness-agnostic autonomous agent orchestrator
> **Repo**: gravity-7/meridianos-core
> **Node.js**: 24+ required (better-sqlite3 ABI)

## Coding Conventions

### File Naming
- All source files use `.mjs` extension (ES modules)
- Test files: `*.test.mjs` under `tests/` and `gateway/tests/`
- Config files: `.yml` or `.json`

### Import Style
- Use `import`/`export` syntax exclusively
- No `require()`, no `module.exports`
- Node.js built-in imports use `node:` prefix: `import fs from "node:fs"`

### Testing
- Run: `npm test` (uses Node.js native test runner `node --test`)
- 915 tests currently pass, 0 failures
- Use cassette system (`test/cassette.mjs`) for LLM response mocking
- Never commit `.only()` in tests

### Commits
- Format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`
- Scope: module name or epic reference (e.g., `gateway`, `P0-F1`)

### PR Process
- All PRs reference parent issue: `Closes #N` or `Part of: [Epic] Description`
- PR title format: `[Epic]-[Feature]: Brief description`
- Branches deleted after merge
- See `.github/rules/pr-discipline.md` for full policy

### Dependencies
- **Zero-dependency philosophy**: Only `better-sqlite3` as external dependency
- All other functionality uses Node.js built-ins
- Before adding a dependency, prove it cannot be implemented with built-ins

### Architecture Constraints
- Gateway (`gateway/server.mjs`) is the SINGLE metering path — all LLM traffic routes through it
- Dashboard on port 4317 — never hardcode, use config
- `.ai/` directory is gitignored — runtime state only
- Configuration via `policy.yaml` — not environment variables (except secrets)

### Spec-Kit Workflow
This project uses spec-kit for spec-driven development. The workflow is:
1. `/speckit-constitution` — Establish project principles (already done)
2. `/speckit-specify` — Define what to build
3. `/speckit-plan` — Create technical implementation plan
4. `/speckit-tasks` — Generate actionable tasks
5. `/speckit-implement` — Execute implementation
6. `/speckit-converge` — Verify completeness

Optional quality gates:
- `/speckit-clarify` — Resolve ambiguities before planning
- `/speckit-checklist` — Validate requirements completeness
- `/speckit-analyze` — Cross-artifact consistency check

<!-- SPECKIT START -->
<!-- SPECKIT END -->
