import { TokenEvent, MetricsSummary, SpendOverTimePoint, MetricsBreakdown, DashboardFilters } from '../types';

// Helper to generate a realistic timeline of mock data
const generateMockEvents = (): TokenEvent[] => {
  const events: TokenEvent[] = [];
  const providers = ['openai', 'anthropic'];
  const models: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-3-5-sonnet', 'claude-3-haiku'],
  };
  const agents = ['planner', 'coder', 'reviewer', 'debugger'];
  const tenants = ['pv', 'mos', 'real-estate'];

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  // Generate 7 days of request data (approx 200 requests/day)
  for (let i = 0; i < 1400; i++) {
    const tsOffset = Math.random() * 7 * oneDay;
    const eventTime = new Date(now - tsOffset);
    const provider = providers[Math.floor(Math.random() * providers.length)];
    const model = models[provider][Math.floor(Math.random() * models[provider].length)];
    const tenant = tenants[Math.floor(Math.random() * tenants.length)];
    const agent = agents[Math.floor(Math.random() * agents.length)];
    
    const upstreamStatus = Math.random() > 0.015 ? 200 : (Math.random() > 0.5 ? 429 : 500);
    const latencyMs = Math.round(150 + Math.random() * 1200 + (model.includes('gpt-4o') ? 200 : 50));
    
    // Tokens estimation
    const isMini = model.includes('mini') || model.includes('haiku');
    const inputTokens = Math.round(isMini ? 200 + Math.random() * 2000 : 1000 + Math.random() * 15000);
    const outputTokens = Math.round(isMini ? 50 + Math.random() * 500 : 200 + Math.random() * 4000);
    const cacheReadTokens = provider === 'anthropic' && Math.random() > 0.5 ? Math.round(inputTokens * 0.6) : undefined;
    const cacheWriteTokens = provider === 'anthropic' && Math.random() > 0.8 ? Math.round(inputTokens * 0.2) : undefined;
    const totalTokens = inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);

    // Pricing math estimation
    let rateInput = 0;
    let rateOutput = 0;
    if (model === 'gpt-4o') { rateInput = 5.0; rateOutput = 15.0; }
    else if (model === 'gpt-4o-mini') { rateInput = 0.15; rateOutput = 0.6; }
    else if (model === 'claude-3-5-sonnet') { rateInput = 3.0; rateOutput = 15.0; }
    else if (model === 'claude-3-haiku') { rateInput = 0.25; rateOutput = 1.25; }

    const costUsd = (inputTokens * rateInput + outputTokens * rateOutput) / 1_000_000;
    const decisionRoll = Math.random();
    const enforcementDecision = decisionRoll > 0.99 ? 'deny' : 'allow';
    const capWindow = enforcementDecision === 'deny' ? (Math.random() > 0.5 ? '5h' : 'week') : null;

    events.push({
      id: `req-${Math.random().toString(36).substring(2, 10)}`,
      ts: eventTime.toISOString(),
      tenant,
      agent,
      provider,
      model,
      wire: provider === 'openai' ? 'openai' : 'anthropic',
      upstreamStatus: enforcementDecision === 'allow' ? upstreamStatus : undefined,
      latencyMs: enforcementDecision === 'allow' ? latencyMs : undefined,
      inputTokens: enforcementDecision === 'allow' ? inputTokens : undefined,
      outputTokens: enforcementDecision === 'allow' ? outputTokens : undefined,
      cacheReadTokens: enforcementDecision === 'allow' ? cacheReadTokens : undefined,
      cacheWriteTokens: enforcementDecision === 'allow' ? cacheWriteTokens : undefined,
      totalTokens: enforcementDecision === 'allow' ? totalTokens : undefined,
      costUsd: enforcementDecision === 'allow' ? costUsd : 0,
      enforcementDecision,
      capWindow,
    });
  }

  // Sort chronologically
  return events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
};

const mockEvents = generateMockEvents();

