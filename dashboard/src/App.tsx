import React, { useState, useEffect, useRef } from 'react';
import { Navigation } from './components/Navigation';
import { FiltersBar } from './components/FiltersBar';
import { MetricsGrid } from './components/MetricsGrid';
import { SpendChart } from './components/SpendChart';
import { BreakdownSection } from './components/BreakdownSection';
import { LiveStreamLog } from './components/LiveStreamLog';
import { DashboardFilters, MetricsSummary, SpendOverTimePoint, MetricsBreakdown, TokenEvent } from './types';
import { getMockSummary, getMockSpendOverTime, getMockBreakdown, MockRequestStream } from './api/mockApi';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'livestream'>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  
  // Filter States (initialized to 7 days trailing interval)
  const [filters, setFilters] = useState<DashboardFilters>({
    tenant: '',
    agent: '',
    provider: '',
    model: '',
    since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    until: '',
  });

  // Summary Metrics States
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [spendSeries, setSpendSeries] = useState<SpendOverTimePoint[]>([]);
  const [breakdown, setBreakdown] = useState<MetricsBreakdown | null>(null);
  
  // Loading indicators
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  // Live Stream Logs State
  const [streamEvents, setStreamEvents] = useState<TokenEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const streamRef = useRef<MockRequestStream | null>(null);

  // Apply Theme Toggle to Document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Fetch summary and breakdown stats when filters modify
  useEffect(() => {
    setLoadingSummary(true);
    getMockSummary(filters).then(data => {
      setSummary(data);
      setLoadingSummary(false);
    });

    setLoadingBreakdown(true);
    getMockBreakdown(filters).then(data => {
      setBreakdown(data);
      setLoadingBreakdown(false);
    });
  }, [filters]);

  // Fetch spend series stats (handles hourly bucket automatically for shorter ranges)
  useEffect(() => {
    setLoadingChart(true);
    const rangeMs = filters.since 
      ? Date.now() - new Date(filters.since).getTime() 
      : 10 * 24 * 60 * 60 * 1000;
    
    const interval = rangeMs <= 2 * 24 * 60 * 60 * 1000 ? 'hour' : 'day';

    getMockSpendOverTime(filters, interval).then(data => {
      setSpendSeries(data);
      setLoadingChart(false);
    });
  }, [filters]);

  // SSE Stream Management
  useEffect(() => {
    if (isStreaming) {
      const stream = new MockRequestStream((newEvent) => {
        setStreamEvents(prev => {
          // Add new event at the top, limit stream list size to 50 records
          const updated = [newEvent, ...prev];
          return updated.slice(0, 50);
        });
      });
      streamRef.current = stream;
      stream.start();
    } else {
      if (streamRef.current) {
        streamRef.current.stop();
        streamRef.current = null;
      }
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.stop();
      }
    };
  }, [isStreaming]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleToggleStreaming = () => {
    setIsStreaming(prev => !prev);
  };

  const handleClearLogs = () => {
    setStreamEvents([]);
  };

  return (
    <div className="wrap">
      <Navigation 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        theme={theme}
        toggleTheme={toggleTheme}
      />
      
      <FiltersBar filters={filters} onChange={setFilters} />

      <MetricsGrid summary={summary} loading={loadingSummary} />

      {activeTab === 'dashboard' ? (
        <>
          <SpendChart data={spendSeries} loading={loadingChart} />
          <BreakdownSection breakdown={breakdown} loading={loadingBreakdown} />
        </>
      ) : (
        <LiveStreamLog 
          events={streamEvents} 
          isStreaming={isStreaming} 
          onToggleStreaming={handleToggleStreaming} 
          onClearLogs={handleClearLogs}
        />
      )}
    </div>
  );
};
