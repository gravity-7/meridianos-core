/**
 * extension.js — MeridianOS VS Code Extension Entry Point
 *
 * Activates on VS Code startup. Registers the sidebar task board, status bar spend
 * indicator, and all MeridianOS commands. Manages daemon lifecycle via daemon-manager.
 */
const vscode = require('vscode');
const { TaskBoardProvider } = require('./sidebar');
const { SpendIndicator } = require('./status-bar');
const {
  checkNodeJs,
  checkDaemonHealth,
  startDaemon,
  stopDaemon,
  downloadAndInstallDaemon,
  launchWizardInWebview,
} = require('./daemon-manager');

let taskBoardProvider;
let spendIndicator;
let daemonProcess = null;

/**
 * Called when the extension is activated (VS Code opens, onStartupFinished).
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  // ── Sidebar: Task Board ──────────────────────────────────────────────
  taskBoardProvider = new TaskBoardProvider();
  vscode.window.registerTreeDataProvider('meridianos.board', taskBoardProvider);
  taskBoardProvider.startAutoRefresh();

  // ── Status Bar: Spend Indicator ──────────────────────────────────────
  spendIndicator = new SpendIndicator();
  spendIndicator.startAutoRefresh();
  context.subscriptions.push(spendIndicator);

  // ── Check daemon health ──────────────────────────────────────────────
  const health = await checkDaemonHealth();
  if (!health.running) {
    const start = await vscode.window.showInformationMessage(
      'MeridianOS daemon is not running. Start it now?',
      'Start', 'Install & Start', 'Not Now',
    );
    if (start === 'Install & Start') {
      // Full zero-terminal onboarding flow
      const nodeCheck = checkNodeJs();
      if (!nodeCheck.ok) {
        vscode.window.showErrorMessage(
          `Node.js 22+ is required but not found. Download from ${nodeCheck.downloadUrl}`,
          'Open Download Page',
        ).then((choice) => {
          if (choice === 'Open Download Page') {
            vscode.env.openExternal(vscode.Uri.parse(nodeCheck.downloadUrl));
          }
        });
      } else {
        const installPath = context.globalStoragePath;
        vscode.window.showInformationMessage('Installing MeridianOS daemon...');
        const result = await downloadAndInstallDaemon(installPath);
        if (result.ok) {
          vscode.window.showInformationMessage(result.message);
          launchWizardInWebview(context);
          daemonProcess = startDaemon(installPath);
          if (daemonProcess) {
            vscode.window.showInformationMessage('MeridianOS daemon started. Dashboard available at http://localhost:4317');
          }
        } else {
          vscode.window.showErrorMessage(result.message);
        }
      }
    } else if (start === 'Start') {
      daemonProcess = startDaemon(context.extensionPath);
      if (daemonProcess) {
        vscode.window.showInformationMessage('MeridianOS daemon started. Dashboard available at http://localhost:4317');
      } else {
        vscode.window.showErrorMessage('Failed to start MeridianOS daemon. Check that Node.js 22+ is installed.');
      }
    }
  }

  // ── Register Commands ────────────────────────────────────────────────

  // meridian.setup — Open setup wizard in Webview
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.setup', () => {
      const panel = launchWizardInWebview(context);
      panel.webview.onDidReceiveMessage((msg) => {
        switch (msg.command) {
          case 'openDashboard':
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:4317'));
            break;
          case 'connectIde':
            vscode.env.openExternal(vscode.Uri.parse('http://localhost:4317'));
            break;
        }
      });
    }),
  );

  // meridian.openDashboard — Open dashboard in browser
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.openDashboard', () => {
      vscode.env.openExternal(vscode.Uri.parse('http://localhost:4317'));
    }),
  );

  // meridian.createTask — Create task from editor selection
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.createTask', async () => {
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.document.getText(editor.selection) || '';

      const title = await vscode.window.showInputBox({
        prompt: 'Task title',
        value: selection.slice(0, 200),
        placeHolder: 'Enter task title',
      });
      if (!title) return;

      const category = await vscode.window.showQuickPick(
        ['feature', 'bug', 'chore', 'docs', 'test', 'refactor'],
        { placeHolder: 'Select task category' },
      );
      if (!category) return;

      const priority = await vscode.window.showQuickPick(
        ['low', 'medium', 'high', 'critical'],
        { placeHolder: 'Select task priority' },
      );
      if (!priority) return;

      try {
        const http = require('http');
        const body = JSON.stringify({ title: title.trim(), category, priority });
        const url = new URL('/api/task', 'http://localhost:4317');

        const resp = await new Promise((resolve, reject) => {
          const req = http.request(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
          }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, data }));
          });
          req.on('error', reject);
          req.write(body);
          req.end();
        });

        if (resp.status >= 200 && resp.status < 300) {
          vscode.window.showInformationMessage(`Task created: "${title.trim()}"`);
          taskBoardProvider.refresh();
        } else {
          vscode.window.showErrorMessage(`Failed to create task: ${resp.data}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to create task: ${e.message}`);
      }
    }),
  );

  // meridian.routeCopilot — Route Copilot through gateway
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.routeCopilot', async () => {
      try {
        const config = vscode.workspace.getConfiguration();
        await config.update('http.proxy', 'http://127.0.0.1:8787', vscode.ConfigurationTarget.Global);
        await config.update('http.proxyStrictSSL', false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('✓ GitHub Copilot now routing through MeridianOS');
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to configure proxy: ${e.message}`);
      }
    }),
  );

  // meridian.toggleGateway — Toggle proxy on/off
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.toggleGateway', async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get('http.proxy');
      if (current) {
        await config.update('http.proxy', undefined, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Gateway proxy disabled');
      } else {
        await config.update('http.proxy', 'http://127.0.0.1:8787', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Gateway proxy enabled');
      }
    }),
  );

  // meridian.pauseAllSpend — Emergency spend halt
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian.pauseAllSpend', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Pause all AI spend? This will block all AI requests through the gateway.',
        { modal: true },
        'Pause All Spend',
      );
      if (confirm === 'Pause All Spend') {
        try {
          const http = require('http');
          const url = new URL('/api/policy', 'http://localhost:4317');
          const body = JSON.stringify({ 'spend.paused': true });
          await new Promise((resolve, reject) => {
            const req = http.request(url.toString(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              timeout: 5000,
            }, (res) => resolve(res));
            req.on('error', reject);
            req.write(body);
            req.end();
          });
          vscode.window.showInformationMessage('✓ All AI spend paused');
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to pause spend: ${e.message}`);
        }
      }
    }),
  );

  // ── Internal: Spend breakdown quick-pick ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('meridian._showSpendBreakdown', () => {
      if (spendIndicator) spendIndicator.showBreakdown();
    }),
  );

  // ── Initial refresh ──────────────────────────────────────────────────
  taskBoardProvider.refresh();
}

/**
 * Called when the extension is deactivated (VS Code closes).
 */
async function deactivate() {
  if (taskBoardProvider) taskBoardProvider.stopAutoRefresh();
  if (spendIndicator) spendIndicator.stopAutoRefresh();

  if (daemonProcess && !daemonProcess.killed) {
    const stop = await vscode.window.showInformationMessage(
      'Stop MeridianOS daemon?',
      'Stop', 'Keep Running',
    );
    if (stop === 'Stop') {
      stopDaemon(daemonProcess);
      daemonProcess = null;
    }
  }
}

module.exports = { activate, deactivate };
