# Live-confirm PR #29 (non-retryable 403 budget deny) — minimal procedure

**Status of this note:** written from an OFFLINE isolated worktree (`l3/exit-confirm-harness`),
alongside `tests/exit-confirm-e2e.test.mjs` (a real `claude` CLI spawn against a real local
gateway instance, proving the exit behavior with **zero** network/money). This doc is the
_remaining_ gap: confirming the same behavior against a real DeepSeek call, as cheaply as
possible. Founder-gated (constitution §6 — spending money on paid APIs is a hard stop); do not
run this without explicit authorization.

**What the offline test already proved** (no live confirmation needed for these):
- A real `claude` CLI, `--bare`, pointed at a gateway instance returning the #29 403, exits
  **non-zero in well under a second** (observed: 935ms end-to-end including gateway startup;
  the spawn-to-exit portion was ~2.4s in the throwaway probe run) — not a 30s/90s/30min hang.
- The CLI's own stdout is: `Failed to authenticate. API Error: 403 gateway: over budget (5h)` —
  it correctly treats the 403 as fatal and does not retry.
- The gateway emits exactly one `enforcement_decision:'deny'` ledger row per denied call, with
  `upstream_status: null` (the dead-upstream trick proves the deny never dials out).
- `exit-classify.mjs` now recognizes this exact output as `reason: 'budget'` — distinct from
  `'nonzero'` (a real crash) and `'quota'` (a provider session-limit window, which self-clears —
  a budget halt does not).

**What only a LIVE call can prove** (the actual gap): that a REAL DeepSeek response, real TLS,
real latency, and the REAL `@deepseek`/anthropic-wire response framing produce the identical
403/`x-should-retry:false`/`permission_error` shape server.mjs promises, and that claude-code's
retry logic (built against the real Anthropic SDK, not our offline stub) treats it the same way
end to end, in the daemon's own process tree (not a hand-built harness invocation).

---

## 1. Policy keys to set

In `.ai/policy.yaml` (PV's tenant policy — **founder edits only**, per the constitution):

```yaml
gateway:
  enabled: true          # opt-in — see docs/GATEWAY.md "Running the gateway inside the daemon"
                          # port/tenant default to 0 (ephemeral)/'pv'; no need to set them

agent_budget:
  <agent>:                       # the SAME agent name the throwaway card will be assigned to
    per_5h_tokens: 50             # NOT 0 — see the footgun below
```

**Do NOT set `per_5h_tokens: 0`.** `gateway/windows.mjs` → `budget.mjs`'s `verdictFor` does
`if (!r.cap) return { state: 'no-cap' }` — a literal `0` is falsy, so it is treated as **no cap
at all**, not "deny everything". This is a real footgun a founder reaching for the intuitive
"set it to zero to force a deny" would hit silently (confirmed by a new offline unit test,
`gateway/tests/windows.test.mjs`, "a literal per_5h_tokens:0 cap is treated as NO CAP"). The
smallest cap that actually halts is **1**; `50` here gives a little headroom so the run doesn't
misfire on the very first turn due to whatever floor tokenization/system-prompt overhead the
live wire happens to have.

Restart the daemon after editing policy (`gateway.enabled` is read once at boot by
`maybeStartGateway` — see `docs/GATEWAY.md`).

## 2. The single throwaway card

Use (or create) a trivial `ZZ-`-prefixed, complexity-1, doc-only task on the board, assigned to
the SAME `<agent>` whose cap you just capped — e.g. "append one sentence to a scratch file". The
point is not the task content, it's forcing exactly one real agent invocation:

- **Turn 1** of the run is checked against the ledger's PRIOR usage for that agent/window, which
  is 0 for a cold cap — so turn 1 is always allowed (this is `windows.mjs`'s trip-wire design:
  "the call that crosses the line completes; the next call is denied" — see `docs/GATEWAY.md`
  "Enforcement semantics"). Turn 1 makes one small, real, billed DeepSeek call.
- **Turn 2+** (claude-code's next tool-use round-trip, or its next conversational turn) is
  checked against turn 1's now-recorded usage, which is already ≥ the 50-token cap → **denied**.

If the agent's real first turn happens to be small enough that the SECOND turn is also under the
cap, either lower the cap further (never to 0) or simply let the run continue — it will still
hit the cap within the first couple of turns for anything non-trivial (the CLI's own system
prompt + tool schemas alone are already far above 50 tokens).

## 3. Expected result

- The daemon's run-log entry for this task should show `outcome: failed`. If the exit-classify
  enhancement in this branch has been published/pulled by then, `reason: 'budget'`; on an
  unpublished core it will read `reason: 'nonzero'` with the note text containing "over budget"
  (still distinguishable by eye, just not by the typed field yet).
- The gateway's ledger (`.ai/gateway/ledger.db`, or query via
  `listEvents(openLedger(...), { tenant: 'pv', agent: '<agent>' })`) should show:
  - Some number of `enforcement_decision: 'allow'` rows (however many turns completed before the
    cap was crossed — expect 1, possibly 2).
  - **Exactly 1** row with `enforcement_decision: 'deny'`, `cap_window: '5h'`, as the LAST row
    for that run's session — the run must not retry past it.
- Wall-clock: the process should exit within roughly the time of its completed turns plus one
  more round-trip — nowhere near the 30-minute launcher kill. If it does NOT exit and instead
  sits retrying, that is the regression #29 exists to prevent and should be reported immediately,
  not worked around.
- Revert `agent_budget.<agent>.per_5h_tokens` (and `gateway.enabled` if it wasn't already on for
  other reasons) immediately after, and restart the daemon again — this cap is a deliberate
  self-inflicted throttle, not a real policy change.

## 4. Cost estimate — computed from `pricing.mjs`, not guessed

Using the REAL committed catalog (`tools/aios/pricing.json` in the PV tenant,
`deepseek-v4-flash`: `inputPerM: 0.14`, `outputPerM: 0.28` USD/1M tokens — the flash tier used for
`simple`/`medium`/`medium_high` complexity per the current model routing) through `costFor()`:

| Scenario (1st turn, before the deny) | inputTokens | outputTokens | cost (USD) |
|---|---:|---:|---:|
| small first turn   |  3,000 |   150 | $0.000462 |
| typical first turn |  8,000 |   300 | $0.001204 |
| heavy first turn   | 20,000 |   500 | $0.002940 |
| two heavy turns (if turn 2 also lands before the deny fires) | 40,000 | 1,000 | $0.005880 |

Even the "two heavy turns" upper bound is **~$0.006** — more than 8x under the $0.05 target. The
denying call itself costs **$0** (a 403 deny never forwards upstream — `upstream_status` stays
`null`, `cost_usd` stays `null`, confirmed both by the code path in `gateway/server.mjs` and by
this branch's offline test). Realistically expect **well under a cent** for the whole confirmation.

## 5. What to report back

1. The run-log `reason`/`note` for the throwaway task.
2. The ledger rows for that agent/session (allow count, then the one deny row).
3. Elapsed wall-clock from launch to process exit.
4. Whether the exit-classify `reason` read `'budget'` (once this branch is merged/published) or
   still `'nonzero'` (if run against an older core) — either is fine, just note which.

If any of the above diverges from §3's expectations — especially "the process kept running /
retrying" — stop and report that as the finding; do not re-run with a different cap trying to
make it match.
