# Implementation Plan: Dogfood Validation

**Branch**: `007-dogfood-validation` | **Depends on**: P5 ✅, P6
**Project**: `c:\projects\mos-dogfood`

## Trigger

This validation runs **after Phase 6 (Multi-Tenant Platform)** is complete and merged. P6 may add new dashboard features, billing integrations, or deployment options — we want to dogfood those too.

## Project Setup (already scaffolded)

```text
c:\projects\mos-dogfood\
├── .ai\
│   ├── policy.yaml              ← 2-agent roster, analytics config, $50 budget
│   └── features\
│       └── math-adventure-game.md  ← Game spec for ages 11-12
├── run.mjs                      ← Launcher: start({ domain })
├── node_modules\                ← @gravity-7/meridianos-core (latest)
└── .npmrc                       ← Empty
```

## Validation Steps

### Step 1: Update to latest
```powershell
cd c:\projects\mos-dogfood
npm install @gravity-7/meridianos-core@latest
```

### Step 2: Start daemon
```powershell
$env:DEEPSEEK_KEY = '<key>'
node run.mjs
```

### Step 3: Trigger agent run
The builder picks up `math-adventure-game.md` from the features directory. The reviewer verifies output.

### Step 4: Verify dashboard
Open `http://localhost:4317`:
- Analytics tab: KPIs populated, charts render
- Budget tab: forecast shows, pause button works
- Alerts tab: test alert sends successfully
- Optimization tab: recommendations appear (after 7 days)

### Step 5: Verify gateway
```powershell
# Check ledger
node -e "
const { openLedger } = require('@gravity-7/meridianos-core/gateway/ledger.mjs');
const db = openLedger(undefined, { config: { repoRoot: process.cwd() } });
const r = db.prepare('SELECT COUNT(*) as c FROM token_events').get();
console.log('Token events:', r.c);
db.close();
"
```

### Step 6: Run test suite
```powershell
cd c:\projects\meridianos-core
npm test  # Confirm 64+ tests pass, 0 failures
```

## Success Criteria

| # | Check | Expected |
|---|-------|----------|
| 1 | Game builds | `index.html` produced, runs in browser |
| 2 | Gateway metering | `token_events` rows with correct provider/model/task |
| 3 | Analytics KPIs | Dashboard shows non-zero spend, tokens, top provider |
| 4 | Aggregation | Hourly/daily summaries match raw event totals |
| 5 | Budget forecast | Projected total and burn rate displayed |
| 6 | Spend pause | 503 on agent requests when paused |
| 7 | Tests pass | 64+ pass, 0 fail |
