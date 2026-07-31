/**
 * alerts — P5: AI Spend Observability alert evaluation engine.
 *
 * Checks configured alert rules against current analytics state and dispatches
 * notifications through configured channels (Slack, email, webhook).
 * Enforces per-rule cooldown to prevent spam.
 *
 * Exports: evaluateAlerts, dispatchAlert, checkCooldown
 */

import { sendEmail } from './smtp-mailer.mjs';

/**
 * Check if a rule is in cooldown. Reads alert_state table.
 * @param {DatabaseSync} db
 * @param {string} ruleId
 * @param {number} cooldownSecs
 * @returns {boolean} true if alert should be suppressed (in cooldown)
 */
export function checkCooldown(db, ruleId, cooldownSecs = 3600) {
  try {
    const row = db.prepare('SELECT last_fired_at FROM alert_state WHERE rule_id = ?').get(ruleId);
    if (!row || !row.last_fired_at) return false;

    const lastFired = new Date(row.last_fired_at).getTime();
    const now = Date.now();
    return (now - lastFired) < (cooldownSecs * 1000);
  } catch (e) {
    console.warn(`Alerts: checkCooldown failed for rule ${ruleId} — ${e.message}. Allowing alert (fail-open).`);
    return false;
  }
}

/**
 * Record an alert firing in alert_state table.
 */
function recordAlert(db, ruleId, value) {
  try {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT rule_id FROM alert_state WHERE rule_id = ?').get(ruleId);
    if (existing) {
      db.prepare(
        'UPDATE alert_state SET last_fired_at = ?, last_value = ?, fire_count = fire_count + 1, updated_at = ? WHERE rule_id = ?',
      ).run(now, value, now, ruleId);
    } else {
      db.prepare(
        'INSERT INTO alert_state (rule_id, last_fired_at, last_value, fire_count, updated_at) VALUES (?, ?, ?, 1, ?)',
      ).run(ruleId, now, value, now);
    }
  } catch (e) {
    console.warn(`Alerts: recordAlert failed for rule ${ruleId} — ${e.message}. Alert state not persisted.`);
  }
}

/**
 * Format an alert for Slack delivery.
 */
function formatAlertSlack(alert) {
  const emoji = { info: ':information_source:', warning: ':warning:', critical: ':rotating_light:' };
  const colorMap = { critical: '#ff0000', warning: '#ffa500', info: '#3498db' };

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji[alert.severity] || ''} ${alert.title}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${alert.message}\n\n*Spend:* $${(alert.spendToDate || 0).toFixed(2)} / $${(alert.budgetLimit || 0).toFixed(2)} (${alert.pctUsed || 0}%)`,
      },
    },
  ];

  if (alert.projectedTotal) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Projected:* $${alert.projectedTotal.toFixed(2)} — *Status:* ${alert.forecastStatus || 'unknown'}`,
      },
    });
  }

  return { blocks, text: alert.title };
}

/**
 * Format an alert for email delivery (MIME text + HTML).
 */
function formatAlertEmail(alert) {
  const severityColor = { critical: '#dc2626', warning: '#d97706', info: '#3b82f6' };
  const color = severityColor[alert.severity] || '#6b7280';

  const text = [
    `MeridianOS Alert: ${alert.title}`,
    `Severity: ${alert.severity.toUpperCase()}`,
    '',
    alert.message,
    '',
    `Spend: $${(alert.spendToDate || 0).toFixed(2)} / $${(alert.budgetLimit || 0).toFixed(2)} (${alert.pctUsed || 0}%)`,
    alert.projectedTotal ? `Projected: $${alert.projectedTotal.toFixed(2)}` : '',
    `Status: ${alert.forecastStatus || 'unknown'}`,
  ].filter(Boolean).join('\n');

  const html = `<div style="font-family:sans-serif;max-width:600px">
    <h2 style="color:${color}">${alert.title}</h2>
    <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
    <p>${alert.message}</p>
    <table style="border-collapse:collapse;width:100%">
      <tr><td>Spend</td><td><strong>$${(alert.spendToDate || 0).toFixed(2)}</strong> / $${(alert.budgetLimit || 0).toFixed(2)}</td></tr>
      <tr><td>Used</td><td><strong>${alert.pctUsed || 0}%</strong></td></tr>
      ${alert.projectedTotal ? `<tr><td>Projected</td><td><strong>$${alert.projectedTotal.toFixed(2)}</strong></td></tr>` : ''}
    </table>
    <p style="color:#6b7280;font-size:12px;margin-top:20px">Sent by MeridianOS AI Spend Observability</p>
  </div>`;

  return { text, html };
}

/**
 * Format an alert for generic webhook delivery (JSON).
 */
