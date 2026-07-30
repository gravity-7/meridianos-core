/**
 * Tests for mcp-server.mjs — MCP protocol compliance and tool handler behavior.
 *
 * These tests launch the MCP server as a child process and communicate over stdio
 * using JSON-RPC 2.0 messages. Tests verify protocol handshake, tool listing,
 * tool parameter validation, and error handling.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER = join(HERE, '..', 'mcp-server.mjs');

/**
 * Helper: send a JSON-RPC message to the MCP server and collect the response.
 */
function sendMessage(rl, msg) {
  return new Promise((resolve) => {
    const handler = (line) => {
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ error: 'parse error', raw: line });
      }
      rl.removeListener('line', handler);
    };
    rl.on('line', handler);
    process.stdin.write(JSON.stringify(msg) + '\n');
  });
}

// These tests spawn the MCP server process — skip in CI if dashboard not available
describe('mcp-server (protocol compliance)', () => {
  /** @type {import('child_process').ChildProcess} */
  let child;
  /** @type {import('readline').Interface} */
  let rl;
  let msgId = 0;

  before(() => {
    child = spawn('node', [MCP_SERVER], {
      env: { ...process.env, MCP_DASHBOARD_URL: 'http://localhost:4317' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    rl = createInterface({ input: child.stdout, terminal: false });
  });

  after(() => {
    if (rl) rl.close();
    if (child && !child.killed) child.kill();
  });

  function nextId() {
    return ++msgId;
  }

  function send(msg) {
    return new Promise((resolve) => {
      const handler = (line) => {
        try {
          resolve(JSON.parse(line.trim()));
        } catch {
          resolve({ error: 'parse error', raw: line });
        }
        rl.removeListener('line', handler);
      };
      rl.on('line', handler);
      child.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  it('responds to initialize with server capabilities', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    });
    assert.ok(resp.result, 'initialize should return result');
    assert.ok(resp.result.capabilities, 'should include capabilities');
    assert.strictEqual(resp.result.protocolVersion, '2024-11-05');
    assert.strictEqual(resp.result.serverInfo.name, 'meridianos');
  });

  it('returns tools/list with 5 tools', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'tools/list', params: {},
    });
    assert.ok(resp.result, 'should return result');
    assert.ok(Array.isArray(resp.result.tools), 'tools should be an array');
    assert.strictEqual(resp.result.tools.length, 5, 'should have exactly 5 tools');

    const names = resp.result.tools.map((t) => t.name);
    assert.ok(names.includes('meridian_list_tasks'));
    assert.ok(names.includes('meridian_create_task'));
    assert.ok(names.includes('meridian_get_spend'));
    assert.ok(names.includes('meridian_get_budget'));
    assert.ok(names.includes('meridian_get_board_summary'));

    // Each tool should have inputSchema
    for (const tool of resp.result.tools) {
      assert.ok(tool.inputSchema, `${tool.name} should have inputSchema`);
      assert.ok(tool.description, `${tool.name} should have description`);
    }
  });

  it('returns error for unknown tool', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    });
    assert.ok(resp.error, 'should return error');
    assert.strictEqual(resp.error.code, -32601);
    assert.ok(resp.error.message.includes('Unknown tool'));
  });

  it('returns error for create_task without title', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'tools/call',
      params: { name: 'meridian_create_task', arguments: {} },
    });
    assert.ok(resp.error, 'should return validation error');
    assert.strictEqual(resp.error.code, -32602);
  });

  it('returns error for malformed JSON', async () => {
    // Write invalid JSON directly
    child.stdin.write('not valid json\n');
    const resp = await new Promise((resolve) => {
      const handler = (line) => {
        try { resolve(JSON.parse(line.trim())); } catch { resolve({ raw: line }); }
        rl.removeListener('line', handler);
      };
      rl.on('line', handler);
    });
    assert.ok(resp.error, 'should return parse error');
    assert.strictEqual(resp.error.code, -32700);
  });

  it('returns error for unknown method', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'unknown/method', params: {},
    });
    assert.ok(resp.error, 'should return error');
    assert.strictEqual(resp.error.code, -32601);
  });

  it('handles list_tasks with valid parameters (may fail if dashboard not running)', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'tools/call',
      params: { name: 'meridian_list_tasks', arguments: { limit: 5 } },
    });
    // Either succeeds (dashboard running) or returns internal error (dashboard not running)
    // Both are valid — we just verify the server doesn't crash
    assert.ok(resp.result || resp.error, 'should return result or error');
    if (resp.error) {
      assert.ok(resp.error.message.includes('Internal error') || resp.error.message.includes('Dashboard API'));
    }
  });

  it('handles get_board_summary with no arguments', async () => {
    const resp = await send({
      jsonrpc: '2.0', id: nextId(), method: 'tools/call',
      params: { name: 'meridian_get_board_summary', arguments: {} },
    });
    assert.ok(resp.result || resp.error, 'should return result or error');
  });
});
