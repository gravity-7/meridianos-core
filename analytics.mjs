/**
 * analytics — P5: AI Spend Observability query engine.
 *
 * Provides aggregated read-only analytics over the gateway ledger. All functions take an
 * openLedger() DatabaseSync instance and return never-throw-into-caller contracts (empty/null
 * results on error). Queries prefer analytics_hourly/analytics_daily materialized tables for
 * speed, falling back to raw token_events for pre-aggregation windows.
 *
 * Exports: queryOverview, queryTimeseries, queryBreakdown, queryTaskCost, queryProjectCosts,
 *          computeBudgetForecast, detectAnomalies.
 */

/**
 * Auto-select time-series resolution based on date range span.
 *   ≤ 24 hours    → 'hourly'
 *   ≤ 7 days      → '4_hourly' (binned every 4 hours)
 *   ≤ 30 days     → 'daily'
 *   > 30 days     → 'weekly'
 */
function autoResolution(from, to) {
  const spanMs = new Date(to).getTime() - new Date(from).getTime();
  const spanDays = spanMs / (1000 * 60 * 60 * 24);
  if (spanDays <= 1) return 'hourly';
  if (spanDays <= 7) return '4_hourly';
  if (spanDays <= 30) return 'daily';
  return 'weekly';
}

/**
 * Choose the best source table for a query window. If from is >= the oldest analytics_daily row,
 * prefer daily; else if from is >= oldest analytics_hourly row, prefer hourly; else fall back
 * to raw token_events.
 */
function bestSourceTable(db, from) {
  const oldestDaily = db.prepare('SELECT MIN(day_ts) AS m FROM analytics_daily').get()?.m;
  if (oldestDaily && from >= oldestDaily) return 'analytics_daily';
  const oldestHourly = db.prepare('SELECT MIN(hour_ts) AS m FROM analytics_hourly').get()?.m;
  if (oldestHourly && from >= oldestHourly) return 'analytics_hourly';
  return 'token_events';
}

// ─── KPI Overview ───────────────────────────────────────────────────────────

/**
 * queryOverview(db, from, to) → KPI aggregates for the dashboard overview.
 * Returns { totalSpend, spendChangePct, totalTokens, totalApiCalls,
 *           topProvider, topModel, topAgent, period }.
 * Falls back to empty state when no data exists.
 */
export function queryOverview(db, from, to) {
  try {
    const now = new Date().toISOString();
    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to || now;

    // Total spend + tokens + calls for the period
    const table = bestSourceTable(db, fromDate);
    let totalSpend, totalTokens, totalApiCalls;

    if (table === 'analytics_daily') {
      const r = db.prepare(
        'SELECT COALESCE(SUM(cost_usd), 0) AS spend, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(api_calls), 0) AS calls FROM analytics_daily WHERE day_ts >= ? AND day_ts < ?',
      ).get(fromDate, toDate);
      totalSpend = r.spend;
      totalTokens = r.tokens;
      totalApiCalls = r.calls;
    } else if (table === 'analytics_hourly') {
      const r = db.prepare(
        'SELECT COALESCE(SUM(cost_usd), 0) AS spend, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(api_calls), 0) AS calls FROM analytics_hourly WHERE hour_ts >= ? AND hour_ts < ?',
      ).get(fromDate, toDate);
      totalSpend = r.spend;
      totalTokens = r.tokens;
      totalApiCalls = r.calls;
    } else {
      const r = db.prepare(
        'SELECT COALESCE(SUM(cost_usd), 0) AS spend, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS calls FROM token_events WHERE ts >= ? AND ts < ?',
      ).get(fromDate, toDate);
      totalSpend = r.spend;
      totalTokens = r.tokens;
      totalApiCalls = r.calls;
    }

    // Previous period for % change
    const spanMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
    const prevFrom = new Date(new Date(fromDate).getTime() - spanMs).toISOString();
    let prevSpend = 0;
    try {
      const pr = db.prepare(
        'SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM token_events WHERE ts >= ? AND ts < ?',
      ).get(prevFrom, fromDate);
      prevSpend = pr?.spend ?? 0;
    } catch { /* empty previous period */ }

    const spendChangePct = prevSpend > 0
      ? Math.round(((totalSpend - prevSpend) / prevSpend) * 1000) / 10
      : null;

    // Helper: fetch top item by dimension
    const topBy = (dim) => {
      try {
        const src = table === 'analytics_daily' ? 'analytics_daily' : (table === 'analytics_hourly' ? 'analytics_hourly' : 'token_events');
        const tsCol = src === 'analytics_daily' ? 'day_ts' : (src === 'analytics_hourly' ? 'hour_ts' : 'ts');
        const r = db.prepare(
          `SELECT ${dim}, COALESCE(SUM(cost_usd), 0) AS cost FROM ${src} WHERE ${tsCol} >= ? AND ${tsCol} < ? GROUP BY ${dim} ORDER BY cost DESC LIMIT 1`,
        ).get(fromDate, toDate);
        if (r && r.cost > 0 && totalSpend > 0) {
          return { name: r[dim], cost: r.cost, pct: Math.round((r.cost / totalSpend) * 1000) / 10 };
        }
      } catch { /* fall through */ }
      return null;
    };
    const topProvider = topBy('provider');
    const topModel = topBy('model');
    const topAgent = topBy('agent');

    return {
      totalSpend,
      spendChangePct,
      totalTokens,
      totalApiCalls,
      topProvider,
      topModel,
      topAgent,
      period: { from: fromDate, to: toDate },
    };
  } catch {
    return {
      totalSpend: 0,
      spendChangePct: null,
      totalTokens: 0,
      totalApiCalls: 0,
      topProvider: null,
      topModel: null,
      topAgent: null,
      period: { from: from || new Date(Date.now() - 30 * 86400000).toISOString(), to: to || new Date().toISOString() },
    };
  }
}