// Filter application helper
const filterEvents = (events: TokenEvent[], filters: DashboardFilters): TokenEvent[] => {
  return events.filter(e => {
    if (filters.tenant && e.tenant !== filters.tenant) return false;
    if (filters.agent && e.agent !== filters.agent) return false;
    if (filters.provider && e.provider !== filters.provider) return false;
    if (filters.model && e.model !== filters.model) return false;
    
    const time = new Date(e.ts).getTime();
    if (filters.since && time < new Date(filters.since).getTime()) return false;
    if (filters.until && time > new Date(filters.until).getTime()) return false;
    
    return true;
  });
};

export const getMockSummary = (filters: DashboardFilters): Promise<MetricsSummary> => {
  return new Promise((resolve) => {
    const filtered = filterEvents(mockEvents, filters);
    const summary: MetricsSummary = {
      totalCostUsd: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      totalRequests: filtered.length,
      failedRequests: 0,
    };

    let totalLatency = 0;
    let latencyCount = 0;

    filtered.forEach(e => {
      summary.totalCostUsd += e.costUsd ?? 0;
      if (e.enforcementDecision === 'allow') {
        summary.totalTokens += e.totalTokens ?? 0;
        summary.inputTokens += e.inputTokens ?? 0;
        summary.outputTokens += e.outputTokens ?? 0;
        
        if (e.latencyMs) {
          totalLatency += e.latencyMs;
          latencyCount++;
        }
        
        if (e.upstreamStatus && e.upstreamStatus !== 200) {
          summary.failedRequests++;
        }
      } else {
        // Capped / Denied requests are counted as client-facing errors or limits
        summary.failedRequests++;
      }
    });

    summary.avgLatencyMs = latencyCount > 0 ? parseFloat((totalLatency / latencyCount).toFixed(1)) : 0;
    summary.errorRate = summary.totalRequests > 0 ? parseFloat((summary.failedRequests / summary.totalRequests).toFixed(4)) : 0;
    summary.totalCostUsd = parseFloat(summary.totalCostUsd.toFixed(4));

    setTimeout(() => resolve(summary), 150);
  });
};

export const getMockSpendOverTime = (filters: DashboardFilters, interval: 'hour' | 'day' = 'day'): Promise<SpendOverTimePoint[]> => {
  return new Promise((resolve) => {
    const filtered = filterEvents(mockEvents, filters);
    const groups: Record<string, { cost: number; tokens: number; requests: number }> = {};

    filtered.forEach(e => {
      const date = new Date(e.ts);
      let key = '';
      if (interval === 'hour') {
        date.setMinutes(0, 0, 0);
        key = date.toISOString();
      } else {
        date.setHours(0, 0, 0, 0);
        key = date.toISOString().substring(0, 10);
      }

      if (!groups[key]) {
        groups[key] = { cost: 0, tokens: 0, requests: 0 };
      }
      
      groups[key].cost += e.costUsd ?? 0;
      groups[key].tokens += e.totalTokens ?? 0;
      groups[key].requests += 1;
    });

    const series: SpendOverTimePoint[] = Object.keys(groups).map(key => ({
      timestamp: interval === 'day' ? `${key}T00:00:00.000Z` : key,
      costUsd: parseFloat(groups[key].cost.toFixed(4)),
      tokens: groups[key].tokens,
      requests: groups[key].requests,
    }));

    // Ensure sorted
    series.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    setTimeout(() => resolve(series), 180);
  });
};

export const getMockBreakdown = (filters: DashboardFilters): Promise<MetricsBreakdown> => {
  return new Promise((resolve) => {
    const filtered = filterEvents(mockEvents, filters);
    
    const providerMap: Record<string, { cost: number; tokens: number; requests: number }> = {};
    const modelMap: Record<string, { provider: string; cost: number; tokens: number; requests: number }> = {};

    filtered.forEach(e => {
      // Provider Aggregation
      if (!providerMap[e.provider]) {
        providerMap[e.provider] = { cost: 0, tokens: 0, requests: 0 };
      }
      providerMap[e.provider].cost += e.costUsd ?? 0;
      providerMap[e.provider].tokens += e.totalTokens ?? 0;
      providerMap[e.provider].requests += 1;

      // Model Aggregation
      if (!modelMap[e.model]) {
        modelMap[e.model] = { provider: e.provider, cost: 0, tokens: 0, requests: 0 };
      }
      modelMap[e.model].cost += e.costUsd ?? 0;
      modelMap[e.model].tokens += e.totalTokens ?? 0;
      modelMap[e.model].requests += 1;
    });

    const providers = Object.keys(providerMap).map(p => ({
      provider: p,
      costUsd: parseFloat(providerMap[p].cost.toFixed(4)),
      tokens: providerMap[p].tokens,
      requests: providerMap[p].requests,
    }));

    const models = Object.keys(modelMap).map(m => ({
      model: m,
      provider: modelMap[m].provider,
      costUsd: parseFloat(modelMap[m].cost.toFixed(4)),
      tokens: modelMap[m].tokens,
      requests: modelMap[m].requests,
    }));

    setTimeout(() => resolve({ providers, models }), 150);
  });
};

