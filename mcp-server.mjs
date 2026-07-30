/**
 * mcp-server — Model Context Protocol server for MeridianOS integration with Claude Code/Cowork.
 *
 * Implements MCP protocol version 2024-11-05 over stdio (JSON-RPC 2.0, newline-delimited).
 * Exposes 5 tools: meridian_list_tasks, meridian_create_task, meridian_get_spend,
 * meridian_get_budget, meridian_get_board_summary.
 *
 * Each tool handler makes HTTP requests to the MeridianOS dashboard API and transforms
 * responses into MCP tool result format. The server is stateless — no database connection
 * or persistent state, just an HTTP client to the dashboard.
 *
 * Launch: node mcp-server.mjs
 * Config: Set MCP_DASHBOARD_URL env var to the dashboard URL (default http://localhost:4317)
 */
import { createInterface } from 'node:readline';

const DASHBOARD_URL = process.env.MCP_DASHBOARD_URL || 'http://localhost:4317';

// ─── MCP Protocol Constants ──────────────────────────────────────────────

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'meridianos';
const SERVER_VERSION = '1.0.0';

// ─── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'meridian_list_tasks',
    description: 'List tasks from the MeridianOS board with optional filters by status, agent, category, and limit.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todo', 'in-progress', 'review', 'done', 'blocked'],
          description: 'Filter by task status',
        },
        agent: { type: 'string', description: 'Filter by assigned agent name' },
        category: { type: 'string', description: 'Filter by task category' },
        limit: {
          type: 'integer', minimum: 1, maximum: 100, default: 20,
          description: 'Maximum number of tasks to return',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'meridian_create_task',
    description: 'Create a new task on the MeridianOS board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500, description: 'Task title' },
        category: { type: 'string', description: 'Task category (e.g., feature, bug, chore, docs)' },
        priority: {
          type: 'string', enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium', description: 'Task priority',
        },
        body: { type: 'string', description: 'Detailed task description or acceptance criteria' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'meridian_get_spend',
    description: 'Query current AI spend from the MeridianOS gateway ledger for a given time period.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string', enum: ['session', 'day', 'week', 'month'],
          default: 'week', description: 'Time period for spend query',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'meridian_get_budget',
    description: 'Check current budget status against configured caps.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'meridian_get_board_summary',
    description: 'Get a high-level summary of the MeridianOS task board with counts by status.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

// ─── JSON-RPC 2.0 Helpers ────────────────────────────────────────────────

function jsonRpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id, code, message, data) {
  const err = { jsonrpc: '2.0', id, error: { code, message } };
  if (data) err.error.data = data;
  return JSON.stringify(err);
}

function toolResult(id, text) {
  return jsonRpcResult(id, { content: [{ type: 'text', text }] });
}

// ─── Dashboard API Client ────────────────────────────────────────────────

async function dashboardGet(path) {
  const url = `${DASHBOARD_URL}${path}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) {
    throw new Error(`Dashboard API returned ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

async function dashboardPost(path, body) {
  const url = `${DASHBOARD_URL}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error(`Dashboard API returned ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

// ─── Tool Handlers ───────────────────────────────────────────────────────

async function handleListTasks(id, args) {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.limit) params.set('limit', String(args.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';

  const data = await dashboardGet(`/api/state${qs}`);
  const tasks = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);

  // Apply client-side filters for agent/category (not supported by API query params)
  let filtered = tasks;
  if (args.agent) {
    filtered = filtered.filter((t) => t.agent === args.agent);
  }
  if (args.category) {
    filtered = filtered.filter((t) => t.category === args.category);
  }
  if (args.limit && filtered.length > args.limit) {
    filtered = filtered.slice(0, args.limit);
  }

  if (filtered.length === 0) {
    return toolResult(id, 'No tasks found matching the specified filters.');
  }

  const lines = [`Found ${filtered.length} task(s):`, ''];
  for (const t of filtered) {
    const prio = t.priority ? `[${t.priority.toUpperCase()}]` : '';
    const agent = t.agent ? ` (${t.agent})` : '';
    const cat = t.category ? ` [${t.category}]` : '';
    lines.push(`${filtered.indexOf(t) + 1}. ${prio} ${t.title}${agent}${cat} — ${t.status || 'unknown'}`);
  }

  return toolResult(id, lines.join('\n'));
}

async function handleCreateTask(id, args) {
  if (!args.title || args.title.trim().length === 0) {
    return jsonRpcError(id, -32602, 'Invalid parameters', {
      validationErrors: [{ field: 'title', message: 'Required field is missing' }],
    });
  }

  const body = {
    title: args.title.trim(),
    category: args.category || 'uncategorized',
    priority: args.priority || 'medium',
    body: args.body || '',
  };

  const data = await dashboardPost('/api/task', body);

  if (data?.ok !== false) {
    const taskId = data?.id || data?.taskId || 'created';
    return toolResult(id, `Task created: '${body.title}' (${body.priority} priority, category: ${body.category})`);
  }
  return toolResult(id, `Failed to create task: ${data?.error || 'Unknown error'}`);
}

async function handleGetSpend(id, args) {
  const period = args.period || 'week';
  const data = await dashboardGet(`/api/status`);

  let spend = null;
  // Try to extract spend from budget/ledger data in status response
  if (data?.budget?.currentUsage) {
    spend = data.budget.currentUsage;
  }

  if (spend) {
    const lines = [
      `AI Spend (${period}):`,
      `  Total Cost: $${spend.costUsd?.toFixed(2) || '0.00'}`,
      `  Total Tokens: ${spend.totalTokens?.toLocaleString() || '0'}`,
      `  Input Tokens: ${spend.inputTokens?.toLocaleString() || '0'}`,
      `  Output Tokens: ${spend.outputTokens?.toLocaleString() || '0'}`,
    ];
    return toolResult(id, lines.join('\n'));
  }

  // Fallback: try the ledger summary endpoint
  try {
    const ledger = await dashboardGet('/api/ledger/summary');
    return toolResult(id, `AI Spend (${period}): $${ledger?.totalCost?.toFixed(2) || '0.00'} | ${ledger?.totalTokens?.toLocaleString() || '0'} tokens`);
  } catch {
    return toolResult(id, `AI Spend (${period}): Unable to retrieve spend data. Is the MeridianOS daemon running?`);
  }
}

async function handleGetBudget(id, _args) {
  const data = await dashboardGet('/api/status');

  if (data?.budget) {
    const b = data.budget;
    const cap = b.monthlyCap ?? b.per5hTokens ?? 0;
    const current = b.currentUsage?.costUsd ?? 0;
    const pct = cap > 0 ? ((current / cap) * 100).toFixed(1) : 0;
    const status = cap === 0 ? 'no_cap_set' : pct >= 100 ? 'over_cap' : pct >= 80 ? 'approaching_cap' : 'under_budget';

    return toolResult(id, [
      `Budget Status: ${cap === 0 ? 'No cap set' : `$${current.toFixed(2)} of $${cap.toFixed(2)} (${pct}%)`}`,
      `Status: ${status.replace(/_/g, ' ')}`,
    ].join('\n'));
  }

  return toolResult(id, 'Budget: Unable to retrieve budget data. Is the MeridianOS daemon running?');
}

async function handleGetBoardSummary(id, _args) {
  const data = await dashboardGet('/api/state');
  const tasks = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);

  const counts = { todo: 0, 'in-progress': 0, review: 0, done: 0, blocked: 0 };
  const agents = new Set();
  for (const t of tasks) {
    const s = t.status || 'todo';
    if (counts.hasOwnProperty(s)) counts[s]++;
    if (t.agent) agents.add(t.agent);
  }

  const total = tasks.length;
  const lines = [
    `Board Summary: ${total} tasks`,
    `  Todo: ${counts.todo} | In Progress: ${counts['in-progress']} | In Review: ${counts.review} | Done: ${counts.done} | Blocked: ${counts.blocked}`,
    `  Active Agents: ${agents.size}`,
  ];

  return toolResult(id, lines.join('\n'));
}

// ─── Request Router ──────────────────────────────────────────────────────

async function handleRequest(msg) {
  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });

      case 'tools/list':
        return jsonRpcResult(id, { tools: TOOLS });

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments ?? {};

        switch (toolName) {
          case 'meridian_list_tasks': return handleListTasks(id, args);
          case 'meridian_create_task': return handleCreateTask(id, args);
          case 'meridian_get_spend': return handleGetSpend(id, args);
          case 'meridian_get_budget': return handleGetBudget(id, args);
          case 'meridian_get_board_summary': return handleGetBoardSummary(id, args);
          default:
            return jsonRpcError(id, -32601, `Unknown tool: '${toolName}'`);
        }
      }

      case 'notifications/initialized':
        // No response needed for notifications
        return null;

      default:
        return jsonRpcError(id, -32601, `Method not found: '${method}'`);
    }
  } catch (e) {
    return jsonRpcError(id, -32603, `Internal error: ${e.message}`);
  }
}

// ─── Main: stdio transport (only when run directly, not when imported) ───

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      const err = jsonRpcError(null, -32700, 'Parse error: invalid JSON received');
      process.stdout.write(err + '\n');
      return;
    }

    const response = await handleRequest(msg);
    if (response) {
      process.stdout.write(response + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  process.stderr.write(`MeridianOS MCP Server v${SERVER_VERSION} started (dashboard: ${DASHBOARD_URL})\n`);
}

// Log startup to stderr (stdout is the MCP transport channel)
// ─── Exports for unit testing ────────────────────────────────────────────

export { TOOLS, PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION, jsonRpcResult, jsonRpcError, toolResult };
