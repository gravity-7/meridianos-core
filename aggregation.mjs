/**
 * aggregation — P5: AI Spend Observability hourly/daily aggregation engine.
 *
 * Materializes raw token_events into analytics_hourly and analytics_daily summary tables
 * for fast dashboard queries. All operations are idempotent (INSERT OR REPLACE).
 *
 * Exports: aggregateHour, aggregateDay, getLastAggregatedHour, getLastAggregatedDay,
 *          aggregatePendingWindows
 */

/**
 * Aggregate one hour of token_events into analytics_hourly.
 * Groups by (provider, model, agent, task). Skips corrupted events (NULL cost, negative tokens)
 * with a console.warn. Idempotent via INSERT OR REPLACE.
 *
 * @param {DatabaseSync} db - Open ledger database
 * @param {string} hourTs - ISO-8601 hour boundary (e.g. "2026-07-30T14:00:00.000Z")
 * @returns {number} Number of rows inserted/replaced
 */
export function aggregateHour(db, hourTs) {
  const hourEnd = new Date(new Date(hourTs).getTime() + 3600000).toISOString();

  // Find raw events in this hour window, grouped by dimensions
  const rows = db.prepare(
    `SELECT provider, model, agent, task,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
            COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            COUNT(*) AS api_calls
       FROM token_events
      WHERE ts >= ? AND ts < ?
        AND cost_usd IS NOT NULL
        AND total_tokens >= 0
      GROUP BY provider, model, agent, COALESCE(task, '__null__')`,
  ).all(hourTs, hourEnd);

  let count = 0;
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT OR REPLACE INTO analytics_hourly
       (window_key, hour_ts, provider, model, agent, task, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, api_calls, aggregated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Check for skipped corrupted events and log them
  const corrupted = db.prepare(
    `SELECT COUNT(*) AS c FROM token_events
      WHERE ts >= ? AND ts < ?
        AND (cost_usd IS NULL OR total_tokens < 0)`,
  ).get(hourTs, hourEnd);

  if (corrupted && corrupted.c > 0) {
    console.warn(`Aggregation: skipping ${corrupted.c} corrupted event(s) in hour ${hourTs} (NULL cost or negative tokens)`);
  }

  // Wrap all INSERTs in a transaction to avoid N+1 auto-commit overhead
  // and prevent SQLITE_BUSY contention with live gateway traffic.
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const task = r.task === '__null__' ? null : r.task;
      const windowKey = `${hourTs}:${r.provider}:${r.model}:${r.agent}:${task ?? 'null'}`;

      insert.run(
        windowKey, hourTs, r.provider, r.model, r.agent, task,
        r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens,
        r.total_tokens, r.cost_usd, r.api_calls, now,
      );
      count++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return count;
}

/**
 * Roll up analytics_hourly rows for a given day into analytics_daily.
 * Idempotent via INSERT OR REPLACE.
 *
 * @param {DatabaseSync} db
 * @param {string} dayTs - ISO-8601 date (e.g. "2026-07-30") or full ISO string (date part used)
 * @returns {number} Number of rows inserted/replaced
 */
export function aggregateDay(db, dayTs) {
  // Normalize to date-only
  const day = dayTs.slice(0, 10); // "2026-07-30"
  const dayStart = `${day}T00:00:00.000Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 86400000).toISOString();

  const rows = db.prepare(
    `SELECT provider, model, agent, task,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cache_read_tokens) AS cache_read_tokens,
            SUM(cache_write_tokens) AS cache_write_tokens,
            SUM(total_tokens) AS total_tokens,
            SUM(cost_usd) AS cost_usd,
            SUM(api_calls) AS api_calls
       FROM analytics_hourly
      WHERE hour_ts >= ? AND hour_ts < ?
      GROUP BY provider, model, agent, task`,
  ).all(dayStart, dayEnd);

  let count = 0;
  const now = new Date().toISOString();

  const insert = db.prepare(
    `INSERT OR REPLACE INTO analytics_daily
       (window_key, day_ts, provider, model, agent, task, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, total_tokens, cost_usd, api_calls, aggregated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Wrap in transaction to avoid N+1 auto-commit overhead
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const windowKey = `${day}:${r.provider}:${r.model}:${r.agent}:${r.task ?? 'null'}`;

      insert.run(
        windowKey, day, r.provider, r.model, r.agent, r.task,
        r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens,
        r.total_tokens, r.cost_usd, r.api_calls, now,
      );
      count++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return count;
}

/**
 * Get the most recent aggregated hour timestamp.
 * @param {DatabaseSync} db
 * @returns {string|null} ISO-8601 hour boundary or null if no aggregations exist
 */
export function getLastAggregatedHour(db) {
  const r = db.prepare('SELECT MAX(hour_ts) AS m FROM analytics_hourly').get();
  return r?.m ?? null;
}

/**
 * Get the most recent aggregated day timestamp.
 * @param {DatabaseSync} db
 * @returns {string|null} ISO-8601 date string or null if no aggregations exist
 */
export function getLastAggregatedDay(db) {
  const r = db.prepare('SELECT MAX(day_ts) AS m FROM analytics_daily').get();
  return r?.m ?? null;
}

/**
 * Find and aggregate all pending hourly windows, then check if any full days
 * are now complete and aggregate those too. Handles resume-after-interrupt.
 *
 * @param {DatabaseSync} db
 * @returns {{ hourly: number, daily: number }} Counts of windows aggregated
 */
export function aggregatePendingWindows(db) {
  let hourlyCount = 0;
  let dailyCount = 0;

  // Find the earliest unaggregated event
  const lastHour = getLastAggregatedHour(db);

  // Always re-aggregate the most recent previously-aggregated hour to catch
  // late-arriving events that landed after the last aggregation window closed.
  // INSERT OR REPLACE makes this safely idempotent.
  if (lastHour) {
    aggregateHour(db, lastHour);
  }

  const startFrom = lastHour
    ? new Date(new Date(lastHour).getTime() + 3600000).toISOString()
    : null;

  // Find all distinct hours in token_events that aren't yet in analytics_hourly
  const hours = db.prepare(
    `SELECT DISTINCT substr(ts, 1, 13) || ':00:00.000Z' AS hour_ts
       FROM token_events
      WHERE cost_usd IS NOT NULL AND total_tokens >= 0
        ${startFrom ? 'AND ts >= ?' : ''}
      ORDER BY hour_ts`,
  ).all(...(startFrom ? [startFrom] : []));

  for (const h of hours) {
    const count = aggregateHour(db, h.hour_ts);
    hourlyCount += count;
  }

  // Now check for complete days to roll up
  if (hours.length > 0) {
    const lastDay = getLastAggregatedDay(db);
    const startDay = lastDay
      ? new Date(new Date(lastDay).getTime() + 86400000).toISOString().slice(0, 10)
      : null;

    // Find distinct days from analytics_hourly that aren't yet in analytics_daily
    const days = db.prepare(
      `SELECT DISTINCT substr(hour_ts, 1, 10) AS day_ts
         FROM analytics_hourly
        ${startDay ? 'WHERE hour_ts >= ?' : ''}
        ORDER BY day_ts`,
    ).all(...(startDay ? [startDay] : []));

    for (const d of days) {
      const count = aggregateDay(db, d.day_ts);
      dailyCount += count;
    }
  }

  return { hourly: hourlyCount, daily: dailyCount };
}
