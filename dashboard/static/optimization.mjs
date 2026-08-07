/**
 * optimization — 010 Frontend ES Module Migration, US4. Cost-optimization suggestions
 * ("switch task_type from model X to cheaper model Y"). Fully self-contained, untouched and
 * unmentioned by 009 — already dispatcher-registered, so this is a mechanical port with zero
 * cross-story coupling.
 */
import { reportError } from './client-error-log.mjs';
import { registerPollHandler } from './poll-dispatcher.mjs';

export async function fetchOptimization() {
  try {
    const r = await fetch('/api/analytics/optimization/recommendations?status=active').then(r=>r.json());
    const recs = r.recommendations || [];
    document.getElementById('optSummary').textContent = '· '+recs.length+' active recommendation(s)';
    if (recs.length === 0) {
      document.getElementById('optList').innerHTML = '<span style="color:var(--text-muted)">No recommendations yet. Requires 7+ days of usage data.</span>';
      return;
    }
    let html = '';
    for (const rec of recs.slice(0, 5)) {
      html += `<div class="row" style="justify-content:space-between">
        <span><strong>${rec.task_type}</strong>: ${rec.current_model} → ${rec.recommended_model}</span>
        <span style="color:var(--text-success)">Save ~$${rec.estimated_weekly_savings}/wk</span>
        <span style="font-size:11px">confidence: ${Math.round((rec.confidence||0)*100)}%</span>
        <button onclick="applyOpt('${rec.id}')" style="font-size:11px;padding:2px 8px">Apply</button>
        <button onclick="dismissOpt('${rec.id}')" style="font-size:11px;padding:2px 8px">Dismiss</button>
      </div>`;
    }
    document.getElementById('optList').innerHTML = html;
  } catch (e) {
    reportError('fetchOptimization', e, { panelEl: document.getElementById('optList'), severity: 'info' });
  }
}

export async function applyOpt(id) {
  try {
    await fetch('/api/analytics/optimization/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aios-token': '__AIOS_TOKEN__' },
      body: JSON.stringify({ id }),
    });
    fetchOptimization();
  } catch(e) { alert('Failed: '+e.message); }
}
window.applyOpt = applyOpt;

export async function dismissOpt(id) {
  const reason = prompt('Reason for dismissal?') || '';
  try {
    await fetch('/api/analytics/optimization/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-aios-token': '__AIOS_TOKEN__' },
      body: JSON.stringify({ id, reason }),
    });
    fetchOptimization();
  } catch(e) { alert('Failed: '+e.message); }
}
window.dismissOpt = dismissOpt;

registerPollHandler(fetchOptimization);
