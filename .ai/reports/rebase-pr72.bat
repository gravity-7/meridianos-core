@echo off
cd /d C:\projects\meridianos-core

echo === Fetching latest main ===
git fetch origin main

echo === Current branch ===
git branch --show-current

echo === Rebasing onto origin/main ===
git rebase origin/main

if %ERRORLEVEL% neq 0 (
    echo === REBASE CONFLICT - resolving by keeping main's versions ===
    echo Files in conflict:
    git diff --name-only --diff-filter=U
    
    echo For files that main already has, accept main's version:
    for /f "delims=" %%f in ('git diff --name-only --diff-filter=U') do (
        echo Checking %%f...
    )
    
    echo === Strategy: accept main for already-merged backend files ===
    echo If you see conflicts in: providers.mjs, model-registry.mjs, provider-conformance.mjs,
    echo provider-wizard.mjs, model-discovery.mjs, gateway/model-discovery-adapters/*,
    echo gateway/known-providers.json, providers.defaults.yaml, schema/provider.schema.json,
    echo gateway/ledger-schema.sql, pricing-refresh.mjs, pricing.mjs, init.mjs,
    echo policy-validate.mjs, model-fallback.mjs,
    echo then accept main's version (git checkout --theirs)
    
    echo.
    echo === Aborting rebase for manual resolution ===
    echo Please resolve manually. The genuinely new files to keep are:
    echo   gateway/cli.mjs, dashboard/index.html, dashboard/server.mjs,
    echo   model-router.mjs, scheduler.mjs, gateway/server.mjs,
    echo   tests/model-*.test.mjs, tests/provider-*.test.mjs
    echo   specs/003-provider-model-agnosticism/tasks.md
    git rebase --abort
) else (
    echo === Rebase successful ===
    echo === New commits on top of main ===
    git log --oneline origin/main..HEAD
)
