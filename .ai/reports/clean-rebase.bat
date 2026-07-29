@echo off
setlocal enabledelayedexpansion
cd /d C:\projects\meridianos-core

echo === Step 1: Fetch latest main ===
git fetch origin main
if %ERRORLEVEL% neq 0 (echo FETCH FAILED & exit /b 1)

echo === Step 2: Create clean branch from main ===
git checkout -b 003-provider-model-agnosticism-rebased origin/main
if %ERRORLEVEL% neq 0 (echo CHECKOUT FAILED & exit /b 1)

echo === Step 3: Cherry-pick only new files from old branch ===

REM List of files unique to our implementation (NOT in PR #70)
set FILES=^
 gateway/cli.mjs^
 dashboard/index.html^
 dashboard/server.mjs^
 model-router.mjs^
 scheduler.mjs^
 gateway/server.mjs^
 tests/model-discovery.test.mjs^
 tests/model-registry.test.mjs^
 tests/model-router-fallback.test.mjs^
 tests/provider-conformance.test.mjs^
 tests/provider-wizard.test.mjs^
 specs/003-provider-model-agnosticism/tasks.md^
 specs/003-provider-model-agnosticism/checklists/requirements.md^
 scripts/dispatch-review.mjs

REM Fetch each file from the old branch
for %%f in (%FILES%) do (
    echo Checking out %%f from old branch...
    git checkout 003-provider-model-agnosticism -- %%f 2>nul
    if !ERRORLEVEL! equ 0 (
        git add %%f
        echo   OK: %%f
    ) else (
        echo   SKIP (not in old branch): %%f
    )
)

echo.
echo === Step 4: Commit ===
git commit -m "feat(003): rebase - CLI, dashboard, router, scheduler, tests

Rebased onto current main to remove overlap with PR #70.
Genuinely new work kept:
- CLI subcommands (provider/models/pricing)
- Dashboard Providers/Models tabs + API endpoints
- Weighted/fallback routing in model-router.mjs
- Circuit breaker integration in gateway/server.mjs
- Scheduler ticks for discovery + pricing
- 5 new test files
- Dispatch script fixes
- Updated tasks.md"

echo.
echo === Step 5: Force-push to PR branch ===
echo Run: git push origin 003-provider-model-agnosticism-rebased:003-provider-model-agnosticism --force
echo.
echo === DONE ===
echo Check: git diff origin/main --stat
