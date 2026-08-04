/**
 * desktop/preload.js — secure IPC bridge (T029). Runs in an isolated context (contextIsolation:
 * true, nodeIntegration: false — see main.js's BrowserWindow webPreferences) and exposes only
 * the specific, narrow operations the renderer wizard needs, never the raw `ipcRenderer` object.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meridianos', {
  /** Store one provider's API key in the OS keychain. provider: 'anthropic' | 'deepseek'. */
  saveApiKey: (provider, value) => ipcRenderer.invoke('wizard:save-api-key', { provider, value }),
  /** Complete the wizard: persist the budget, start the daemon, load the dashboard. */
  finishSetup: (monthlyBudget) => ipcRenderer.invoke('wizard:finish', { monthlyBudget }),
  /** Open a URL in the OS default browser instead of navigating the app window. */
  openExternal: (url) => ipcRenderer.invoke('dashboard:open-external', url),
});
