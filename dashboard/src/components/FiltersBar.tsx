import React, { useEffect, useState } from 'react';
import { DashboardFilters } from '../types';

interface FiltersBarProps {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}

export const FiltersBar: React.FC<FiltersBarProps> = ({ filters, onChange }) => {
  const [datePreset, setDatePreset] = useState<string>('7d');
  
  const tenants = ['pv', 'mos', 'real-estate'];
  const agents = ['planner', 'coder', 'reviewer', 'debugger'];
  const providers = ['openai', 'anthropic'];
  const modelsByProvider: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-3-5-sonnet', 'claude-3-haiku'],
  };

  // Get available models based on selected provider
  const availableModels = filters.provider 
    ? modelsByProvider[filters.provider] || []
    : Object.values(modelsByProvider).flat();

  const handleFilterChange = (key: keyof DashboardFilters, value: string) => {
    const updated = { ...filters, [key]: value };
    
    // Reset model if provider changed and the model doesn't belong to the new provider
    if (key === 'provider') {
      if (value && modelsByProvider[value] && !modelsByProvider[value].includes(filters.model)) {
        updated.model = '';
      }
    }
    
    onChange(updated);
  };

  // Handle Preset Date changes
  useEffect(() => {
    const now = new Date();
    let since = '';
    
    if (datePreset === '5h') {
      since = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    } else if (datePreset === '24h') {
      since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else if (datePreset === '7d') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    
    onChange({
      ...filters,
      since,
      until: '', // current time implicitly
    });
  }, [datePreset]);

  const resetFilters = () => {
    setDatePreset('7d');
    onChange({
      tenant: '',
      agent: '',
      provider: '',
      model: '',
      since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      until: '',
    });
  };

  return (
    <div className="filters-container card">
      <div className="filters-grid">
        {/* Date Preset */}
        <div className="filter-group">
          <label htmlFor="filter-date-preset">📅 Date Range</label>
          <select
            id="filter-date-preset"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
          >
            <option value="5h">Last 5 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="custom">All Time</option>
          </select>
        </div>

        {/* Tenant/App */}
        <div className="filter-group">
          <label htmlFor="filter-tenant">🏢 App / Tenant</label>
          <select
            id="filter-tenant"
            value={filters.tenant}
            onChange={(e) => handleFilterChange('tenant', e.target.value)}
          >
            <option value="">All Tenants</option>
            {tenants.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Agent */}
        <div className="filter-group">
          <label htmlFor="filter-agent">🤖 Agent Role</label>
          <select
            id="filter-agent"
            value={filters.agent}
            onChange={(e) => handleFilterChange('agent', e.target.value)}
          >
            <option value="">All Agents</option>
            {agents.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* Provider */}
        <div className="filter-group">
          <label htmlFor="filter-provider">🔌 Provider</label>
          <select
            id="filter-provider"
            value={filters.provider}
            onChange={(e) => handleFilterChange('provider', e.target.value)}
          >
            <option value="">All Providers</option>
            {providers.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div className="filter-group">
          <label htmlFor="filter-model">🧠 Model</label>
          <select
            id="filter-model"
            value={filters.model}
            onChange={(e) => handleFilterChange('model', e.target.value)}
          >
            <option value="">All Models</option>
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Action Button */}
        <div className="filter-actions">
          <button 
            id="btn-reset-filters" 
            className="btn btn-secondary" 
            onClick={resetFilters}
          >
            🔄 Reset
          </button>
        </div>
      </div>
    </div>
  );
};
