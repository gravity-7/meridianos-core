# Client Demo Package Contract

## Supported Routes

| Workflow | Presenter route | Status | Prohibited interpretation |
|---|---|---|---|
| Onboarding | `/setup` on the visible onboarding launcher's printed loopback URL | Existing supported baseline | `/app/setup` is redirect-only and is not a delivered destination. |
| Client operations | `/` on the future local `cloud/cloud-server.mjs` fixture's printed loopback URL | Existing cloud server behavior, future deterministic launcher | `/cloud/dashboard/index.html` is only mapped by the browser-test static server and is not a live presenter route. |

## Future Launcher Contract

The implementation will expose a local-only command:

```text
node scripts/run-visible-client-demo.mjs --port <free-loopback-port>
```

It must:

1. Refuse invalid/non-loopback port values.
2. Create a temporary synthetic cloud fixture with no inherited credentials or persistent data.
3. Print the exact local root URL and a `synthetic, disposable` notice.
4. Launch a headed browser to that root URL.
5. Provide only the fixture's fictional sign-in and policy example through the presenter runbook; never print or request provider keys.
6. On normal close, interruption, or error, write redacted safe evidence, close the browser/server/database, and remove temporary state.
7. Never open `/cloud/dashboard/index.html`, call a non-loopback service, or create visual/recording assets.

## Deterministic Synthetic Dataset Contract

- A fixed fictional organization and fixture-only administrator account are created for each run.
- The client view contains a small fixed machine set and aggregate health display values, seeded through supported local control-plane behavior.
- The policy example uses an allowlisted non-sensitive path and JSON value.
- Values must not look like customer data, provider credentials, payment records, email-delivery data, or external responses.
- The fixture must reject inherited provider-related environment values and non-loopback endpoint inputs.

## Checkpoint Contract

| ID | Workflow | Required visible condition | Presenter action |
|---|---|---|---|
| `onboarding-start` | onboarding | `/setup` welcome and synthetic/disposable identity | Introduce the local-only boundary. |
| `onboarding-review` | onboarding | Review appears before any final write | Pause and explain explicit commit. |
| `onboarding-cleanup` | onboarding | Launcher shutdown result | Confirm disposable temporary root removal. |
| `client-login` | client operations | Local root sign-in screen | State that the account is fixture-only. |
| `client-health` | client operations | Connected machines and aggregate health visible | Explain local synthetic operating visibility. |
| `client-preview` | client operations | Eligible-target preview says no policy has been pushed | Pause and explain preview. |
| `client-confirmation` | client operations | Explicit confirmation boundary and rollback wording visible | Stop by default; optional fixture-only confirmation must be announced. |
| `client-cleanup` | client operations | Launcher shutdown result | Confirm temporary data removal. |

## Evidence and Capture Contract

- Runtime evidence format: redacted JSON/text `manifest`, `result`, and optional `triage` only, retained under an ignored demo artifact path such as `artifacts/qa/client-demo/<run-id>/`.
- Capture brief format: version-controlled Markdown; it names planned screenshots or recording segments but creates none.
- Capture output format (optional later human work): approved image/video plus adjacent manifest with `shotId`, run ID, local-synthetic classification, viewport, redaction result, capture owner, reviewer, and approval date.
- A redaction failure requires immediate discard of the capture/evidence directory and a clean rerun. Raw bodies, browser profiles, keys, customer data, and unsupported claims must never be retained.

## Recovery Contract

- Port conflict: choose a free loopback port and use the launcher's printed URL.
- Browser/process interruption: mark the run abandoned, perform teardown, and start a new session.
- Fixture/data/preview failure: show the safe failure state, remove the fixture, and restart. Do not repair or reuse it manually.
- Missing headed browser or recording capability: report the prerequisite as unavailable; do not claim visual, platform, accessibility, performance, canary, or release approval.
