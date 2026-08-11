import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openOperationalLedger() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../gateway/ledger-schema.sql', import.meta.url), 'utf8'));
  return db;
}

export function insertOperationalEvent(db, overrides = {}) {
  const event = {
    id: overrides.id ?? `event-${Math.random().toString(36).slice(2)}`,
    ts: overrides.ts ?? '2026-08-11T00:00:00.000Z', tenant: overrides.tenant ?? 'tenant-a',
    agent: overrides.agent ?? 'agent-a', session: overrides.session ?? 'session-a', task: Object.hasOwn(overrides, 'task') ? overrides.task : 'project-a/task-a',
    runId: Object.hasOwn(overrides, 'runId') ? overrides.runId : 'run-a', requestId: overrides.requestId ?? 'request-a', provider: overrides.provider ?? 'openai',
    model: overrides.model ?? 'gpt-test', wire: 'openai', source: 'agent', billingType: 'api_key', upstreamStatus: overrides.upstreamStatus ?? 200,
    latencyMs: overrides.latencyMs ?? 100, inputTokens: overrides.inputTokens ?? 10, outputTokens: overrides.outputTokens ?? 5,
    cacheReadTokens: overrides.cacheReadTokens ?? 0, cacheWriteTokens: 0, totalTokens: overrides.totalTokens ?? 15,
    costUsd: Object.hasOwn(overrides, 'costUsd') ? overrides.costUsd : 1, enforcementDecision: overrides.enforcementDecision ?? 'allow',
    userId: overrides.userId ?? null, projectId: overrides.projectId ?? 'project-a',
  };
  db.prepare(`INSERT INTO token_events(
    id,ts,tenant,agent,session,task,run_id,request_id,provider,model,wire,source,billing_type,
    upstream_status,latency_ms,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,
    cost_usd,enforcement_decision,raw,user_id,project_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    event.id,event.ts,event.tenant,event.agent,event.session,event.task,event.runId,event.requestId,event.provider,event.model,event.wire,event.source,event.billingType,
    event.upstreamStatus,event.latencyMs,event.inputTokens,event.outputTokens,event.cacheReadTokens,event.cacheWriteTokens,event.totalTokens,
    event.costUsd,event.enforcementDecision,JSON.stringify(event),event.userId,event.projectId,
  );
  return event;
}

export function makePointFixture(count = 2000) {
  const start = Date.parse('2026-08-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => ({ at: new Date(start + index * 1000).toISOString(), value: index % 17, sampleCount: 1 }));
}
