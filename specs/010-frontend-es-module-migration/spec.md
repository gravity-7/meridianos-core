# Feature Specification: Frontend ES Module Migration

**Feature Branch**: `010-frontend-es-module-migration`

**Created**: 2026-08-07

**Status**: Parked — placeholder only, not yet drafted

**Input**: Carved out of `specs/009-dashboard-modernization/plan.md`'s Constitution Check, Principle VIII
(ES Modules & Modern JavaScript), which was flagged `⚠️ PARTIAL` rather than a clean pass.

## Why this exists

`dashboard/index.html`'s legacy inline `<script>` block predates the Constitution and violates Principle
VIII outright — no `import`/`export`, global function reassignment (`poll = async function(){...}`, fixed
for the polling path specifically in Phase 9, but the rest of the ~2,600-line inline script is still one
giant non-module script, not a set of `.mjs` modules).

Phase 9 (`009-dashboard-modernization`) improves this incrementally as it ports individual legacy sections
into proper `.mjs` panels (matching 008's `registerPanel()` pattern), but it does not claim to finish the
job — full compliance means every remaining piece of that inline script is ported to a real module. That's
realistically a separate, multi-release effort, not a side effect of Phase 9's own scope.

This placeholder exists so that gap has a home and doesn't get silently dropped once Phase 9 ships and
"good enough" starts to feel like "done."

## Not yet drafted

No user stories, requirements, or plan yet — this is intentionally just a marker. Draft properly once Phase
9 has landed enough of its own panel migrations to know exactly what's left over in the legacy script.
