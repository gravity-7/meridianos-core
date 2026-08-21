import { make, notice, page, formPanel, badge, iconLabel } from '../../shared/view-helpers.mjs';

function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => acc && acc[k], obj);
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtTokens(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

function resetIn(ts) {
  if (!ts) return '';
  const ms = Date.parse(ts) - Date.now();
  if (ms <= 0) return ' · resetting…';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return ' · resets in ' + (h ? `${h}h ` : '') + `${m}m`;
}

function updateQuietStrip(stripEl, enabled, fromTime, toTime) {
  if (!stripEl) return;
  const fromM = parseTimeToMinutes(fromTime);
  const toM = parseTimeToMinutes(toTime);
  const bars = stripEl.querySelectorAll('.qh-bar');

  bars.forEach((bar, idx) => {
    const barStart = idx * 60;
    const barEnd = (idx + 1) * 60;
    let isQuiet = false;
    if (enabled) {
      if (fromM <= toM) {
        isQuiet = barStart >= fromM && barEnd <= toM;
      } else {
        isQuiet = barStart >= fromM || barEnd <= toM;
      }
    }
    bar.classList.toggle('is-quiet', isQuiet);
  });
}

export async function renderRoute(context) {
  const view = page('Work & Scheduling', 'Configure agent concurrency, execution cadences, budget thresholds, and agent compute limits.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  let policy = {};
  let statusData = {};
  try {
    const [pRes, sRes] = await Promise.all([
      fetch('/api/policy').catch(() => null),
      fetch('/api/status').catch(() => null)
    ]);
    if (pRes && pRes.ok) policy = await pRes.json();
    if (sRes && sRes.ok) statusData = await sRes.json();
  } catch (err) {
    feedback.replaceChildren(notice('Failed to load active policy.', { error: true }));
  }

  const form = make('form', null, 'management-form scheduling-form');

  // ─── Section 1: Work & Scheduler Levers ──────────────────────────────────
  const workHeader = make('div', null, 'section-block-head');
  workHeader.append(make('h3', 'Autonomous Work & Scheduler Levers', 'section-block-title'));

  const grid = make('div', null, 'scheduling-grid');

  // 1. Max parallel runs
  const concGroup = make('div', null, 'lev-group');
  const concHead = make('div', null, 'lev-head');
  concHead.append(make('span', '⚡', 'lev-icon'), make('strong', 'Max Parallel Runs', 'lev-title'));
  const concDesc = make('p', 'Maximum number of concurrent agent execution runs.', 'lev-desc');
  const concInput = make('input', null, 'custom-range'); concInput.type = 'range'; concInput.min = '1'; concInput.max = '4'; concInput.step = '1';
  concInput.value = String(getPath(policy, 'work.max_parallel') ?? 2);
  const concOut = make('span', `${concInput.value} runs`, 'badge b-info lev-badge');
  concInput.addEventListener('input', () => { concOut.textContent = `${concInput.value} runs`; });
  concGroup.append(concHead, concDesc, concInput, concOut);

  // 2. WIP per agent
  const wipGroup = make('div', null, 'lev-group');
  const wipHead = make('div', null, 'lev-head');
  wipHead.append(make('span', '👥', 'lev-icon'), make('strong', 'WIP Per Agent', 'lev-title'));
  const wipDesc = make('p', 'Work-in-progress task lease limit assigned to each agent.', 'lev-desc');
  const wipInput = make('input', null, 'custom-range'); wipInput.type = 'range'; wipInput.min = '1'; wipInput.max = '3'; wipInput.step = '1';
  wipInput.value = String(getPath(policy, 'work.wip_per_agent') ?? 1);
  const wipOut = make('span', `${wipInput.value} task/agent`, 'badge b-info lev-badge');
  wipInput.addEventListener('input', () => { wipOut.textContent = `${wipInput.value} task/agent`; });
  wipGroup.append(wipHead, wipDesc, wipInput, wipOut);

  // 3. Priority Floor
  const prioGroup = make('div', null, 'lev-group');
  const prioHead = make('div', null, 'lev-head');
  prioHead.append(make('span', '🎯', 'lev-icon'), make('strong', 'Priority Floor (≤)', 'lev-title'));
  const prioDesc = make('p', 'Minimum priority threshold required for autonomous dispatch.', 'lev-desc');
  const prioSelect = make('select', null, 'lev-select');
  const prioOpts = [
    { val: '999', text: 'All tasks (P0–P3)' },
    { val: '2', text: 'P2 and above (P0, P1, P2)' },
    { val: '1', text: 'P1 and above (P0, P1)' },
    { val: '0', text: 'P0 only (Critical)' }
  ];
  const currentPrio = String(getPath(policy, 'work.priority_floor') ?? 999);
  for (const opt of prioOpts) {
    const o = make('option', opt.text); o.value = opt.val;
    if (opt.val === currentPrio) o.selected = true;
    prioSelect.append(o);
  }
  prioGroup.append(prioHead, prioDesc, prioSelect);

  // 4. Lease TTL
  const ttlGroup = make('div', null, 'lev-group');
  const ttlHead = make('div', null, 'lev-head');
  ttlHead.append(make('span', '⏱', 'lev-icon'), make('strong', 'Lease Timeout (TTL)', 'lev-title'));
  const ttlDesc = make('p', 'Heartbeat expiration threshold before task lease is reaped.', 'lev-desc');
  const ttlInput = make('input', null, 'custom-range'); ttlInput.type = 'range'; ttlInput.min = '10'; ttlInput.max = '120'; ttlInput.step = '5';
  ttlInput.value = String(getPath(policy, 'work.lease_ttl_min') ?? 30);
  const ttlOut = make('span', `${ttlInput.value} min`, 'badge b-info lev-badge');
  ttlInput.addEventListener('input', () => { ttlOut.textContent = `${ttlInput.value} min`; });
  ttlGroup.append(ttlHead, ttlDesc, ttlInput, ttlOut);

  // 5. Max runs / 5h
  const maxrunsGroup = make('div', null, 'lev-group');
  const maxrunsHead = make('div', null, 'lev-head');
  maxrunsHead.append(make('span', '📊', 'lev-icon'), make('strong', 'Max Runs / 5h Window', 'lev-title'));
  const maxrunsDesc = make('p', 'Rate-limiting window ceiling to prevent autonomous run churning.', 'lev-desc');
  const maxrunsInput = make('input', null, 'custom-range'); maxrunsInput.type = 'range'; maxrunsInput.min = '1'; maxrunsInput.max = '20'; maxrunsInput.step = '1';
  maxrunsInput.value = String(getPath(policy, 'work.max_runs_per_5h') ?? 5);
  const maxrunsOut = make('span', `${maxrunsInput.value} runs/5h`, 'badge b-info lev-badge');
  maxrunsInput.addEventListener('input', () => { maxrunsOut.textContent = `${maxrunsInput.value} runs/5h`; });
  maxrunsGroup.append(maxrunsHead, maxrunsDesc, maxrunsInput, maxrunsOut);

  // 6. Schedule cadence
  const schedGroup = make('div', null, 'lev-group');
  const schedHead = make('div', null, 'lev-head');
  schedHead.append(make('span', '🔄', 'lev-icon'), make('strong', 'Scheduler Cadence', 'lev-title'));
  const schedDesc = make('p', 'Autonomous tick evaluation frequency for queued tasks.', 'lev-desc');
  const schedSelect = make('select', null, 'lev-select');
  const schedOpts = [
    { val: 'every_15m', text: 'Every 15 min' },
    { val: 'every_30m', text: 'Every 30 min' },
    { val: 'every_45m', text: 'Every 45 min' },
    { val: 'hourly', text: 'Hourly' },
    { val: 'every_2h', text: 'Every 2 hours' },
    { val: 'every_3h', text: 'Every 3 hours' },
    { val: 'on_handoff', text: 'On handoff only' },
    { val: 'off', text: 'Off (manual only)' }
  ];
  const currentSched = String(getPath(policy, 'schedule.cadence') ?? 'every_30m');
  for (const opt of schedOpts) {
    const o = make('option', opt.text); o.value = opt.val;
    if (opt.val === currentSched) o.selected = true;
    schedSelect.append(o);
  }
  schedGroup.append(schedHead, schedDesc, schedSelect);

  grid.append(concGroup, wipGroup, prioGroup, ttlGroup, maxrunsGroup, schedGroup);

  // ─── Section 2: Global Budget & Token Limits ──────────────────────────────
  const budgetHeader = make('div', null, 'section-block-head');
  budgetHeader.append(make('h3', 'Global Budget & Token Limits', 'section-block-title'));

  const budgetGrid = make('div', null, 'scheduling-grid');

  // Warn threshold
  const warnGroup = make('div', null, 'lev-group');
  const warnHead = make('div', null, 'lev-head');
  warnHead.append(make('span', '⚠️', 'lev-icon'), make('strong', 'Warn Threshold', 'lev-title'));
  const warnDesc = make('p', 'Budget percentage consumption trigger for policy warning.', 'lev-desc');
  const warnInput = make('input', null, 'custom-range'); warnInput.type = 'range'; warnInput.min = '50'; warnInput.max = '95'; warnInput.step = '5';
  warnInput.value = String(getPath(policy, 'budget.warn_pct') ?? 80);
  const warnOut = make('span', `${warnInput.value}%`, 'badge b-warn lev-badge');
  warnInput.addEventListener('input', () => { warnOut.textContent = `${warnInput.value}%`; });
  warnGroup.append(warnHead, warnDesc, warnInput, warnOut);

  // Per-task cap
  const ptaskGroup = make('div', null, 'lev-group');
  const ptaskHead = make('div', null, 'lev-head');
  ptaskHead.append(make('span', '🛑', 'lev-icon'), make('strong', 'Per-Task Token Cap', 'lev-title'));
  const ptaskDesc = make('p', 'Maximum token consumption allowed for an individual task execution.', 'lev-desc');
  const ptaskInput = make('input', null, 'custom-range'); ptaskInput.type = 'range'; ptaskInput.min = '20000'; ptaskInput.max = '400000'; ptaskInput.step = '10000';
  ptaskInput.value = String(getPath(policy, 'budget.per_task_tokens') ?? 100000);
  const ptaskOut = make('span', `${fmtTokens(Number(ptaskInput.value))} tokens`, 'badge b-info lev-badge');
  ptaskInput.addEventListener('input', () => { ptaskOut.textContent = `${fmtTokens(Number(ptaskInput.value))} tokens`; });
  ptaskGroup.append(ptaskHead, ptaskDesc, ptaskInput, ptaskOut);

  // Auto-downgrade on warn
  const autoDownGroup = make('div', null, 'lev-group');
  const autoDownHead = make('div', null, 'lev-head');
  autoDownHead.append(make('span', '📉', 'lev-icon'), make('strong', 'Model Auto-Downgrade', 'lev-title'));
  const autoDownDesc = make('p', 'Automatically downgrade models to cheaper tiers when warn threshold is reached.', 'lev-desc');
  const autoDownLabel = make('label', null, 'checkbox-label');
  const autoDownCheck = make('input', null, 'custom-checkbox'); autoDownCheck.type = 'checkbox';
  autoDownCheck.checked = !!getPath(policy, 'budget.autodowngrade_on_warn');
  autoDownLabel.append(autoDownCheck, make('span', 'Downgrade model on warning', 'checkbox-text'));
  autoDownGroup.append(autoDownHead, autoDownDesc, autoDownLabel);

  // Usage attribution
  const attribGroup = make('div', null, 'lev-group');
  const attribHead = make('div', null, 'lev-head');
  attribHead.append(make('span', '🧮', 'lev-icon'), make('strong', 'Usage Attribution', 'lev-title'));
  const attribDesc = make('p', 'Define how token usage is counted toward budget caps.', 'lev-desc');
  const attribSelect = make('select', null, 'lev-select');
  const attribOpts = [
    { val: 'agent_only', text: 'Agent work only' },
    { val: 'total', text: 'Founder + Agent total' }
  ];
  const currentAttrib = String(getPath(policy, 'budget.attribution') ?? 'agent_only');
  for (const opt of attribOpts) {
    const o = make('option', opt.text); o.value = opt.val;
    if (opt.val === currentAttrib) o.selected = true;
    attribSelect.append(o);
  }
  attribGroup.append(attribHead, attribDesc, attribSelect);

  budgetGrid.append(warnGroup, ptaskGroup, autoDownGroup, attribGroup);

  // ─── Section 3: Per-Agent Compute Caps ────────────────────────────────────
  const agentHeader = make('div', null, 'section-block-head');
  agentHeader.append(make('h3', 'Per-Agent Compute & Token Budgets', 'section-block-title'));

  const agentGrid = make('div', null, 'agent-budget-grid');
  const agentControls = {};

  const roster = Object.keys(statusData.budget?.mayClaim || policy.agent_budget || { claude: {}, antigravity: {} });
  const resets = statusData.budget?.resets || {};

  for (const agent of roster) {
    const card = make('div', null, 'agent-budget-card');
    const head = make('div', null, 'agent-card-head');
    head.append(make('strong', agent.toUpperCase(), 'agent-name'), badge(statusData.models?.[agent] || 'Standard', 'info'));
    
    // Usage meters if available
    const agentUsage = statusData.budget?.[agent];
    const w5 = agentUsage?.last5h;
    const wk = agentUsage?.last7d;

    const metersWrap = make('div', null, 'agent-meters-wrap');
    
    // 5h meter
    const m5Wrap = make('div', null, 'meter-box');
    const m5Head = make('div', null, 'meter-head');
    m5Head.append(make('span', '5h Usage', 'meter-label'), make('span', `${w5?.pct ?? 0}%`, 'meter-val'));
    const bar5 = make('div', null, 'meter-bar-track');
    const fill5 = make('div', null, 'meter-bar-fill');
    fill5.style.width = `${Math.min(w5?.pct || 0, 100)}%`;
    bar5.append(fill5);
    const sub5 = make('div', `${fmtTokens(w5?.used || 0)} / ${fmtTokens(w5?.cap || 2000000)}${resetIn(resets[`${agent}_5h_at`])}`, 'meter-sub');
    m5Wrap.append(m5Head, bar5, sub5);

    // Week meter
    const mWWrap = make('div', null, 'meter-box');
    const mWHead = make('div', null, 'meter-head');
    mWHead.append(make('span', 'Weekly Usage', 'meter-label'), make('span', `${wk?.pct ?? 0}%`, 'meter-val'));
    const barW = make('div', null, 'meter-bar-track');
    const fillW = make('div', null, 'meter-bar-fill');
    fillW.style.width = `${Math.min(wk?.pct || 0, 100)}%`;
    barW.append(fillW);
    const subW = make('div', `${fmtTokens(wk?.used || 0)} / ${fmtTokens(wk?.cap || 15000000)}${resetIn(resets[`${agent}_week_at`])}`, 'meter-sub');
    mWWrap.append(mWHead, barW, subW);

    metersWrap.append(m5Wrap, mWWrap);

    // Slider controls for 5h and week caps
    const capControls = make('div', null, 'agent-cap-controls');

    const cap5Wrap = make('div', null, 'cap-control-row');
    const cap5Label = make('label', '5h Cap:');
    const cap5Input = make('input', null, 'custom-range'); cap5Input.type = 'range'; cap5Input.min = '500000'; cap5Input.max = '5000000'; cap5Input.step = '100000';
    cap5Input.value = String(getPath(policy, `agent_budget.${agent}.per_5h_tokens`) ?? 2000000);
    const cap5Out = make('span', fmtTokens(Number(cap5Input.value)), 'badge b-info lev-badge');
    cap5Input.addEventListener('input', () => { cap5Out.textContent = fmtTokens(Number(cap5Input.value)); });
    cap5Wrap.append(cap5Label, cap5Input, cap5Out);

    const capWWrap = make('div', null, 'cap-control-row');
    const capWLabel = make('label', 'Week Cap:');
    const capWInput = make('input', null, 'custom-range'); capWInput.type = 'range'; capWInput.min = '5000000'; capWInput.max = '30000000'; capWInput.step = '500000';
    capWInput.value = String(getPath(policy, `agent_budget.${agent}.per_week_tokens`) ?? 15000000);
    const capWOut = make('span', fmtTokens(Number(capWInput.value)), 'badge b-info lev-badge');
    capWInput.addEventListener('input', () => { capWOut.textContent = fmtTokens(Number(capWInput.value)); });
    capWWrap.append(capWLabel, capWInput, capWOut);

    capControls.append(cap5Wrap, capWWrap);
    card.append(head, metersWrap, capControls);
    agentGrid.append(card);

    agentControls[agent] = { cap5Input, capWInput };
  }

  // ─── Section 4: Quiet Hours Panel ─────────────────────────────────────────
  const qhSection = make('div', null, 'quiet-hours-section');
  const qhHeader = make('div', null, 'quiet-hours-header');
  
  const qhTitleWrap = make('div', null, 'qh-title-wrap');
  const qhTitle = make('strong', 'Quiet Hours Schedule', 'qh-main-title');
  const qhSubtitle = make('p', 'Automatically pause autonomous background runs during designated non-working hours.', 'qh-subtitle');
  qhTitleWrap.append(qhTitle, qhSubtitle);

  const qhToggleWrap = make('div', null, 'qh-toggle-wrap');
  const qhCheckbox = make('input', null, 'custom-toggle'); qhCheckbox.type = 'checkbox'; qhCheckbox.id = 'qh-enable';
  qhCheckbox.checked = !!getPath(policy, 'quiet_hours.enabled');
  const qhToggleLabel = make('label', 'Enable Quiet Hours', 'custom-toggle-label');
  qhToggleLabel.htmlFor = 'qh-enable';
  qhToggleWrap.append(qhCheckbox, qhToggleLabel);

  const qhInputs = make('div', null, 'quiet-hours-times');
  const fromWrap = make('div', null, 'time-input-wrap');
  fromWrap.append(make('span', 'From:', 'time-label'));
  const fromInput = make('input', null, 'time-picker'); fromInput.type = 'time'; fromInput.value = getPath(policy, 'quiet_hours.from') ?? '22:00';
  fromWrap.append(fromInput);

  const toWrap = make('div', null, 'time-input-wrap');
  toWrap.append(make('span', 'To:', 'time-label'));
  const toInput = make('input', null, 'time-picker'); toInput.type = 'time'; toInput.value = getPath(policy, 'quiet_hours.to') ?? '06:00';
  toWrap.append(toInput);

  qhInputs.append(fromWrap, toWrap);
  qhHeader.append(qhTitleWrap, qhToggleWrap, qhInputs);

  // 24h timeline strip
  const qhStripWrap = make('div', null, 'quiet-hours-strip-wrap');
  const qhStrip = make('div', null, 'quiet-hours-strip');
  for (let i = 0; i < 24; i++) {
    const bar = make('div', null, 'qh-bar');
    bar.title = `${String(i).padStart(2, '0')}:00`;
    qhStrip.append(bar);
  }
  const qhTimeLabels = make('div', null, 'quiet-hours-labels');
  qhTimeLabels.append(
    make('span', '00:00 (Midnight)'),
    make('span', '06:00'),
    make('span', '12:00 (Noon)'),
    make('span', '18:00'),
    make('span', '24:00')
  );
  qhStripWrap.append(qhStrip, qhTimeLabels);

  const refreshStrip = () => updateQuietStrip(qhStrip, qhCheckbox.checked, fromInput.value, toInput.value);
  qhCheckbox.addEventListener('change', refreshStrip);
  fromInput.addEventListener('input', refreshStrip);
  toInput.addEventListener('input', refreshStrip);
  refreshStrip();

  qhSection.append(qhHeader, qhStripWrap);

  // ─── Save Action Bar ──────────────────────────────────────────────────────
  const actionsBar = make('div', null, 'management-actions-bar');
  const saveBtn = make('button', 'Save Policy to policy.yaml', 'btn-primary'); saveBtn.type = 'submit';
  actionsBar.append(saveBtn);

  form.append(workHeader, grid, budgetHeader, budgetGrid, agentHeader, agentGrid, qhSection, actionsBar);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const payload = {
        'work.max_parallel': Number(concInput.value),
        'work.wip_per_agent': Number(wipInput.value),
        'work.priority_floor': Number(prioSelect.value),
        'work.lease_ttl_min': Number(ttlInput.value),
        'work.max_runs_per_5h': Number(maxrunsInput.value),
        'schedule.cadence': schedSelect.value,
        'budget.warn_pct': Number(warnInput.value),
        'budget.per_task_tokens': Number(ptaskInput.value),
        'budget.autodowngrade_on_warn': autoDownCheck.checked,
        'budget.attribution': attribSelect.value,
        'quiet_hours.enabled': qhCheckbox.checked,
        'quiet_hours.from': fromInput.value,
        'quiet_hours.to': toInput.value
      };

      for (const [agent, ctrls] of Object.entries(agentControls)) {
        payload[`agent_budget.${agent}.per_5h_tokens`] = Number(ctrls.cap5Input.value);
        payload[`agent_budget.${agent}.per_week_tokens`] = Number(ctrls.capWInput.value);
      }

      const res = await fetch('/api/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feedback.replaceChildren(notice('Work, scheduling, and budget limits saved successfully in .ai/policy.yaml.'));
    } catch (err) {
      feedback.replaceChildren(notice(`Save failed: ${err.message}`, { error: true }));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Policy to policy.yaml';
    }
  });

  const formCard = formPanel(document, {
    title: 'Work, Scheduling & Budget Policy',
    icon: 'clock',
    subtitle: 'Tune scheduler parameters, per-agent token limits, and automated quiet hours.'
  }, form);

  view.node.append(formCard, feedback);
  context.root.replaceChildren(view.node);
}
