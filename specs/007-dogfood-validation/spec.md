# Feature: Dogfood Validation — Math Adventure Game

**Priority**: P1 — Validation Gate
**Depends on**: P5 (005-ai-spend-observability), P6 (006-multi-tenant-platform)
**Runs after**: Phase 6 completion

## Summary

Validate every MeridianOS subsystem end-to-end by having agents build a real browser-based math adventure game for kids ages 11-12. The project serves as a live dogfood test — every LLM API call flows through the gateway, metered and attributed, with analytics visible on the dashboard.

## What We're Building

A single-file HTML game (no frameworks, no build tools) where a space explorer solves arithmetic, fraction, and logic puzzles to travel through planets.

Spec already written at: `c:\projects\mos-dogfood\.ai\features\math-adventure-game.md`

## What We're Validating

| Subsystem | Validation | Success Criterion |
|-----------|-----------|-------------------|
| Gateway metering | Agent API calls appear in ledger | `token_events` rows > 0 with correct provider/model |
| Analytics dashboard | KPI cards, charts render with real data | Dashboard loads in <2s with spend/token counts |
| Aggregation engine | Hourly/daily summaries populate | `analytics_hourly` rows match raw event totals |
| Task attribution | Each call attributed to a task | `queryTaskCost(taskId)` returns non-zero cost |
| Budget forecast | Projected spend calculates correctly | Dashboard shows on-track/at-risk/over-budget |
| Spend pause | Emergency pause blocks agent traffic | 503 response within <1s of activation |
| Alert dispatch | Test alert fires to configured channels | Slack/email/webhook receives test message |
| Optimization | Recommendations generate after 7+ days | Active recommendations appear in dashboard |
| CSV export | Export downloads complete dataset | Downloaded CSV matches on-screen values |

## Acceptance Criteria

1. Builder agent produces a working `index.html` game from the spec
2. Reviewer agent verifies the output against acceptance criteria
3. Gateway ledger records every API call with correct attribution
4. Analytics dashboard shows spend, tokens, provider breakdown
5. Budget forecast computes correctly against $50 monthly cap
6. Spend pause blocks agent traffic and persists across daemon restart
7. All P5 test suite passes (64 tests, 0 failures)
