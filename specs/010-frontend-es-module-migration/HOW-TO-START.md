# How to start Phase 10

This phase is parked (see `spec.md`) — no user stories, no plan, on purpose. Follow these steps when it's
actually time to pick it up, in order.

## 0. Gate: don't start until Phase 9 has landed

`009-dashboard-modernization` is actively porting pieces of `dashboard/index.html`'s legacy inline script
into `.mjs` panels. Auditing "what's left non-modular" before that settles means auditing a moving target and
redoing the work. Check `specs/009-dashboard-modernization/tasks.md` — confirm its panel-migration tasks
(US2, and whichever of US1/US4 landed alongside it) are marked done before starting here.

## 1. Re-inventory what's actually left

Don't trust this document's description of the gap — it was written before Phase 9 shipped anything. Instead:

- Re-read `dashboard/index.html`'s remaining inline `<script>` content end to end.
- Grep it for the concrete violation patterns of Constitution Principle VIII (`.specify/memory/constitution.md`,
  "ES Modules & Modern JavaScript" — no `require()`/`module.exports`, `import`/`export` exclusively):
  - Top-level `function` declarations that aren't inside a `<script type="module">`.
  - Any remaining `someGlobal = async function(...)`-style reassignment (Phase 9's `poll-dispatcher.mjs`
    fixed the polling one specifically — check whether the *pattern* recurred anywhere else).
  - Inline `onclick="..."`/`onchange="..."` HTML attributes wiring to global functions (a related, but
    distinct, violation worth explicitly deciding in- or out-of-scope — Principle VIII is about module syntax,
    not event wiring style, so this needs its own call, not an assumption).
- Cross-reference the result against `specs/009-dashboard-modernization/plan.md`'s Project Structure section
  to see what it already claimed to port, and scope this phase to the actual delta, not the original list.

## 2. Draft `spec.md` for real

Same spec-kit convention as every other phase here (`.specify/memory/constitution.md` Principle X):
`spec.md` → `plan.md` → `tasks.md`. A few things specific to this phase's shape:

- This is a maintainer-facing refactor, not an end-user feature — frame the User Scenarios accordingly (e.g.
  "a developer adding a new dashboard feature can do so entirely as a new `.mjs` module registered via
  `registerPanel()`, without touching or extending the legacy inline script — because by the end of this
  phase it no longer exists").
- Reuse and extend `tests/dashboard-source-quality.test.mjs` (created in Phase 9) as the mechanical
  success-criteria checker for this phase too — add assertions for whatever concrete patterns step 1's
  inventory turns up, and let red-green on those assertions drive `tasks.md`, per Constitution Principle IV.
- Follow 008/009's lighter three-file doc convention (`spec.md`/`plan.md`/`tasks.md`) unless this phase turns
  out to need a real `data-model.md` or API contract doc, which is unlikely for a pure refactor.

## 3. Sanity-check the phase number

Confirm `specs/010-...` is still the next free number before drafting — other phases may have been created
between now and then. Renumber the folder first if not.
