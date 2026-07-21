/**
 * escalation-push — delivers escalations to the founder via webhook.
 *
 * Reads `escalation.webhook_url` from policy.yaml and POSTs a JSON payload whenever
 * new escalations appear. Deduplicates by escalation ID so the founder isn't spammed
 * with the same alert on every tick.
 *
 * Payload shape (Discord/Slack compatible):
 *   { content: "...", embeds: [...] }  (Discord)
 *   { text: "...", blocks: [...] }     (Slack)
 *
 * The module auto-detects the webhook type from the URL (discord.com → Discord format,
 * everything else → Slack-style). If neither is detected, sends a generic JSON body.
 */
import { readFileSync } from 'node:fs';
import { loadPolicy } from './budget.mjs';

// The webhook is a SECRET and must NEVER live in the git-tracked policy.yaml (postmortem P0 — a
// Slack URL was committed in plaintext). It is resolved at runtime, in priority order:
//   1. $AIOS_ESCALATION_WEBHOOK                      (env — preferred for deployment)
//   2. .ai/secrets/escalation-webhook               (gitignored file, one line)
//   3. policy.escalation.webhook_url ONLY if it is a real https URL (back-compat; discouraged)
// policy.yaml should carry an empty value or an `env:NAME` reference, not the secret itself.

/** `config` is the injected AiosConfig (REQUIRED) — its `secretFile` is where step 2 (gitignored
 *  secret file) is read from. */
