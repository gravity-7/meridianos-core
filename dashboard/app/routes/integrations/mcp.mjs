import { make, notice, page, formPanel, badge, iconLabel } from '../../shared/view-helpers.mjs';

const MCP_TOOLS = [
  { name: 'meridian_list_tasks', desc: 'List active tasks, their states, assignees, and priority levels.' },
  { name: 'meridian_create_task', desc: 'Create and enqueue a new task in the MeridianOS workspace.' },
  { name: 'meridian_get_spend', desc: 'Retrieve current token spend, gateway volume, and cost attribution.' },
  { name: 'meridian_get_budget', desc: 'Inspect monthly spend limits, burn rate, and warning thresholds.' },
  { name: 'meridian_get_board_summary', desc: 'Get full operational telemetry and agent health status.' }
];

export async function renderRoute(context) {
  const view = page('Connect Claude Code (MCP)', 'Add MeridianOS Model Context Protocol tools to Claude Code or Claude Cowork for natural-language agent orchestration.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  // Prerequisites Bar
  const prereqBar = make('div', null, 'mcp-prereq-bar');
  prereqBar.append(
    badge('Node.js 22+', 'ok'),
    badge('MeridianOS Daemon Active', 'ok'),
    badge('Claude Code Ready', 'info')
  );

  // MCP Configuration JSON Card
  const mcpConfigObj = {
    mcpServers: {
      meridianos: {
        command: 'node',
        args: ['tools/aios/mcp-server.mjs'],
        env: {
          AIOS_API_URL: 'http://127.0.0.1:8787'
        }
      }
    }
  };
  const configString = JSON.stringify(mcpConfigObj, null, 2);

  const configBox = make('div', null, 'mcp-config-box');
  const configHead = make('div', null, 'mcp-config-head');
  configHead.append(
    make('strong', 'Add to your .mcp.json or Claude settings:'),
    make('span', 'Local Stdio Server', 'entity-tag')
  );

  const copyBtn = make('button', '📋 Copy Configuration', 'btn-primary');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(configString);
      copyBtn.textContent = '✓ Copied to Clipboard!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Configuration'; }, 2500);
    } catch {}
  });

  const pre = make('pre', configString, 'mcp-config-code');
  configBox.append(configHead, pre, copyBtn);

  // Tool Catalog Panel
  const catalogHeader = make('h2', 'Exposed MCP Tools');
  const toolGrid = make('div', null, 'mcp-tools-grid');

  for (const tool of MCP_TOOLS) {
    const card = make('div', null, 'mcp-tool-card');
    const name = make('code', tool.name, 'mcp-tool-name');
    const desc = make('p', tool.desc, 'mcp-tool-desc');
    card.append(name, desc);
    toolGrid.append(card);
  }

  view.node.append(prereqBar, configBox, catalogHeader, toolGrid, feedback);
  context.root.replaceChildren(view.node);
}
