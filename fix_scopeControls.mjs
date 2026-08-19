import fs from 'fs';
let mjs = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');

const startIndex = mjs.indexOf('function scopeControls() {');
const endIndex = mjs.indexOf('function refreshButton', startIndex);

const newScopeControls = `function scopeControls() {
  const form = make('form', null, 'scope-controls'); form.setAttribute('aria-label', 'Operational filters and time scope');
  const field = (labelText, name, value, type = 'text') => { const label = make('label', labelText); const input = make('input'); input.name = name; input.type = type; input.value = value ?? ''; label.append(input); return { label, input }; };
  
  const presetLabel = make('label', 'Time preset'); const preset = make('select'); preset.name = 'preset';
  for (const [value,label] of [['custom','Exact interval'],['1h','Last hour'],['24h','Last 24 hours'],['7d','Last 7 days'],['30d','Last 30 days']]) { const option = make('option', label); option.value = value; preset.append(option); }
  presetLabel.append(preset);
  const requestedPreset = new URL(location.href).searchParams.get('preset');
  preset.value = ['1h', '24h', '7d', '30d'].includes(requestedPreset) ? requestedPreset : 'custom';
  
  const project = field('Project', 'project', scope.project); project.input.placeholder = 'All projects';
  const provider = field('Provider', 'provider', scope.provider); provider.input.placeholder = 'All providers';
  const from = field('From (UTC)', 'from', scope.from.slice(0,16), 'datetime-local');
  const to = field('To (UTC, exclusive)', 'to', scope.to.slice(0,16), 'datetime-local');
  
  const row1 = make('div', null, 'scope-row-filters');
  row1.append(presetLabel, project.label, provider.label, from.label, to.label);
  
  const submit = make('button', 'Apply scope'); submit.type = 'submit'; submit.className = 'btn-primary';
  const refresh = make('button', 'Refresh now'); refresh.type = 'button';
  const realtimeLabel = make('label', '', 'realtime-label'); const checkbox = make('input'); checkbox.type = 'checkbox';
  checkbox.checked = localStorage.getItem(realtimeKey) === 'true';
  const demo = new URL(location.href).searchParams.get('demo') === 'true'; checkbox.disabled = demo;
  realtimeLabel.append(checkbox, document.createTextNode(demo ? ' Realtime disabled for demo data' : ' Use realtime updates'));
  const state = make('span', scopeNotice ?? 'Polling every 10 seconds.', 'realtime-state'); state.id = 'realtime-state'; state.setAttribute('role','status');
  
  const row2 = make('div', null, 'scope-row-actions');
  
  // MER-UI-023: Add "Reset" button
  const reset = make('button', 'Reset to default'); reset.type = 'button'; reset.className = 'btn-reset';
  reset.addEventListener('click', () => {
    scope = presetScope('24h', { timezone: 'UTC' });
    navigate(location.pathname);
  });
  
  row2.append(submit, reset, refresh, realtimeLabel, state);
  
  const toolbar = make('div', null, 'dashboard-toolbar');
  
  form.append(row1, row2);
  toolbar.append(form);
  
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const tempScope = presetScope(preset.value, { ...scope });
    from.input.value = tempScope.from.slice(0,16);
    to.input.value = tempScope.to.slice(0,16);
  });
  
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const next = { from: new Date(\`\${from.input.value}:00Z\`).toISOString(), to: new Date(\`\${to.input.value}:00Z\`).toISOString(), project: project.input.value.trim() || null, provider: provider.input.value.trim() || null, timezone: 'UTC' };
      if (Date.parse(next.from) >= Date.parse(next.to)) throw new Error('From must be before To.');
      scope = next; scopeNotice = 'Scope applied.';
      const params = serializeUrlScope(scope);
      if (preset.value !== 'custom') params.set('preset', preset.value);
      navigate(\`\${location.pathname}?\${params}\`);
    } catch (error) { announce(error.message); }
  });
  
  refresh.addEventListener('click', () => { void (async () => { refresh.disabled = true; state.textContent = 'Refreshing.'; try { const refreshed = await realtime?.refreshNow(); const target = document.querySelector('#realtime-state'); if (target) target.textContent = refreshed ? 'Refresh complete.' : 'Refresh is unavailable while updates are paused.'; announce(target?.textContent ?? 'Refresh complete.'); } catch { state.textContent = 'Refresh failed. Try again.'; announce(state.textContent); } finally { refresh.disabled = false; } })(); });
  checkbox.addEventListener('change', () => { localStorage.setItem(realtimeKey, String(checkbox.checked)); realtime?.setRealtime(checkbox.checked); });
  
  return toolbar;
}
`

mjs = mjs.slice(0, startIndex) + newScopeControls + mjs.slice(endIndex);
fs.writeFileSync('dashboard/static/app-platform.mjs', mjs);