// SSE emulator: trigger a callback every few seconds with a new event
export class MockRequestStream {
  private timer: number | null = null;
  private active = false;
  private callback: (event: TokenEvent) => void;

  constructor(callback: (event: TokenEvent) => void) {
    this.callback = callback;
  }

  public start() {
    if (this.active) return;
    this.active = true;
    
    const scheduleNext = () => {
      if (!this.active) return;
      
      const delay = 500 + Math.random() * 4500; // random request arrival (0.5s - 5s)
      this.timer = window.setTimeout(() => {
        const providers = ['openai', 'anthropic'];
        const models: Record<string, string[]> = {
          openai: ['gpt-4o', 'gpt-4o-mini'],
          anthropic: ['claude-3-5-sonnet', 'claude-3-haiku'],
        };
        const agents = ['planner', 'coder', 'reviewer', 'debugger'];
        const tenants = ['pv', 'mos', 'real-estate'];

        const provider = providers[Math.floor(Math.random() * providers.length)];
        const model = models[provider][Math.floor(Math.random() * models[provider].length)];
        const tenant = tenants[Math.floor(Math.random() * tenants.length)];
        const agent = agents[Math.floor(Math.random() * agents.length)];

        const isMini = model.includes('mini') || model.includes('haiku');
        const inputTokens = Math.round(isMini ? 200 + Math.random() * 2000 : 1000 + Math.random() * 15000);
        const outputTokens = Math.round(isMini ? 50 + Math.random() * 500 : 200 + Math.random() * 4000);
        
        let rateInput = 0;
        let rateOutput = 0;
        if (model === 'gpt-4o') { rateInput = 5.0; rateOutput = 15.0; }
        else if (model === 'gpt-4o-mini') { rateInput = 0.15; rateOutput = 0.6; }
        else if (model === 'claude-3-5-sonnet') { rateInput = 3.0; rateOutput = 15.0; }
        else if (model === 'claude-3-haiku') { rateInput = 0.25; rateOutput = 1.25; }

        const costUsd = parseFloat(((inputTokens * rateInput + outputTokens * rateOutput) / 1_000_000).toFixed(6));
        const decisionRoll = Math.random();
        const enforcementDecision = decisionRoll > 0.99 ? 'deny' : 'allow';
        const capWindow = enforcementDecision === 'deny' ? (Math.random() > 0.5 ? '5h' : 'week') : null;

        const newEvent: TokenEvent = {
          id: `req-${Math.random().toString(36).substring(2, 10)}`,
          ts: new Date().toISOString(),
          tenant,
          agent,
          provider,
          model,
          wire: provider === 'openai' ? 'openai' : 'anthropic',
          upstreamStatus: enforcementDecision === 'allow' ? (Math.random() > 0.99 ? 500 : 200) : undefined,
          latencyMs: enforcementDecision === 'allow' ? Math.round(150 + Math.random() * 1200) : undefined,
          inputTokens: enforcementDecision === 'allow' ? inputTokens : undefined,
          outputTokens: enforcementDecision === 'allow' ? outputTokens : undefined,
          totalTokens: enforcementDecision === 'allow' ? (inputTokens + outputTokens) : undefined,
          costUsd: enforcementDecision === 'allow' ? costUsd : 0,
          enforcementDecision,
          capWindow,
        };

        this.callback(newEvent);
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  public stop() {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