// ─── Time-Series ────────────────────────────────────────────────────────────

/**
 * queryTimeseries(db, from, to, groupBy) → time-series data for charts.
 * Auto-selects resolution based on date range span.
 * groupBy: 'provider' | 'model' | 'agent' | 'task'
 */
export function queryTimeseries(db, from, to, groupBy = 'provider') {
  try {
    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to || new Date().toISOString();
    const resolution = autoResolution(fromDate, toDate);

    const dim = ['provider', 'model', 'agent', 'task'].includes(groupBy) ? groupBy : 'provider';
    const table = resolution === 'hourly' ? 'analytics_hourly' : 'analytics_daily';
    const tsCol = table === 'analytics_daily' ? 'day_ts' : 'hour_ts';

    let rows;
    try {
      // Try from materialized tables first
      rows = db.prepare(
        `SELECT ${tsCol} AS ts, ${dim} AS label, SUM(cost_usd) AS cost, SUM(total_tokens) AS tokens
           FROM ${table} WHERE ${tsCol} >= ? AND ${tsCol} < ?
           GROUP BY ${tsCol}, ${dim} ORDER BY ${tsCol}`,
      ).all(fromDate, toDate);
    } catch {
      // Fall back to raw events
      rows = db.prepare(
        `SELECT substr(ts, 1, ${resolution === 'daily' ? '10' : '13'}) AS ts, ${dim === 'task' ? 'COALESCE(task, "unattributed")' : dim} AS label,
                COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens
           FROM token_events WHERE ts >= ? AND ts < ?
           GROUP BY ts, label ORDER BY ts`,
      ).all(fromDate, toDate);
    }

    // If no materialized data and resolution needs weekly binning, do it in JS
    if (resolution === 'weekly' && rows.length > 0 && table === 'analytics_daily') {
      // Group daily into weekly buckets
      const weekBuckets = new Map();
      for (const r of rows) {
        const d = new Date(r.ts);
        const weekStart = new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);
        const key = `${weekStart}:${r.label}`;
        const existing = weekBuckets.get(key);
        if (existing) {
          existing.cost += r.cost;
          existing.tokens += r.tokens;
        } else {
          weekBuckets.set(key, { ts: weekStart + 'T00:00:00.000Z', label: r.label, cost: r.cost, tokens: r.tokens });
        }
      }
      rows = [...weekBuckets.values()];
    }

    // Handle 4_hourly resolution by binning hourly into 4-hour buckets
    if (resolution === '4_hourly' && rows.length > 0) {
      const buckets = new Map();
      for (const r of rows) {
        const d = new Date(r.ts);
        const hourBlock = Math.floor(d.getUTCHours() / 4) * 4;
        const blockTs = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourBlock)).toISOString();
        const key = `${blockTs}:${r.label}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.cost += r.cost;
          existing.tokens += r.tokens;
        } else {
          buckets.set(key, { ts: blockTs, label: r.label, cost: r.cost, tokens: r.tokens });
        }
      }
      rows = [...buckets.values()];
    }

    // Group into series by label
    const seriesMap = new Map();
    for (const r of rows) {
      const label = r.label || 'unknown';
      if (!seriesMap.has(label)) seriesMap.set(label, []);
      seriesMap.get(label).push({ ts: r.ts, cost: Math.round(r.cost * 10000) / 10000, tokens: r.tokens });
    }

    const series = [];
    for (const [label, data] of seriesMap) {
      data.sort((a, b) => a.ts.localeCompare(b.ts));
      series.push({ label, data });
    }

    return { resolution, series, period: { from: fromDate, to: toDate } };
  } catch {
    return { resolution: 'daily', series: [], period: { from: from || '', to: to || '' } };
  }
}

// ─── Breakdown ──────────────────────────────────────────────────────────────

/**
 * queryBreakdown(db, dimension, from, to, limit) → ranked breakdown by dimension.
 * dimension: 'provider' | 'model' | 'agent' | 'task' | 'label'
 */
export function queryBreakdown(db, dimension, from, to, limit = 10) {
  try {
    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString();
    const toDate = to || new Date().toISOString();
    const dim = ['provider', 'model', 'agent', 'task', 'label'].includes(dimension) ? dimension : 'provider';

    const table = bestSourceTable(db, fromDate);

    let dimCol = dim;
    if (dim === 'label') {
      // For label breakdown, extract cost labels from the raw events JSON
      dimCol = "COALESCE(json_extract(raw, '$.costLabel'), json_extract(raw, '$.cost_label'), 'unlabeled')";
    }

    const tsCol = table === 'analytics_daily' ? 'day_ts' : (table === 'analytics_hourly' ? 'hour_ts' : 'ts');

    let rows;
    if (table === 'analytics_daily' || table === 'analytics_hourly') {
      // Materialized tables may not have label dimension — only attempt for standard dims
      if (dim === 'label') {
        // Fall back to raw events for label dimension
        rows = db.prepare(
          `SELECT ${dimCol} AS key, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS apiCalls
             FROM token_events WHERE ts >= ? AND ts < ? GROUP BY key ORDER BY cost DESC LIMIT ${Number(limit)}`,
        ).all(fromDate, toDate);
      } else {
        rows = db.prepare(
          `SELECT ${dimCol} AS key, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(api_calls), 0) AS apiCalls
             FROM ${table} WHERE ${tsCol} >= ? AND ${tsCol} < ? GROUP BY key ORDER BY cost DESC LIMIT ${Number(limit)}`,
        ).all(fromDate, toDate);
      }
    } else {
      rows = db.prepare(
        `SELECT ${dimCol} AS key, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS apiCalls
           FROM ${table} WHERE ${tsCol} >= ? AND ${tsCol} < ? GROUP BY key ORDER BY cost DESC LIMIT ${Number(limit)}`,
      ).all(fromDate, toDate);
    }

    // Compute total for percentages
    let totalCost = 0;
    for (const r of rows) totalCost += r.cost;

    const items = rows.map((r) => ({
      key: r.key || 'unknown',
      cost: r.cost,
      tokens: r.tokens,
      apiCalls: r.apiCalls,
      pct: totalCost > 0 ? Math.round((r.cost / totalCost) * 1000) / 10 : 0,
    }));

    return { dimension: dim, items, totalCost, period: { from: fromDate, to: toDate } };
  } catch {
    return { dimension: dimension || 'provider', items: [], totalCost: 0, period: { from: from || '', to: to || '' } };
  }
}

// ─── Task Cost ──────────────────────────────────────────────────────────────

/**
 * queryTaskCost(db, taskId, includeRuns) → per-task cost attribution.
 */
export function queryTaskCost(db, taskId, includeRuns = false) {
  try {
    if (!taskId) return { taskId: null, totalCost: 0, totalTokens: 0, apiCalls: 0, models: [], runs: [] };

    const rows = db.prepare(
      'SELECT model, cost_usd, total_tokens, run_id, ts, latency_ms, upstream_status, raw FROM token_events WHERE task = ? ORDER BY ts',
    ).all(taskId);

    if (rows.length === 0) {
      return { taskId, totalCost: 0, totalTokens: 0, apiCalls: 0, models: [], runs: [] };
    }

    let totalCost = 0;
    let totalTokens = 0;
    const modelSet = new Set();
    const runs = new Map();

    for (const r of rows) {
      if (r.cost_usd != null) totalCost += r.cost_usd;
      if (r.total_tokens != null) totalTokens += r.total_tokens;
      if (r.model) modelSet.add(r.model);

      const runId = r.run_id || 'unknown';
      if (!runs.has(runId)) {
        runs.set(runId, { runId, cost: 0, tokens: 0, apiCalls: 0, durationMs: r.latency_ms || 0, status: r.upstream_status ? 'completed' : 'unknown', firstTs: r.ts, lastTs: r.ts });
      }
      const run = runs.get(runId);
      if (r.cost_usd != null) run.cost += r.cost_usd;
      if (r.total_tokens != null) run.tokens += r.total_tokens;
      run.apiCalls++;
      if (r.latency_ms != null) run.durationMs += r.latency_ms;
      if (r.ts < run.firstTs) run.firstTs = r.ts;
      if (r.ts > run.lastTs) run.lastTs = r.ts;
    }

    const runList = [...runs.values()].map(r => ({
      runId: r.runId,
      cost: r.cost,
      tokens: r.tokens,
      apiCalls: r.apiCalls,
      durationMs: r.durationMs,
      status: r.status,
    }));

    return {
      taskId,
      totalCost,
      totalTokens,
      apiCalls: rows.length,
      models: [...modelSet],
      firstRunAt: rows[0]?.ts || null,
      lastRunAt: rows[rows.length - 1]?.ts || null,
      runs: includeRuns ? runList : [],
    };
  } catch {
    return { taskId: taskId || null, totalCost: 0, totalTokens: 0, apiCalls: 0, models: [], runs: [] };
  }
}

// ─── Project Costs ──────────────────────────────────────────────────────────

/**
 * queryProjectCosts(db, project, orderBy, limit) → ranked task costs for a project.
 * Filters by task IDs matching a project prefix (tasks stored as "project/task-id").
 */
export function queryProjectCosts(db, project, orderBy = 'cost', limit = 20) {
  try {
    if (!project) return { project: null, tasks: [], totalCost: 0 };

    const orderCol = orderBy === 'tokens' ? 'SUM(total_tokens)' : orderBy === 'calls' ? 'COUNT(*)' : 'SUM(cost_usd)';

    const rows = db.prepare(
      `SELECT task, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS apiCalls,
              COUNT(DISTINCT model) AS modelCount, MIN(ts) AS firstRun, MAX(ts) AS lastRun
         FROM token_events WHERE task LIKE ? GROUP BY task ORDER BY ${orderCol} DESC LIMIT ${Number(limit)}`,
    ).all(`${project}/%`);

    let totalCost = 0;
    const tasks = rows.map((r) => {
      totalCost += r.cost;
      return {
        taskId: r.task,
        cost: r.cost,
        tokens: r.tokens,
        apiCalls: r.apiCalls,
        modelCount: r.modelCount,
        firstRun: r.firstRun,
        lastRun: r.lastRun,
      };
    });

    return { project, tasks, totalCost };
  } catch {
    return { project: project || null, tasks: [], totalCost: 0 };
  }
}

// ─── Budget Forecast ────────────────────────────────────────────────────────

/**
 * computeBudgetForecast(db, budgetConfig) → budget status with linear projection.
 * budgetConfig: { monthlyLimit, startDate?, endDate? }
 * Uses 7-day trailing average for daily burn rate.
 */
export function computeBudgetForecast(db, budgetConfig) {
  try {
    const monthlyLimit = budgetConfig?.monthlyLimit ?? 0;
    if (monthlyLimit <= 0) {
      return { spendToDate: 0, projectedTotal: 0, dailyBurnRate: 0, daysRemaining: 0, status: 'no-budget', pctProjected: 0, pctUsed: 0 };
    }

    const now = new Date();
    const startDate = budgetConfig?.startDate
      ? new Date(budgetConfig.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = budgetConfig?.endDate
      ? new Date(budgetConfig.endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const startISO = startDate.toISOString();
    const nowISO = now.toISOString();
    const endISO = endDate.toISOString();

    // Spend to date
    const spendRow = db.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM token_events WHERE ts >= ? AND ts < ?',
    ).get(startISO, nowISO);
    const spendToDate = spendRow?.spend ?? 0;

    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));
    const daysElapsed = Math.min(totalDays, Math.max(1, Math.ceil((now.getTime() - startDate.getTime()) / 86400000)));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);

    // 7-day trailing burn rate
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const burnRow = db.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS spend FROM token_events WHERE ts >= ? AND ts < ?',
    ).get(sevenDaysAgo, nowISO);
    const trailingSpend = burnRow?.spend ?? 0;
    const dailyBurnRate = Math.round((trailingSpend / 7) * 10000) / 10000;

    const projectedTotal = spendToDate + dailyBurnRate * daysRemaining;
    const pctUsed = monthlyLimit > 0 ? Math.round((spendToDate / monthlyLimit) * 1000) / 10 : 0;
    const pctProjected = monthlyLimit > 0 ? Math.round((projectedTotal / monthlyLimit) * 1000) / 10 : 0;

    let status = 'on-track';
    if (pctProjected > 100) status = 'over-budget';
    else if (pctProjected >= 90) status = 'at-risk';

    return {
      spendToDate,
      projectedTotal,
      dailyBurnRate,
      daysElapsed,
      daysRemaining,
      status,
      pctUsed,
      pctProjected,
      budget: {
        amount: monthlyLimit,
        startDate: startISO,
        endDate: endISO,
      },
    };
  } catch {
    return { spendToDate: 0, projectedTotal: 0, dailyBurnRate: 0, daysRemaining: 0, status: 'error', pctProjected: 0, pctUsed: 0 };
  }
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────

/**
 * detectAnomalies(db, zScoreThreshold) → detect spending anomalies using z-score.
 * For each completed hour in the last 7 days, compute z-score against trailing mean/stddev.
 * Flag hours where z-score > zScoreThreshold (default 3.0).
 * @param {number} [zScoreThreshold=3.0] — hours with z-score above this are flagged
 */
export function detectAnomalies(db, zScoreThreshold = 3.0) {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const nowISO = now.toISOString();

    // Get hourly spend for the last 7 days
    const hourlyRows = db.prepare(
      `SELECT substr(ts, 1, 13) AS hour, provider, SUM(cost_usd) AS cost
         FROM token_events WHERE ts >= ? AND ts < ? AND cost_usd IS NOT NULL
         GROUP BY hour, provider ORDER BY hour`,
    ).all(sevenDaysAgo, nowISO);

    if (hourlyRows.length < 24) return []; // Need at least 24 hours of data

    // Compute mean and stddev per hour-of-day
    const hourBuckets = new Map(); // key: "HH:provider"
    for (const r of hourlyRows) {
      const hh = r.hour.slice(11, 13);
      const key = `${hh}:${r.provider}`;
      if (!hourBuckets.has(key)) hourBuckets.set(key, []);
      hourBuckets.get(key).push(r.cost);
    }

    // Build hourly normal ranges
    const normalRanges = new Map();
    for (const [key, costs] of hourBuckets) {
      if (costs.length < 2) continue;
      const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
      const variance = costs.reduce((s, c) => s + (c - mean) ** 2, 0) / costs.length;
      const stddev = Math.sqrt(variance);
      normalRanges.set(key, { mean, stddev, min: Math.max(0, mean - 2 * stddev), max: mean + 2 * stddev });
    }

    // Flag anomalies (z-score > 3.0)
    const anomalies = [];
    // Re-query to get hour boundaries for the most recent hours
    const recentHours = db.prepare(
      `SELECT substr(ts, 1, 13) || ':00:00.000Z' AS hourTs, provider, SUM(cost_usd) AS cost
         FROM token_events WHERE ts >= ? AND ts < ? AND cost_usd IS NOT NULL
         GROUP BY substr(ts, 1, 13), provider ORDER BY hourTs DESC LIMIT 168`,
    ).all(sevenDaysAgo, nowISO);

    for (const r of recentHours) {
      const hh = r.hourTs.slice(11, 13);
      const key = `${hh}:${r.provider}`;
      const range = normalRanges.get(key);
      if (!range || range.stddev === 0) continue;

      const zScore = (r.cost - range.mean) / range.stddev;
      if (zScore > zScoreThreshold) {
        anomalies.push({
          hourTs: r.hourTs,
          provider: r.provider,
          cost: Math.round(r.cost * 10000) / 10000,
          zScore: Math.round(zScore * 100) / 100,
          normalRange: [Math.round(range.min * 10000) / 10000, Math.round(range.max * 10000) / 10000],
        });
      }
    }

    return anomalies.slice(0, 20); // Top 20 recent anomalies
  } catch {
    return [];
  }
}
