export interface TokenEvent {
  id: string;
  ts: string;
  tenant: string;
  agent: string;
  session?: string;
  task?: string;
  runId?: string;
  requestId?: string;
  provider: string;
  model: string;
  wire: string;
  upstreamStatus?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  enforcementDecision: 'allow' | 'deny';
  capWindow?: '5h' | 'week' | null;
  raw?: string;
}

export interface MetricsSummary {
  totalCostUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
  errorRate: number;
  totalRequests: number;
  failedRequests: number;
}

export interface SpendOverTimePoint {
  timestamp: string;
  costUsd: number;
  tokens: number;
  requests: number;
}

export interface ProviderBreakdown {
  provider: string;
  costUsd: number;
  tokens: number;
  requests: number;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  costUsd: number;
  tokens: number;
  requests: number;
}

export interface MetricsBreakdown {
  providers: ProviderBreakdown[];
  models: ModelBreakdown[];
}

export interface DashboardFilters {
  tenant: string;
  agent: string;
  provider: string;
  model: string;
  since: string;
  until: string;
}
