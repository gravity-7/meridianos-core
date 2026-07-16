/**
 * project-store — the top-level D2 facade (ADR 0001): one object bundling a task's StateStore,
 * EventStore, DocStore, and a bound `render()`, so a caller that already has `{db, config}` gets
 * all four without re-deriving them. Pure composition — no new logic, no schema, no change to
 * render OUTPUT (it calls the SAME `render(db, meta, config)` render.mjs always has).
 */
import { createStateStore } from './state-store.mjs';
import { createEventStore } from './event-store.mjs';
import { createDocStore } from './doc-store.mjs';
import { render as renderProjections } from './render.mjs';

/** Build a ProjectStore over one `{db, config}` pair. */
export function createProjectStore({ db, config }) {
  return {
    state: createStateStore(db),
    events: createEventStore(db),
    docs: createDocStore(config),
    render: (meta = {}) => renderProjections(db, meta, config),
  };
}
