/**
 * poll-dispatcher — stable registration point for "run this every poll tick" behavior (009 —
 * Dashboard Modernization, US3/FR-008). Replaces the `poll = async function(){...}` global
 * reassignment chain that was stacked three layers deep in the legacy board and was the direct
 * mechanism behind two of the four bugs found during the pre-Phase-9 audit: a stale closure
 * capturing an early, unwrapped `poll` reference (so some registrations never actually ran), and a
 * silent exception partway through one tick aborting every render call queued after it — with
 * nothing in the console to point at why. Every feature that needs to run on each tick registers
 * once via `registerPollHandler()`; each handler's failure is isolated and reported, never allowed
 * to stop its siblings from running (mirrors the panel-isolation contract, FR-005).
 */
import { reportError } from './client-error-log.mjs';

/** @type {Array<() => (void | Promise<void>)>} */
const handlers = [];

/**
 * Register a function to run on every poll tick. Registration order is preserved (handlers run in
 * the order they were registered) but is NOT a dependency guarantee — a handler must not assume
 * another handler has already run this same tick.
 * @param {() => (void | Promise<void>)} fn
 */
export function registerPollHandler(fn) {
  handlers.push(fn);
}

/**
 * Run every registered handler once, in registration order. A handler that throws (synchronously or
 * via a rejected promise) is caught and reported individually through `client-error-log.mjs` — it
 * never stops, delays past its own execution, or hides the failure of any other handler.
 * @returns {Promise<void>}
 */
export async function runPollHandlers() {
  for (const fn of handlers) {
    try {
      await fn();
    } catch (err) {
      reportError('poll-dispatcher', err);
    }
  }
}
