import React from 'react';
import { MetricsSummary } from '../types';

interface MetricsGridProps {
  summary: MetricsSummary | null;
  loading: boolean;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ summary, loading }) => {
  if (loading || !summary) {
    return (
      <div className="metrics-grid">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="metric-card card loading-pulse">
            <div className="metric-skeleton-title"></div>
            <div className="metric-skeleton-val"></div>
            <div className="metric-skeleton-sub"></div>
          </div>
        ))}
      </div>
    );
  }

  const formatCost = (val: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(val);
  };

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
    return val.toString();
  };

  const errorPct = (summary.errorRate * 100).toFixed(2);
  const isHighError = summary.errorRate > 0.05;

  return (
    <div className="metrics-grid">
      {/* Total Cost */}
      <div className="metric-card card" id="metric-total-cost">
        <div className="metric-header">
          <span className="metric-title">Total Cost</span>
          <span className="metric-icon">💰</span>
        </div>
        <div className="metric-value">{formatCost(summary.totalCostUsd)}</div>
        <div className="metric-subtext">Cumulative USD consumed</div>
      </div>

      {/* Total Tokens */}
      <div className="metric-card card" id="metric-total-tokens">
        <div className="metric-header">
          <span className="metric-title">Total Tokens</span>
          <span className="metric-icon">🪙</span>
        </div>
        <div className="metric-value">{formatTokens(summary.totalTokens)}</div>
        <div className="metric-subtext text-truncate">
          Prompt: {formatTokens(summary.inputTokens)} | Completion: {formatTokens(summary.outputTokens)}
        </div>
      </div>

      {/* Avg Latency */}
      <div className="metric-card card" id="metric-avg-latency">
        <div className="metric-header">
          <span className="metric-title">Average Latency</span>
          <span className="metric-icon">⚡</span>
        </div>
        <div className="metric-value">{summary.avgLatencyMs} ms</div>
        <div className="metric-subtext">Roundtrip upstream response time</div>
      </div>

      {/* Error Rate */}
      <div className="metric-card card" id="metric-error-rate">
        <div className="metric-header">
          <span className="metric-title">Error & Deny Rate</span>
          <span className="metric-icon">⚠️</span>
        </div>
        <div className={`metric-value ${isHighError ? 'text-danger' : 'text-success'}`}>
          {errorPct}%
        </div>
        <div className="metric-subtext">
          {summary.failedRequests} / {summary.totalRequests} requests failed or denied
        </div>
      </div>
    </div>
  );
};
