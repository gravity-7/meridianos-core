# Legacy Dashboard Parity Inventory

This inventory is the migration source of truth for Spec 017. `verified` requires focused tests and local Founder visual review; `retained` remains available at `/legacy` by design.

| Legacy capability | Legacy surface | New destination | Status | Evidence / notes |
|---|---|---|---|---|
| Global refresh and live status | Header refresh/clock/kill status | Root toolbar and realtime state | verified | `browser-tests/operational-overview.spec.mjs` refresh/scope journey; root keeps kill mutation out of the board. |
| Team workspace | Team button/workspace | Administration/workflows routes | retained | Migrate only supported member/task evidence; keep legacy fallback until verified. |
| Admin workspace | Admin button/workspace | Administration, Integrations, Governance | verified | Existing administration/integration/governance route modules and `browser-tests/ui-platform.spec.mjs`. |
| Settings & observability workspace | Settings button | Root board plus Gateway/Cost/Usage | verified | Root board composition plus operational route registry; `tests/operational-dashboard.test.mjs`. |
| Spend KPI cards | Analytics section | Root stat/meter panels and Cost | verified | Root Cost used and Budget consumed circled meters; canonical gateway ledger source. |
| Spend time series | Analytics chart panels | Root Cost graph and Cost route | verified | Root Cost over time chart includes equivalent table; finance browser journey. |
| Provider/model/agent breakdown | Analytics/provider spend | Cost/Usage ranking panels | verified | Cost/Usage dimension links and table evidence in `browser-tests/operational-overview.spec.mjs`. |
| Budget spend/forecast | Budget intelligence | Root circled cost/budget meter and Governance | verified | Root budget meter/table labels fixed monthly period; Governance route retained. |
| Budget emergency pause | Budget controls | Governance/billing safe action | retained | Existing mutation remains separate and authorized. |
| Alerts history and test alert | Alerts section | Alerts route and root attention/list panel | verified | Alert lifecycle/evidence journeys; root Open alerts panel preserves safe mutations. |
| Optimization recommendations | Optimization section | Governance/cost follow-up | retained | Retain until separate parity evidence exists. |
| Provider spend grid | Provider spend section | Cost provider dimension and root driver panel | verified | Cost provider dimension table and root Budget signals panel use ledger totals. |
| Budget/agent/work controls | Control cards | Governance/Administration | retained | Existing legacy controls remain rollback surface. |
| Task categories | Task category card | Tasks route summary | verified | Tasks route and root queued/blocked work stats preserve scope. |
| System log | System log card | Runs/activity evidence | verified | Runs evidence and root Recent activity list; semantic tables preserve redaction. |
| Quick commands | Quick command card | Operations action surfaces | retained | Do not broaden mutation authority. |
| IDE/MCP/integration panels | Integration panels | Integrations routes | verified | Existing Integrations route modules remain linked from the new rail; provider/key safety tests retained. |
| Subscription/API-key panels | Subscription workspace | Integrations/Governance | retained | Requires separate credential/product review. |
| Legacy theme toggle | Header theme button | System/Light/Dark shell control | verified | `tests/dashboard-theme.test.mjs` and visual-reference browser theme cycle. |
| Legacy dashboard full fallback | `/index.html` | `/legacy` and `/index.html` | retained | Immediate rollback/reference route. |

All `verified` entries have focused test references above and local Chrome evidence recorded in `quickstart.md`; retained entries remain explicit rollback or scope boundaries.
