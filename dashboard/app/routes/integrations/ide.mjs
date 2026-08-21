import { make, notice, page, formPanel, badge, iconLabel } from '../../shared/view-helpers.mjs';

const IDE_ICONS = {
  vscode: { icon: 'VS', class: 'ide-icon-vscode', label: 'Visual Studio Code' },
  cursor: { icon: 'CR', class: 'ide-icon-cursor', label: 'Cursor' },
  windsurf: { icon: 'WS', class: 'ide-icon-windsurf', label: 'Windsurf' },
  claude: { icon: 'CC', class: 'ide-icon-claude', label: 'Claude Code' },
  claudecode: { icon: 'CC', class: 'ide-icon-claude', label: 'Claude Code' },
  jetbrains: { icon: 'JB', class: 'ide-icon-jetbrains', label: 'JetBrains IDEs' }
};

function getIdeMeta(ideName) {
  const key = String(ideName || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, meta] of Object.entries(IDE_ICONS)) {
    if (key.includes(k)) return meta;
  }
  return { icon: '💻', class: 'ide-icon-generic', label: ideName };
}

export async function renderRoute(context) {
  const view = page('Connect Your IDE', 'Route AI traffic from your IDE through the MeridianOS gateway for unified telemetry and cost attribution.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  // Generic Proxy Card
  const proxyCard = make('div', null, 'generic-proxy-card');
  const proxyHead = make('div', null, 'generic-proxy-head');
  proxyHead.append(make('strong', 'Unified Gateway Proxy Configuration'));
  const proxyCode = make('code', 'HTTP_PROXY=http://127.0.0.1:8787', 'proxy-code-block');
  const copyBtn = make('button', 'Copy Proxy URL', 'btn-secondary');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('http://127.0.0.1:8787');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Proxy URL'; }, 2000);
    } catch {}
  });
  proxyCard.append(proxyHead, proxyCode, copyBtn);

  // IDE Detection Grid
  const ideGrid = make('div', null, 'ide-cards-grid');
  
  try {
    const res = await fetch('/api/ide/detect');
    const data = await res.json();
    const ides = data.ides || [];

    if (!ides.length) {
      ideGrid.append(notice('No supported IDE installations were detected on this machine. Use the generic proxy configuration above.'));
    } else {
      for (const ide of ides) {
        const meta = getIdeMeta(ide.ideName || ide.displayName);
        const card = make('div', null, 'ide-card');
        const header = make('div', null, 'ide-card-header');
        
        const avatar = make('div', meta.icon, `ide-avatar ${meta.class}`);
        const titleWrap = make('div', null, 'ide-title-wrap');
        const name = make('strong', ide.displayName || meta.label, 'ide-name');
        const statusBadge = ide.installed
          ? badge('Installed', 'ok')
          : badge('Not found', 'default');
        
        const tagWrap = make('div', null, 'ide-tag-wrap');
        tagWrap.append(statusBadge);
        if (ide.installed && ide.detectionMethod) {
          tagWrap.append(make('span', ide.detectionMethod, 'entity-tag'));
        }
        titleWrap.append(name, tagWrap);
        header.append(avatar, titleWrap);

        const actions = make('div', null, 'ide-card-actions');
        if (ide.installed) {
          const viewCfgBtn = make('button', 'View Config', 'btn-secondary');
          const testBtn = make('button', 'Test Connection', 'btn-primary');
          const configPre = make('pre', null, 'ide-config-pre');
          configPre.style.display = 'none';
          const testResult = make('div', null, 'ide-test-result');

          viewCfgBtn.addEventListener('click', async () => {
            if (configPre.style.display === 'block') {
              configPre.style.display = 'none';
              return;
            }
            try {
              const r = await fetch(`/api/ide/config/${encodeURIComponent(ide.ideName)}`);
              const cfg = await r.json();
              configPre.textContent = JSON.stringify(cfg, null, 2);
              configPre.style.display = 'block';
            } catch (err) {
              configPre.textContent = `Error: ${err.message}`;
              configPre.style.display = 'block';
            }
          });

          testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            testResult.textContent = 'Testing connection…';
            try {
              const r = await fetch(`/api/ide/test/${encodeURIComponent(ide.ideName)}`, { method: 'POST' });
              const result = await r.json();
              testResult.textContent = result.ok ? '✓ Connection verified successfully' : `✗ Failed: ${result.error || 'unknown'}`;
            } catch (err) {
              testResult.textContent = `✗ Test error: ${err.message}`;
            } finally {
              testBtn.disabled = false;
            }
          });

          actions.append(viewCfgBtn, testBtn);
          card.append(header, actions, configPre, testResult);
        } else {
          card.append(header);
        }

        ideGrid.append(card);
      }
    }
  } catch (err) {
    ideGrid.append(notice(`Could not load IDE detection data: ${err.message}`, { error: true }));
  }

  // GitHub Copilot Card
  const copilotCard = make('div', null, 'copilot-status-card');
  const copilotHead = make('div', null, 'copilot-card-head');
  copilotHead.append(make('strong', 'GitHub Copilot Monitoring'), badge('Proxy Ready', 'info'));
  const copilotNote = make('p', 'Copilot code completions and chat traffic can be seamlessly monitored when routed through the local gateway.', 'copilot-note');
  copilotCard.append(copilotHead, copilotNote);

  view.node.append(proxyCard, ideGrid, copilotCard, feedback);
  context.root.replaceChildren(view.node);
}
