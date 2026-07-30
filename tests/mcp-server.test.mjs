/**
 * Unit tests for mcp-server.mjs — MCP protocol constants and tool definitions.
 *
 * Tests the exported TOOLS array, protocol version, server metadata, and
 * JSON-RPC helper functions. Does NOT spawn child processes or require
 * a running dashboard — pure unit tests suitable for CI.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION, jsonRpcResult, jsonRpcError, toolResult } from '../mcp-server.mjs';

describe('MCP Server Constants', () => {
  it('declares protocol version 2024-11-05', () => {
    assert.strictEqual(PROTOCOL_VERSION, '2024-11-05');
  });

  it('declares server name and version', () => {
    assert.strictEqual(SERVER_NAME, 'meridianos');
    assert.strictEqual(SERVER_VERSION, '1.0.0');
  });
});

describe('TOOLS registry', () => {
  it('contains exactly 5 tools', () => {
    assert.strictEqual(TOOLS.length, 5);
  });

  it('includes all required tool names', () => {
    const names = TOOLS.map((t) => t.name);
    assert.ok(names.includes('meridian_list_tasks'));
    assert.ok(names.includes('meridian_create_task'));
    assert.ok(names.includes('meridian_get_spend'));
    assert.ok(names.includes('meridian_get_budget'));
    assert.ok(names.includes('meridian_get_board_summary'));
  });

  it('each tool has name, description, and inputSchema', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, `tool missing name`);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.strictEqual(typeof tool.inputSchema, 'object');
      assert.strictEqual(tool.inputSchema.type, 'object');
    }
  });

  it('meridian_create_task requires title parameter', () => {
    const tool = TOOLS.find((t) => t.name === 'meridian_create_task');
    assert.ok(tool);
    assert.ok(tool.inputSchema.required.includes('title'));
    assert.ok(tool.inputSchema.properties.title.minLength >= 1);
  });

  it('meridian_list_tasks supports status filter enum', () => {
    const tool = TOOLS.find((t) => t.name === 'meridian_list_tasks');
    assert.ok(tool);
    const statusEnum = tool.inputSchema.properties.status.enum;
    assert.ok(statusEnum.includes('todo'));
    assert.ok(statusEnum.includes('in-progress'));
    assert.ok(statusEnum.includes('review'));
    assert.ok(statusEnum.includes('done'));
    assert.ok(statusEnum.includes('blocked'));
  });

  it('meridian_get_spend supports period enum', () => {
    const tool = TOOLS.find((t) => t.name === 'meridian_get_spend');
    assert.ok(tool);
    const periodEnum = tool.inputSchema.properties.period.enum;
    assert.ok(periodEnum.includes('session'));
    assert.ok(periodEnum.includes('day'));
    assert.ok(periodEnum.includes('week'));
    assert.ok(periodEnum.includes('month'));
  });

  it('all tools disallow additional properties', () => {
    for (const tool of TOOLS) {
      assert.strictEqual(tool.inputSchema.additionalProperties, false,
        `${tool.name} should set additionalProperties: false`);
    }
  });
});

describe('JSON-RPC 2.0 helpers', () => {
  it('jsonRpcResult produces valid JSON-RPC success response', () => {
    const result = jsonRpcResult(1, { tools: [] });
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.jsonrpc, '2.0');
    assert.strictEqual(parsed.id, 1);
    assert.deepStrictEqual(parsed.result, { tools: [] });
  });

  it('jsonRpcError produces valid JSON-RPC error response', () => {
    const result = jsonRpcError(2, -32601, 'Method not found');
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.jsonrpc, '2.0');
    assert.strictEqual(parsed.id, 2);
    assert.strictEqual(parsed.error.code, -32601);
    assert.strictEqual(parsed.error.message, 'Method not found');
  });

  it('jsonRpcError includes optional data field', () => {
    const result = jsonRpcError(3, -32602, 'Invalid params', { validationErrors: [] });
    const parsed = JSON.parse(result);
    assert.ok(parsed.error.data);
    assert.ok(Array.isArray(parsed.error.data.validationErrors));
  });

  it('toolResult wraps text in MCP content format', () => {
    const result = toolResult(4, 'Hello');
    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.id, 4);
    assert.deepStrictEqual(parsed.result, { content: [{ type: 'text', text: 'Hello' }] });
  });
});
