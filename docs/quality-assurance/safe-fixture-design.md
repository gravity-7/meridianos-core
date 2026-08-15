# Safe fixture design

## Non-negotiable default

Every normal automated or agent-driven run is **deterministic, synthetic, and
loopback-only**. It may exercise MeridianOS's real domain logic and gateway
metering path, but it must not contact a real model provider, payment processor,
mail service, identity provider, webhook destination, or customer system.

Use generated names such as `qa-admin-<run-id>@example.test`, generated project
IDs, and a non-secret sentinel such as `QA_SENTINEL_<run-id>`. A sentinel is a
leak detector, not a credential. It must be scanned for in browser storage,
URLs/history, response bodies, screenshots, console output, diagnostics, and
evidence bundles.

## Fixture lifecycle

Every fixture manifest has one of: `creating`, `running`, `cleaning`, `cleaned`,
or `cleanup-failed`. It records the owner, deadline, temporary root, process IDs,
generated IDs, tested commit, fixture revision, and cleanup result—never secrets.

1. Create a per-run temporary root and `creating` manifest with a deadline.
2. Write only generated policy/configuration state beneath that root.
3. Start one isolated dashboard server process on an ephemeral local port, then
   mark the manifest `running`.
4. Route simulated AI traffic through the test gateway and local mock provider.
5. Run the named journey; keep browser workers serialized where shared
   control-plane singleton stores cannot yet be injected or reset.
6. In an always-run teardown, mark `cleaning`, close server/database handles,
   kill fixture-owned processes, scan evidence, and delete the temporary root.
7. Mark `cleaned`, or `cleanup-failed` with owner/escalation information. A
   scheduled TTL sweep removes expired `cleanup-failed` roots and records the
   sweep result before a worker may be reused.

Do not reuse repository `.ai/` runtime state, a developer browser profile, a
real local keychain, or a shared control-plane database. Fixture manifests
record generated identities and IDs but never secret values.

## Reusable profiles

| Profile | Synthetic state | Dependencies | Reset |
| --- | --- | --- | --- |
| `fresh_solo` | Empty temporary root | loopback provider | Remove root after close |
| `solo_byok` | Generated policy, task, usage and ledger | test gateway + mock provider | Recreate manifest |
| `organization_roles` | Two projects; admin/operator/viewer users | local mail capture + deterministic runner | New DB and users |
| `provider_failure` | Configured generated provider route | controlled mock responses | Restart mock + policy |
| `billing_entitlement` | Free/entitled ledger states | in-memory signed event handler | Recreate ledger/events |
| `desktop_first_run` | Fake app data, daemon, keychain | local daemon + loopback provider | Fresh app-data root |

## Controlled dependencies

Each dependency relevant to a P1 journey must support the following named,
observable behaviors. `authorization-denied` is not interchangeable with
`validation-error`: the former represents a permitted request rejected by the
dependency, while the latter represents locally invalid input before a request.

| Dependency | Success | Validation error | Authorization denied | Timeout | Unavailable |
| --- | --- | --- | --- | --- | --- |
| Provider/model | fixed completion | malformed local config | synthetic 401 | delayed mock response | synthetic 503/malformed stream |
| Payment | local entitlement event | invalid signed payload | synthetic event authorization denial | delayed local event | unavailable local handler |
| Mail/invitation | local capture | malformed address | generated role denial | delayed capture | delivery failure |
| Webhook | accepted receiver | malformed signed event | denied receiver | delayed receiver | retryable receiver failure |
| Subscription | configured synthetic session | acknowledgement missing | generated policy denial | delayed local route | unavailable local route |
| Browser/desktop system | ready state | invalid local configuration | generated permission denial | delayed daemon/service | stopped daemon/service |

Existing local foundations include `test/mock-provider.mjs` for OpenAI/Anthropic
shapes and failure modes, cassette replay for intentionally recorded provider
responses, local webhook receivers, and in-memory signed billing-event tests.
Live Ollama, DeepSeek, Stripe test mode, or any other external service belongs
only in a separately approved canary lane.

## Enforced network boundary and safety checks

All simulated AI traffic still travels through the gateway so metering,
budget-enforcement, routing, and redaction behavior are genuinely exercised.
All future fixture servers must wrap dependency traffic with
[`assertLoopbackEndpoint`](../../tests/fixtures/persona-network-guard.mjs): it
parses the URL, rejects credentials/userinfo, and permits only exact `localhost`,
`127.0.0.1`, or `[::1]` hosts. The wrapper records every attempted request and
the fixture fails if the external-call count is non-zero. This guard is now
unit-tested; wiring it into the persona fixture server is the first browser
automation increment, and remains a release blocker until that fixture exists.

The fixture must reject a key that resembles a production credential. Test-only
provider resolution must be explicit; do not borrow developer environment
variables.

Before evidence leaves the run:

- scan output for the fixture sentinel and secret-like patterns;
- exclude cookies, authorization headers, API keys, session storage, and raw
  request bodies from reviewed artifacts;
- confirm external-call count is zero for a deterministic run;
- confirm the run used a unique root, users, project IDs, and clock/ledger seed.

## Live-canary boundary

A live canary is manual or scheduled—not PR-default—and needs a completed
[approval record](templates/live-canary-approval.md). The owner states exact
account, spend, data, duration, rollback, and stop condition first. Use a
dedicated test account, never a prospect/customer account, and publish only a
redacted outcome summary. A failed or skipped canary does not silently turn into
a simulated pass.
