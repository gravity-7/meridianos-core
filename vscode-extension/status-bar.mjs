/**
 * status-bar.js — MeridianOS VS Code Extension Spend Indicator
 *
 * Shows current AI spend in the VS Code status bar with color coding:
 *   Green:  <50% budget used
 *   Yellow: 50-80% budget used
 *   Red:    >80% budget used
 *
 * Refreshes every 30 seconds. Click opens per-provider breakdown quick-pick.
 */
import vscode from 'vscode';
import http from 'node:http';

const DASHBOARD_URL = process.env.MERIDIAN_DASHBOARD_URL || 'http://localhost:4317';
const REFRESH_INTERVAL_MS = 30000;

class SpendIndicator {
  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100, // Priority (lower = more left)
    );
    this._item.name = 'MeridianOS Spend';
    this._item.command = 'meridian._showSpendBreakdown';
    this._item.tooltip = 'MeridianOS AI Spend — Click for breakdown';
    this._item.show();
    this._interval = null;
    this._lastData = null;
  }

  startAutoRefresh() {
    this._refresh();
    this._interval = setInterval(() => this._refresh(), REFRESH_INTERVAL_MS);
  }

  stopAutoRefresh() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _refresh() {
    try {
      const data = await this._httpGet('/api/status');
      if (data?.budget) {
        this._lastData = data.budget;
        this._updateDisplay(data.budget);
      }
    } catch {
      this._item.text = '$(graph) MeridianOS: --';
      this._item.backgroundColor = undefined;
    }
  }

  _updateDisplay(budget) {
    const currentCost = budget.currentUsage?.costUsd ?? 0;
    const cap = budget.monthlyCap;
    const pct = cap > 0 ? (currentCost / cap) * 100 : 0;

    this._item.text = `$(graph) $${currentCost.toFixed(2)}`;
    if (cap > 0) {
      this._item.text += ` / $${cap.toFixed(0)}`;
    }

    if (cap === 0 || pct < 50) {
      this._item.backgroundColor = undefined; // Default (no color)
    } else if (pct < 80) {
      this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    this._item.tooltip = `MeridianOS AI Spend\nCurrent: $${currentCost.toFixed(2)}`;
    if (cap > 0) {
      this._item.tooltip += `\nCap: $${cap.toFixed(2)}\nUsed: ${pct.toFixed(1)}%`;
    }
    this._item.tooltip += '\nClick for provider breakdown';
  }

  async showBreakdown() {
    if (!this._lastData) {
      vscode.window.showInformationMessage('No spend data available. Is the MeridianOS daemon running?');
      return;
    }

    try {
      const breakdown = await this._httpGet('/api/ledger/spend-by-provider');
      if (Array.isArray(breakdown) && breakdown.length > 0) {
        const items = breakdown.map((p) => ({
          label: `${p.provider || 'unknown'}`,
          description: `$${(p.cost_usd || 0).toFixed(2)} — ${(p.total_tokens || 0).toLocaleString()} tokens`,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'AI Spend by Provider',
          title: 'MeridianOS — Spend Breakdown',
        });
      } else {
        const current = this._lastData.currentUsage?.costUsd ?? 0;
        vscode.window.showInformationMessage(`Current spend: $${current.toFixed(2)}`);
      }
    } catch {
      vscode.window.showInformationMessage('Could not fetch spend breakdown.');
    }
  }

  _httpGet(path) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, DASHBOARD_URL);
      http.get(url.toString(), { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
        });
      }).on('error', reject);
    });
  }

  dispose() {
    this.stopAutoRefresh();
    this._item.dispose();
  }
}

export { SpendIndicator };
