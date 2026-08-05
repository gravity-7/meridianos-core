# Vendored frontend libraries

Static browser assets only — never installed into the Node.js dependency tree (`npm ls --prod`
does not and must not list these). No bundler, no build step; loaded via plain `<script>`/`<link>`
tags from `dashboard/index.html`, exactly like the rest of the dashboard.

This is the **second** documented, justified exception to the zero-dependency principle (the first
being `stripe`, backend, P6 — see `specs/006-multi-tenant-platform/research.md`). See
`specs/008-end-user-configurability/plan.md`'s Constitution Check for the full justification.

| Library | Version | Source | Files | License |
|---|---|---|---|---|
| uPlot | 1.6.32 | `npm view uplot@1.6.32` (npm registry) | `uplot.iife.min.js`, `uplot.min.css` | MIT — `uplot.LICENSE.txt` |
| Muuri | 0.9.5 | `npm view muuri@0.9.5` (npm registry) | `muuri.min.js` | MIT — `muuri.LICENSE.md` |
| Litegraph.js | 0.7.18 | `npm view litegraph.js@0.7.18` (npm registry) | `litegraph.min.js`, `litegraph.css` | MIT — `litegraph.LICENSE.txt` |

## Fetched

2026-08-05, via `npm pack <name>@<version>` against the public npm registry, extracting only the
minified browser build + license + (where applicable) stylesheet from each tarball. Source maps,
ESM/CJS builds, TypeScript defs, and each package's own source tree were NOT vendored — only what
the dashboard actually loads at runtime.

## Upgrade procedure

1. Pick the new version, confirm it's still framework-free / dependency-free per the Constitution
   Check reasoning in `plan.md` (re-verify — a major version bump could change that).
2. `npm pack <name>@<new-version>` into a scratch directory, extract, diff the minified build
   against the vendored copy for anything unexpected.
3. Replace the specific file(s) in this directory, update the version + fetch date in this table.
4. Reload the dashboard's Settings/Observability workspace live in a browser (see
   `specs/008-end-user-configurability/tasks.md` T013/T018) — these libraries have no test suite of
   their own here, so a live check is the only regression signal.
