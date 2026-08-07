/**
 * subscriptions — 010 Frontend ES Module Migration, US6. AI provider subscription plans (Claude
 * Pro/GitHub Copilot/etc.) and the Add Subscription modal — 009's plan.md sketched this module as
 * `subscriptions-panel.mjs` but never actually created it (T034's execution notes show only the
 * card's UI copy changed, in place, in dashboard/index.html). Named `subscriptions.mjs` here,
 * deliberately not `-panel.mjs`: that suffix denotes a registerPanel()-registered workspace-grid
 * panel in this codebase, and this isn't one — it stays part of the fixed legacy-board layout.
 */
import { esc, formatSpend } from './dashboard-utils.mjs';
import { reportError } from './client-error-log.mjs';
import { registerPollHandler } from './poll-dispatcher.mjs';

export async function fetchSubscriptions() {
  try {
    const r = await fetch('/api/subscriptions');
    const j = await r.json();

    // Render subscription plans
    const subEl = document.getElementById('subscriptionsList');
    if (j.subscriptions && j.subscriptions.length) {
      subEl.innerHTML = j.subscriptions.map(s => `
        <div class="row" style="align-items:center">
          <div style="flex:1">
            <span style="font-weight:500">${esc(s.planName)}</span>
            <span class="badge b-ok">Active</span>
            <span style="font-size:12px;color:var(--text-muted);margin-left:8px">$${s.monthlyCostUsd}/mo · env: ${esc(s.tokenEnv || '—')}</span>
            ${s.lastVerified ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px">Last verified: ${esc(s.lastVerified)}</span>` : ''}
          </div>
          <button onclick="reportBrokenSub('${esc(s.providerName)}')" style="font-size:10px;padding:3px 6px" title="Report broken token extraction">Report broken</button>
        </div>
      `).join('');
    } else {
      subEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:.4rem 0">No subscription plans configured.</div>';
    }

    // Combined total
    document.getElementById('combinedTotal').textContent = 'Combined monthly: ' + formatSpend(j.combinedMonthlyTotal || 0);
  } catch (e) {
    reportError('fetchSubscriptions', e, { panelEl: document.getElementById('subscriptionsList') });
  }
}

export function reportBrokenSub(providerName) {
  const url = 'https://github.com/gravity-7/meridianos-core/issues/new?title=Subscription%20token%20extraction%20broken:%20' + encodeURIComponent(providerName) + '&labels=bug,docs';
  window.open(url, '_blank');
}
window.reportBrokenSub = reportBrokenSub;

// ─── P4: Add Subscription Modal ─────────────────────────────────────────────

document.getElementById('addSubscriptionBtn').addEventListener('click', () => {
  document.getElementById('addSubModal').style.display = 'flex';
  document.getElementById('subKeyEnv').value = '';
  document.getElementById('subLegalCheck').checked = false;
  document.getElementById('subSaveError').style.display = 'none';
});

document.getElementById('subCancelBtn').addEventListener('click', () => {
  document.getElementById('addSubModal').style.display = 'none';
});

document.getElementById('subSaveBtn').addEventListener('click', async () => {
  const planType = document.getElementById('subPlanType').value;
  const keyEnv = document.getElementById('subKeyEnv').value.trim();
  const legalAccepted = document.getElementById('subLegalCheck').checked;
  const errEl = document.getElementById('subSaveError');

  if (!keyEnv) { errEl.textContent = 'Environment variable name is required.'; errEl.style.display = 'block'; return; }
  if (!legalAccepted) { errEl.textContent = 'You must accept the legal disclaimer before saving.'; errEl.style.display = 'block'; return; }

  const planCosts = { 'Claude Pro': 20, 'GitHub Copilot': 10, 'Anti-Gravity': 0 };
  errEl.style.display = 'none';

  try {
    const r = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providerName: 'subscription-' + planType.toLowerCase().replace(/\s+/g, '-'),
        planName: planType,
        keyEnv,
        monthlyCostUsd: planCosts[planType] || 0,
        wire: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        legalAccepted: true,
      }),
    });
    const j = await r.json();
    if (j.ok) {
      document.getElementById('addSubModal').style.display = 'none';
      fetchSubscriptions();
    } else {
      errEl.textContent = j.error || 'Save failed.';
      errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = 'Save failed: ' + e.message;
    errEl.style.display = 'block';
  }
});

registerPollHandler(fetchSubscriptions);
