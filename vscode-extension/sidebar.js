/**
 * sidebar.js — MeridianOS VS Code Extension Task Board TreeView Provider
 *
 * Fetches board state from the MeridianOS dashboard API and renders tasks
 * grouped by status in the VS Code sidebar TreeView. Refreshes every 30 seconds.
 */
const vscode = require('vscode');
const http = require('http');

const DASHBOARD_URL = process.env.MERIDIAN_DASHBOARD_URL || 'http://localhost:4317';
const REFRESH_INTERVAL_MS = 30000;

class TaskBoardProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._tasks = [];
    this._interval = null;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  startAutoRefresh() {
    this._fetchAndRefresh();
    this._interval = setInterval(() => this._fetchAndRefresh(), REFRESH_INTERVAL_MS);
  }

  stopAutoRefresh() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async _fetchAndRefresh() {
    try {
      const data = await this._httpGet('/api/state');
      this._tasks = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
    } catch {
      // Silently keep previous data on fetch failure
    }
    this.refresh();
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

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // Root: return status group headers
      const groups = [
        { status: 'in-progress', label: 'In Progress', icon: 'sync~spin' },
        { status: 'review', label: 'In Review', icon: 'eye' },
        { status: 'todo', label: 'Todo', icon: 'circle-outline' },
        { status: 'done', label: 'Done', icon: 'check' },
        { status: 'blocked', label: 'Blocked', icon: 'shield' },
      ];

      const children = [];
      for (const group of groups) {
        const tasks = this._tasks.filter((t) => (t.status || 'todo') === group.status);
        if (tasks.length > 0 || group.status === 'todo') {
          children.push(new vscode.TreeItem(
            `${group.label} (${tasks.length})`,
            vscode.TreeItemCollapsibleState.Expanded,
          ));
          children[children.length - 1].contextValue = 'status-group';
          children[children.length - 1].id = `status-${group.status}`;
          children[children.length - 1].iconPath = new vscode.ThemeIcon(group.icon);
          children[children.length - 1]._tasks = tasks;
        }
      }
      return children;
    }

    if (element._tasks) {
      // Status group: return task items
      return element._tasks.map((task) => {
        const prio = task.priority || 'medium';
        const icon = prio === 'critical' ? 'error' : prio === 'high' ? 'warning' : 'circle-outline';
        const label = task.title || 'Untitled';
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'task';
        item.id = task.id;
        item.iconPath = new vscode.ThemeIcon(icon);
        item.description = task.agent ? `@${task.agent}` : '';
        item.tooltip = `${label}\nAgent: ${task.agent || 'unassigned'}\nPriority: ${prio}\nCategory: ${task.category || 'none'}`;
        if (prio === 'critical') {
          item.tooltip += '\n⚠️ CRITICAL PRIORITY';
        }
        return item;
      });
    }

    return [];
  }
}

module.exports = { TaskBoardProvider };
