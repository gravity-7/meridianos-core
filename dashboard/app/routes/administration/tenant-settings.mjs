import { make, notice, page, badge, formPanel } from '../../shared/view-helpers.mjs';
import { managementRequest, typedConfirmation } from '../../shared/management-actions.mjs';

export async function renderRoute(context) {
  const view = page('Tenant Settings & System Configuration', 'Manage gateway network parameters, configuration profiles, policy rollback snapshots, and policy review boundaries.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  // ─── Section 1: General & Gateway Network Configuration ───────────────────
  const gatewayCard = make('div', null, 'tenant-config-card');
  const gwHead = make('div', null, 'tenant-card-head');
  gwHead.append(make('strong', 'Gateway Network Port', 'tenant-card-title'), badge('Core Gateway', 'info'));
  const gwDesc = make('p', 'Unified LLM reverse proxy listening port for local and containerized agent network routing.', 'tenant-card-desc');
  
  const gwForm = make('div', null, 'tenant-field-row');
  const gwInput = make('input', null, 'tenant-port-input');
  gwInput.type = 'number';
  gwInput.min = '1024';
  gwInput.max = '65535';
  gwInput.placeholder = '8787';
  const gwSaveBtn = make('button', 'Update Port', 'btn-primary');
  const gwStatus = make('div', null, 'field-status-msg');

  try {
    const sRes = await fetch('/api/status');
    const sData = await sRes.json();
    if (sData?.gateway?.port) gwInput.value = sData.gateway.port;
  } catch {}

  gwSaveBtn.addEventListener('click', async () => {
    const val = Number(gwInput.value);
    if (!Number.isInteger(val) || val < 1024 || val > 65535) {
      gwStatus.textContent = 'Port must be an integer between 1024 and 65535.';
      return;
    }
    gwSaveBtn.disabled = true;
    gwStatus.textContent = 'Saving port configuration…';
    try {
      const res = await fetch('/api/policy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 'gateway.port': val })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      gwStatus.textContent = '✓ Gateway port updated in policy.yaml.';
      setTimeout(() => { gwStatus.textContent = ''; }, 2500);
    } catch (err) {
      gwStatus.textContent = `Error: ${err.message}`;
    } finally {
      gwSaveBtn.disabled = false;
    }
  });

  gwForm.append(gwInput, gwSaveBtn);
  gatewayCard.append(gwHead, gwDesc, gwForm, gwStatus);

  // ─── Section 2: Configuration Profiles ────────────────────────────────────
  const profilesCard = make('div', null, 'tenant-config-card');
  const profHead = make('div', null, 'tenant-card-head');
  profHead.append(make('strong', 'Configuration Profiles', 'tenant-card-title'));
  const profDesc = make('p', 'Switch between layered execution profiles (e.g. dev, staging, prod) declared in policy.yaml.', 'tenant-card-desc');
  const profList = make('div', null, 'profiles-selector-wrap');
  const profStatus = make('div', null, 'field-status-msg');

  try {
    const pRes = await fetch('/api/config/profiles');
    const pData = await pRes.json();
    const profiles = pData.profiles || [];
    const activeProf = pData.active;

    profHead.append(badge(activeProf ? `Active: ${activeProf}` : 'Default Profile', activeProf ? 'ok' : 'default'));

    if (!profiles.length) {
      profList.append(notice('No profiles defined. Add a `profiles:` section in policy.yaml with `extends:` hierarchy to enable dynamic switching.'));
    } else {
      const profSelect = make('select', null, 'lev-select');
      const defOpt = make('option', '— None / Default (Base Policy) —');
      defOpt.value = '';
      if (!activeProf) defOpt.selected = true;
      profSelect.append(defOpt);

      for (const p of profiles) {
        const o = make('option', `${p.name}${p.extends ? ` (extends ${p.extends})` : ''}`);
        o.value = p.name;
        if (p.name === activeProf) o.selected = true;
        profSelect.append(o);
      }

      profSelect.addEventListener('change', async () => {
        profStatus.textContent = 'Switching profile…';
        try {
          const res = await fetch('/api/policy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ active_profile: profSelect.value || null })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          profStatus.textContent = `✓ Active profile changed to ${profSelect.value || 'default'}.`;
          setTimeout(() => { profStatus.textContent = ''; }, 2500);
        } catch (err) {
          profStatus.textContent = `Profile switch failed: ${err.message}`;
        }
      });

      profList.append(profSelect);
    }
  } catch {
    profList.append(notice('Profiles configuration unavailable.'));
  }

  profilesCard.append(profHead, profDesc, profList, profStatus);

  // ─── Section 3: Policy Backups & Snapshots History ────────────────────────
  const backupsCard = make('div', null, 'tenant-config-card');
  const bkHead = make('div', null, 'tenant-card-head');
  bkHead.append(make('strong', 'Policy Snapshots & Backups', 'tenant-card-title'), badge('Automatic Rollback', 'info'));
  const bkDesc = make('p', 'Historical point-in-time policy backups created automatically before each setting mutation.', 'tenant-card-desc');
  const bkList = make('div', null, 'backups-history-list');
  const bkStatus = make('div', null, 'field-status-msg');

  const loadBackups = async () => {
    bkList.replaceChildren(make('div', 'Loading backup snapshots…', 'field-status-msg'));
    try {
      const res = await fetch('/api/config/backups');
      const data = await res.json();
      const backups = data.backups || [];
      if (!backups.length) {
        bkList.replaceChildren(notice('No policy backups recorded yet. A snapshot is generated on every policy update.'));
        return;
      }
      const listWrap = make('div', null, 'backup-items-container');
      for (const bk of backups) {
        const row = make('div', null, 'backup-item-row');
        const tsLabel = make('code', bk.timestamp, 'backup-timestamp');
        const restoreBtn = make('button', 'Restore Snapshot', 'btn-secondary');

        restoreBtn.addEventListener('click', async () => {
          if (!confirm(`Restore policy backup from ${bk.timestamp}? Current policy will be backed up prior to restore.`)) return;
          bkStatus.textContent = `Restoring ${bk.timestamp}…`;
          try {
            const rRes = await fetch(`/api/config/restore/${encodeURIComponent(bk.timestamp)}`, { method: 'POST' });
            const rData = await rRes.json();
            if (!rData.ok) throw new Error(rData.error || 'Restore failed');
            bkStatus.textContent = '✓ Policy restored successfully. Reloading…';
            setTimeout(() => { loadBackups(); bkStatus.textContent = ''; }, 1500);
          } catch (err) {
            bkStatus.textContent = `Restore failed: ${err.message}`;
          }
        });

        row.append(tsLabel, restoreBtn);
        listWrap.append(row);
      }
      bkList.replaceChildren(listWrap);
    } catch {
      bkList.replaceChildren(notice('Backups subsystem offline or no snapshot directory found.'));
    }
  };

  void loadBackups();
  backupsCard.append(bkHead, bkDesc, bkList, bkStatus);

  // ─── Section 4: Policy Preview & Confirmation Gate ────────────────────────
  const reviewCard = make('div', null, 'tenant-config-card');
  const revHead = make('div', null, 'tenant-card-head');
  revHead.append(make('strong', 'Policy Review & Push Gate', 'tenant-card-title'), badge('Strict Auth Gate', 'warning'));
  const revDesc = make('p', 'Perform two-phase staged verification before pushing sweeping policy updates to running agent daemons.', 'tenant-card-desc');

  const previewBtn = make('button', 'Preview Policy Impact', 'btn-primary');
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', async () => {
    try {
      const result = await managementRequest('/api/management/settings/policy/preview', {
        method: 'POST',
        body: { updates: { 'management.review': 'enabled' } }
      });
      feedback.textContent = `Preview ${result.preview.id}: ${result.preview.targets.length} targets identified; high-privilege confirmation required.`;
      const confirmBtn = make('button', 'Confirm Policy Push', 'btn-warning');
      confirmBtn.type = 'button';
      confirmBtn.addEventListener('click', () => typedConfirmation({
        title: 'Confirm policy push',
        instruction: 'Type APPLY POLICY after reauthentication.',
        confirmLabel: 'Apply policy',
        opener: confirmBtn,
        onConfirm: async (value, reauthToken) => {
          const outcome = await managementRequest(`/api/management/settings/policy/${encodeURIComponent(result.preview.id)}/confirm`, {
            method: 'POST',
            body: { confirmation: value },
            reauthToken
          });
          feedback.textContent = `Policy outcome: ${outcome.result.outcome}; rollback: ${outcome.result.rollbackBoundary.description ?? 'available'}`;
        }
      }));
      feedback.append(confirmBtn);
    } catch (error) {
      feedback.replaceChildren(notice(error.message, { error: true }));
    }
  });

  reviewCard.append(revHead, revDesc, previewBtn);

  const container = make('div', null, 'tenant-settings-grid');
  container.append(gatewayCard, profilesCard, backupsCard, reviewCard);

  view.node.append(container, feedback);
  context.root.replaceChildren(view.node);
}