export function resolveWebhookUrl(config, policy = loadPolicy(undefined, config)) {
  const fromEnv = process.env.AIOS_ESCALATION_WEBHOOK;
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv;
  try {
    const fromFile = readFileSync(config.secretFile, 'utf8').trim();
    if (/^https?:\/\//i.test(fromFile)) return fromFile;
  } catch { /* no secret file */ }
  const p = policy?.escalation?.webhook_url;
  if (typeof p === 'string') {
    const m = p.match(/^env:(.+)$/i);
    if (m) { const v = process.env[m[1].trim()]; return (v && /^https?:\/\//i.test(v)) ? v : null; }
    if (/^https?:\/\//i.test(p)) return p; // legacy inline URL — still honored, but discouraged
  }
  return null;
}

// Track which escalation IDs have already been pushed (in-memory; clears on restart)
const pushed = new Set();

/**
 * Format escalations for Discord webhook.
 */
function formatDiscord(escalations) {
  if (escalations.length === 0) return null;

  const colorMap = { critical: 0xff0000, warn: 0xffa500, info: 0x3498db };
  const embeds = escalations.slice(0, 10).map(esc => ({
    title: esc.title,
    description: esc.detail || '',
    color: colorMap[esc.severity] ?? 0x808080,
    fields: [
      ...(esc.task ? [{ name: 'Task', value: esc.task, inline: true }] : []),
      { name: 'Severity', value: esc.severity, inline: true },
      { name: 'Kind', value: esc.kind, inline: true },
    ],
    timestamp: esc.ts,
  }));

  return {
    content: `**AIOS Escalation** — ${escalations.length} item(s) need attention`,
    embeds,
  };
}

/**
 * Format escalations for Slack webhook (incoming webhook / blocks).
 */
function formatSlack(escalations) {
  if (escalations.length === 0) return null;

  const emojiMap = { critical: ':rotating_light:', warn: ':warning:', info: ':information_source:' };
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `AIOS Escalation — ${escalations.length} item(s)` } },
  ];

  for (const esc of escalations.slice(0, 10)) {
    const emoji = emojiMap[esc.severity] ?? ':grey_question:';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${esc.title}*\n${esc.detail || ''}${esc.task ? `\n_Task: ${esc.task}_` : ''}`,
      },
    });
  }

  return { blocks, text: `AIOS: ${escalations[0]?.title || 'escalation'}` };
}

/**
 * Format for a generic webhook (simple JSON).
 */
function formatGeneric(escalations) {
  return {
    source: 'aios',
    timestamp: new Date().toISOString(),
    escalations: escalations.map(e => ({
      id: e.id,
      severity: e.severity,
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      task: e.task ?? null,
    })),
  };
}

/**
 * Detect webhook type from URL and format accordingly.
 */
function formatPayload(escalations, url) {
  if (/discord\.com\/api\/webhooks/i.test(url)) return formatDiscord(escalations);
  if (/hooks\.slack\.com/i.test(url)) return formatSlack(escalations);
  return formatGeneric(escalations);
}

/**
 * Push new escalations to the configured webhook. Deduplicates — only sends
 * escalations not yet pushed in this session. Returns { sent, skipped, error? }.
 *
 * @param {Array} escalations - from collectEscalations()
 * @param {object} opts
 * @param {string} opts.webhookUrl - override the policy URL (for testing)
 * @param {object} opts.policy - parsed policy (or loaded from disk)
 */
export async function pushEscalations(escalations, { webhookUrl, policy, config } = {}) {
  policy = policy ?? loadPolicy(undefined, config);
  const url = webhookUrl ?? resolveWebhookUrl(config, policy);

  if (!url) return { sent: 0, skipped: escalations.length, error: 'no webhook configured (set AIOS_ESCALATION_WEBHOOK or .ai/secrets/escalation-webhook)' };

  // Filter to only new escalations
  const fresh = escalations.filter(e => !pushed.has(e.id));
  if (fresh.length === 0) return { sent: 0, skipped: escalations.length };

  const payload = formatPayload(fresh, url);
  if (!payload) return { sent: 0, skipped: escalations.length };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      for (const e of fresh) pushed.add(e.id);
      return { sent: fresh.length, skipped: escalations.length - fresh.length };
    }
    return { sent: 0, skipped: escalations.length, error: `HTTP ${res.status}` };
  } catch (e) {
    return { sent: 0, skipped: escalations.length, error: String(e?.message || e) };
  }
}

/** Clear the dedup set (e.g., on policy reload or after escalations are resolved). */
export function clearPushed() {
  pushed.clear();
}

/** Check how many escalations have been pushed this session. */
export function pushedCount() {
  return pushed.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// F007 — Slack Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve Slack configuration from env vars and policy.yaml.
 * Priority: $SLACK_WEBHOOK_URL (env) > policy.integrations.slack.webhook_url > null.
 * Returns `{ enabled, webhookUrl }` — `enabled` is true only when a valid URL exists
 * AND `integrations.slack.enabled` is not explicitly false.
 *
 * @param {object} config - the injected AiosConfig
 * @param {object} [policy] - parsed policy (or loaded from disk)
 * @returns {{ enabled: boolean, webhookUrl: string|null }}
 */
export function resolveSlackConfig(config, policy = loadPolicy(undefined, config)) {
  const slack = policy?.integrations?.slack ?? {};
  const fromEnv = process.env.SLACK_WEBHOOK_URL;
  const webhookUrl = (fromEnv && /^https?:\/\//i.test(fromEnv))
    ? fromEnv
    : ((typeof slack.webhook_url === 'string' && /^https?:\/\//i.test(slack.webhook_url))
      ? slack.webhook_url
      : null);
  const explicitlyDisabled = slack.enabled === false;
  return { enabled: !!webhookUrl && !explicitlyDisabled, webhookUrl };
}

/**
 * Send a Slack Block Kit message to a webhook URL.
 * Zero npm dependencies — uses Node built-in fetch().
 *
 * @param {string} webhookUrl - the Slack incoming webhook URL
 * @param {object} message - a Slack Block Kit payload ({ blocks: [...], text: "..." })
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function pushToSlack(webhookUrl, message) {
  if (!webhookUrl || !message) return { ok: false, error: 'missing webhook URL or message' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Format verifier failures as a Slack Block Kit message.
 *
 * @param {string} domain - the tenant/domain name (e.g. "mos-dev")
 * @param {Array<{ task: string, disposition: string, detail: string }>} failures - from verifyCycle results.failed
 * @returns {{ blocks: Array, text: string }}
 */
export function formatVerifierFailure(domain, failures) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ` MeridianOS — Verifier Failure (${failures.length})` },
    },
  ];

  for (const f of failures.slice(0, 10)) {
    const dispEmoji = f.disposition === 'blocked' ? '🔴' : f.disposition === 'bounced' ? '🟡' : '⚪';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${dispEmoji} *${f.task}*\n>Status: \`${f.disposition}\`\n>${f.detail || 'no detail'}`,
      },
    });
  }

  if (failures.length > 10) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `_...and ${failures.length - 10} more failure(s)_` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${domain} | ${ts}` }],
  });

  return { blocks, text: `MeridianOS: ${failures.length} verifier failure(s) in ${domain}` };
}

/**
 * Format a budget threshold alert as a Slack Block Kit message.
 * Fires when an agent's usage exceeds the warn threshold (>80% by default).
 *
 * @param {string} domain - the tenant/domain name (e.g. "mos-dev")
 * @param {string} agentName - the agent whose budget is in warning/halt state
 * @param {object} agentBudget - the budgetStatus()[agent] entry with { state, windows[], usage }
 * @returns {{ blocks: Array, text: string }} | null if state is 'ok'
 */
export function formatBudgetAlert(domain, agentName, agentBudget) {
  if (!agentBudget || agentBudget.state === 'ok') return null;

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const emoji = agentBudget.state === 'halt' ? '🔴' : '🟡';
  const label = agentBudget.state === 'halt' ? 'BUDGET HALT' : 'Budget Warning';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} MeridianOS — ${label}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Agent:* \`${agentName}\`  |  *State:* \`${agentBudget.state.toUpperCase()}\``,
      },
    },
  ];

  if (agentBudget.windows) {
    for (const w of agentBudget.windows) {
      const capText = w.cap != null ? `${w.cap.toLocaleString('en-US')}` : 'no cap';
      const usedText = w.used != null ? `${w.used.toLocaleString('en-US')}` : '—';
      const pctText = w.pct != null ? ` (${w.pct}%)` : '';
      const wEmoji = w.state === 'halt' ? '🔴' : w.state === 'warn' ? '🟡' : '🟢';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${wEmoji} *${w.window} window:* ${usedText} / ${capText} tokens${pctText}`,
        },
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${domain} | ${ts}` }],
  });

  return { blocks, text: `MeridianOS: ${agentName} budget ${agentBudget.state} in ${domain}` };
}

/**
 * Determine whether a given event type should be routed to Slack.
 * Checks that Slack is configured + enabled, and optionally filters by
 * `integrations.slack.events` whitelist in policy.yaml.
 *
 * @param {object} config - the injected AiosConfig
 * @param {'verifier_failure'|'budget_breach'|'escalation'} event - the event type
 * @param {object} [policy] - parsed policy (or loaded from disk)
 * @returns {{ route: boolean, webhookUrl: string|null }}
 */
export function routeToSlack(config, event, policy = loadPolicy(undefined, config)) {
  const slackCfg = resolveSlackConfig(config, policy);
  if (!slackCfg.enabled || !slackCfg.webhookUrl) return { route: false, webhookUrl: null };

  const allowedEvents = policy?.integrations?.slack?.events;
  // If no events whitelist is configured, route ALL event types
  if (!allowedEvents || !Array.isArray(allowedEvents) || allowedEvents.length === 0) {
    return { route: true, webhookUrl: slackCfg.webhookUrl };
  }

  return { route: allowedEvents.includes(event), webhookUrl: slackCfg.webhookUrl };
}
