import { make, notice, page, formPanel, badge, iconLabel } from '../../shared/view-helpers.mjs';

const CMD_LIST = ['validate', 'list', 'run --dry', 'tick', 'plan', 'render', 'verify --dry', 'reap', 'seed'];
const CMD_ICONS = { validate: '✓', list: '☰', 'run --dry': '▶', tick: '⟳', plan: '◈', render: '⎙', 'verify --dry': '⚑', reap: '✂', seed: '⬢' };

export async function renderRoute(context) {
  const view = page('Quick Commands', 'Execute agent and repository CLI management commands with live stdout/stderr feedback.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  const container = make('div', null, 'commands-container');

  // Command buttons toolbar
  const toolbar = make('div', null, 'cmd-toolbar');
  
  // Terminal drawer
  const terminalPanel = make('div', null, 'terminal-console-panel');
  terminalPanel.style.display = 'none';

  const terminalHead = make('div', null, 'terminal-console-head');
  const cmdPrompt = make('code', '$ node tools/aios/cli.mjs ...', 'terminal-prompt');
  const clearBtn = make('button', 'Clear', 'btn-secondary');
  clearBtn.addEventListener('click', () => {
    terminalPanel.style.display = 'none';
    terminalPre.textContent = '';
  });
  terminalHead.append(cmdPrompt, clearBtn);

  const terminalPre = make('pre', null, 'terminal-console-output');
  terminalPanel.append(terminalHead, terminalPre);

  let running = false;
  const execCmd = async (name) => {
    if (running) return;
    running = true;
    for (const btn of toolbar.querySelectorAll('button')) btn.disabled = true;

    terminalPanel.style.display = 'block';
    cmdPrompt.textContent = `$ node tools/aios/cli.mjs ${name}`;
    terminalPre.textContent = 'Executing command…';
    terminalPre.className = 'terminal-console-output is-running';

    try {
      const res = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: name })
      });
      const data = await res.json();
      const output = (data.stdout || '') + (data.stderr ? `\n${data.stderr}` : '');
      terminalPre.textContent = output.trim() || '(Command executed with no output)';
      terminalPre.className = `terminal-console-output ${data.ok ? 'is-success' : 'is-error'}`;
      if (!data.ok) cmdPrompt.textContent += ` — exit code ${data.exitCode ?? 1}`;
    } catch (err) {
      terminalPre.textContent = `Command error: ${err.message}`;
      terminalPre.className = 'terminal-console-output is-error';
    } finally {
      running = false;
      for (const btn of toolbar.querySelectorAll('button')) btn.disabled = false;
    }
  };

  for (const cmd of CMD_LIST) {
    const btn = make('button', null, 'btn-secondary cmd-action-btn');
    btn.type = 'button';
    const icon = make('span', CMD_ICONS[cmd] || '›', 'cmd-icon');
    const label = make('span', cmd, 'cmd-label');
    btn.append(icon, label);
    btn.addEventListener('click', () => void execCmd(cmd));
    toolbar.append(btn);
  }

  // Divider
  const sep = make('span', null, 'cmd-separator');
  toolbar.append(sep);

  // Stop scheduler button
  const stopBtn = make('button', null, 'btn-danger cmd-action-btn');
  stopBtn.type = 'button';
  stopBtn.append(make('span', '⏻', 'cmd-icon'), make('span', 'Stop Scheduler', 'cmd-label'));
  stopBtn.addEventListener('click', async () => {
    if (!confirm('Stop the scheduler? You will need to restart it manually.')) return;
    terminalPanel.style.display = 'block';
    cmdPrompt.textContent = 'Stopping scheduler…';
    terminalPre.textContent = 'Sending stop signal to scheduler process…';
    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      terminalPre.textContent = data.message || 'Stop signal acknowledged.';
    } catch (err) {
      terminalPre.textContent = `Error stopping scheduler: ${err.message}`;
    }
  });

  // Restart daemon button
  const restartBtn = make('button', null, 'btn-primary cmd-action-btn');
  restartBtn.type = 'button';
  restartBtn.append(make('span', '↻', 'cmd-icon'), make('span', 'Restart & Update Daemon', 'cmd-label'));
  restartBtn.addEventListener('click', async () => {
    if (!confirm('Restart & update the daemon?\n\nIt will pull latest main and restart — ~10s downtime.')) return;
    terminalPanel.style.display = 'block';
    cmdPrompt.textContent = 'Restarting and updating daemon…';
    terminalPre.textContent = 'Stopping → git pull --ff-only origin main → restarting…';
    try {
      const res = await fetch('/api/restart', { method: 'POST' });
      const data = await res.json();
      terminalPre.textContent = data.ok ? (data.message || 'Restart initiated.') : `Restart failed: ${data.error || 'unknown'}`;
    } catch (err) {
      terminalPre.textContent = `Connection lost during restart (expected): ${err.message}`;
    }
  });

  toolbar.append(stopBtn, restartBtn);

  const card = formPanel(document, {
    title: 'CLI Command Shortcuts',
    icon: 'cpu',
    subtitle: 'Run core MeridianOS CLI tasks and manage autonomous daemon lifecycles directly.'
  }, toolbar, terminalPanel);

  view.node.append(card, feedback);
  context.root.replaceChildren(view.node);
}
