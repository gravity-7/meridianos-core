import React from 'react';
import { MetricsBreakdown } from '../types';

interface BreakdownSectionProps {
  breakdown: MetricsBreakdown | null;
  loading: boolean;
}

export const BreakdownSection: React.FC<BreakdownSectionProps> = ({ breakdown, loading }) => {
  if (loading || !breakdown) {
    return (
      <div className="breakdown-grid">
        <div className="breakdown-card card loading-pulse">
          <div className="metric-skeleton-title"></div>
          <div className="metric-skeleton-val"></div>
        </div>
        <div className="breakdown-card card loading-pulse">
          <div className="metric-skeleton-title"></div>
          <div className="metric-skeleton-val"></div>
        </div>
      </div>
    );
  }

  const totalProviderCost = breakdown.providers.reduce((sum, p) => sum + p.costUsd, 0) || 0.0001;
  const totalModelCost = breakdown.models.reduce((sum, m) => sum + m.costUsd, 0) || 0.0001;

  // Sort models and providers by cost descending
  const sortedProviders = [...breakdown.providers].sort((a, b) => b.costUsd - a.costUsd);
  const sortedModels = [...breakdown.models].sort((a, b) => b.costUsd - a.costUsd);

  return (
    <div className="breakdown-grid" id="breakdown-grid">
      {/* Provider breakdown */}
      <div className="breakdown-card card" id="breakdown-providers">
        <h3 className="card-title">Cost by Provider</h3>
        <div className="breakdown-list">
          {sortedProviders.map(p => {
            const pct = Math.round((p.costUsd / totalProviderCost) * 100);
            return (
              <div key={p.provider} className="breakdown-item">
                <div className="breakdown-item-info">
                  <span className="breakdown-name font-capitalize">{p.provider}</span>
                  <span className="breakdown-value">
                    ${p.costUsd.toFixed(3)} <span className="breakdown-pct">({pct}%)</span>
                  </span>
                </div>
                <div className="breakdown-bar-bg">
                  <div 
                    className="breakdown-bar-fill provider-fill" 
                    style={{ width: `${pct}%`, backgroundColor: p.provider === 'openai' ? 'var(--color-success)' : 'var(--color-accent)' }}
                  />
                </div>
                <div className="breakdown-item-sub">
                  {p.tokens.toLocaleString()} tokens across {p.requests} requests
                </div>
              </div>
            );
          })}
          {sortedProviders.length === 0 && (
            <div className="breakdown-empty">No provider data logged</div>
          )}
        </div>
      </div>

      {/* Model breakdown */}
      <div className="breakdown-card card" id="breakdown-models">
        <h3 className="card-title">Cost by Model</h3>
        <div className="breakdown-list">
          {sortedModels.slice(0, 5).map(m => {
            const pct = Math.round((m.costUsd / totalModelCost) * 100);
            return (
              <div key={m.model} className="breakdown-item">
                <div className="breakdown-item-info">
                  <span className="breakdown-name mono">{m.model}</span>
                  <span className="breakdown-value">
                    ${m.costUsd.toFixed(3)} <span className="breakdown-pct">({pct}%)</span>
                  </span>
                </div>
                <div className="breakdown-bar-bg">
                  <div 
                    className="breakdown-bar-fill model-fill" 
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="breakdown-item-sub font-capitalize">
                  {m.provider} | {m.tokens.toLocaleString()} tokens | {m.requests} requests
                </div>
              </div>
            );
          })}
          {sortedModels.length > 5 && (
            <div className="breakdown-more">
              + {sortedModels.length - 5} more models metered
            </div>
          )}
          {sortedModels.length === 0 && (
            <div className="breakdown-empty">No model data logged</div>
          )}
        </div>
      </div>
    </div>
  );
};