function formatAlertWebhook(alert) {
  return {
    source: 'meridianos-analytics',
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    spendToDate: alert.spendToDate,
    budgetLimit: alert.budgetLimit,
    pctUsed: alert.pctUsed,
    projectedTotal: alert.projectedTotal,
    forecastStatus: alert.forecastStatus,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Dispatch an alert to configured channels. Handles Slack, email, and webhook.
 *
 * @param {object} alert - { type, severity, title, message, spendToDate, budgetLimit, pctUsed, projectedTotal, forecastStatus }
 * @param {Array} channels - Channel configs from analytics config
 * @returns {Promise<Array>} Per-channel results [{channel, ok, error?}]
 */
export async function dispatchAlert(alert, channels = []) {
  const results = [];

  for (const ch of channels) {
    if (!ch.enabled) continue;
    // Severity filter: channel only receives alerts at or above its severity level
    const severityRank = { info: 0, warning: 1, critical: 2 };
    if (severityRank[alert.severity] < severityRank[ch.severity || 'warning']) continue;

    try {
      if (ch.type === 'slack' && ch.url) {
        const payload = formatAlertSlack(alert);
        const response = await fetch(ch.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        results.push({ channel: 'slack', ok: response.ok, status: response.status });
      } else if (ch.type === 'email' && ch.host) {
        const emailResult = await sendEmail({
          host: ch.host,
          port: ch.port || 587,
          user: ch.user,
          pass: ch.pass,
          from: ch.from,
          to: ch.to,
          subject: `[MeridianOS ${alert.severity.toUpperCase()}] ${alert.title}`,
          textBody: formatAlertEmail(alert).text,
          htmlBody: formatAlertEmail(alert).html,
        });
        results.push({ channel: 'email', ok: emailResult.ok, error: emailResult.error });
      } else if (ch.type === 'webhook' && ch.url) {
        const payload = formatAlertWebhook(alert);
        const response = await fetch(ch.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        results.push({ channel: 'webhook', ok: response.ok, status: response.status });
      }
    } catch (e) {
      results.push({ channel: ch.type || 'unknown', ok: false, error: e.message || String(e) });
    }
  }

  return results;
}

/**
 * Evaluate all configured alert rules against current analytics state.
 *
 * @param {DatabaseSync} db - Gateway ledger database
 * @param {object} config - Parsed analytics config (from resolveAnalyticsConfig)
 * @param {object} state - Current analytics state: { spendToDate, monthlyLimit, pctUsed, projectedTotal, forecastStatus, anomalies[] }
 * @returns {Promise<Array>} Array of fired alert descriptors
 */
export async function evaluateAlerts(db, analyticsConfig, state = {}) {
  const fired = [];
  const rules = analyticsConfig?.alerts?.rules ?? [];
  const channels = analyticsConfig?.alerts?.channels ?? [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;

    // Check cooldown
    if (checkCooldown(db, rule.id, rule.cooldownSeconds || 3600)) continue;

    let shouldFire = false;
    let alert = null;

    if (rule.type === 'budget_threshold') {
      const threshold = rule.thresholdPct || 80;
      if ((state.pctUsed || 0) >= threshold) {
        // Only fire if threshold was just crossed (alert fatigue prevention).
        // Read last_value from alert_state; if the previous alert was already
        // at or above this threshold, suppress re-firing.
        const prevRow = db.prepare('SELECT last_value FROM alert_state WHERE rule_id = ?').get(rule.id);
        const prevValue = prevRow?.last_value ?? 0;
        if (prevValue >= threshold) continue; // Still above threshold from last fire — skip

        shouldFire = true;
        alert = {
          type: 'budget_threshold',
          severity: rule.severity || 'warning',
          title: `Budget ${threshold}% threshold reached`,
          message: `AI spend has reached ${state.pctUsed}% of the $${state.monthlyLimit} monthly budget.`,
          spendToDate: state.spendToDate,
          budgetLimit: state.monthlyLimit,
          pctUsed: state.pctUsed,
          projectedTotal: state.projectedTotal,
          forecastStatus: state.forecastStatus,
        };
      }
    } else if (rule.type === 'anomaly') {
      const anomalies = state.anomalies || [];
      for (const a of anomalies) {
        if (a.zScore > (rule.thresholdPct || 3.0)) {
          shouldFire = true;
          alert = {
            type: 'anomaly',
            severity: rule.severity || 'warning',
            title: `Spending anomaly detected`,
            message: `Hourly spend spike: $${a.cost} on ${a.provider} (z-score: ${a.zScore}). Normal range: $${a.normalRange[0]}–$${a.normalRange[1]}.`,
          };
          break; // One anomaly alert per evaluation cycle
        }
      }
    } else if (rule.type === 'optimization_available') {
      // Check if there are active (unapplied, undismissed) recommendations
      try {
        const recs = db.prepare("SELECT COUNT(*) AS c FROM optimization_rules WHERE status = 'active'").get();
        if (recs && recs.c > 0) {
          shouldFire = true;
          alert = {
            type: 'optimization_available',
            severity: 'info',
            title: `${recs.c} cost optimization recommendation(s) available`,
            message: `${recs.c} model switch recommendation(s) are ready for review in the dashboard.`,
          };
        }
      } catch { /* table may not exist yet */ }
    }

    if (shouldFire && alert) {
      const results = await dispatchAlert(alert, channels);
      recordAlert(db, rule.id, state.pctUsed || 0);
      fired.push({ ruleId: rule.id, alert, results });
    }
  }

  return fired;
}
