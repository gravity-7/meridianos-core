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
