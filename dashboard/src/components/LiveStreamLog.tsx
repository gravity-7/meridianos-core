import React, { useState } from 'react';
import { TokenEvent } from '../types';

interface LiveStreamLogProps {
  events: TokenEvent[];
  isStreaming: boolean;
  onToggleStreaming: () => void;
  onClearLogs: () => void;
}

export const LiveStreamLog: React.FC<LiveStreamLogProps> = ({
  events,
  isStreaming,
  onToggleStreaming,
  onClearLogs,
}) => {
  const [selectedEvent, setSelectedEvent] = useState<TokenEvent | null>(null);

  const getStatusBadge = (decision: string, status?: number) => {
    if (decision === 'deny') return <span className="badge b-danger">DENIED (CAP)</span>;
    if (!status) return <span className="badge b-muted">UNKNOWN</span>;
    if (status === 200) return <span className="badge b-ok">200 OK</span>;
    if (status === 429) return <span className="badge b-warn">429 LIMIT</span>;
    return <span className="badge b-danger">{status} ERR</span>;
  };

  const getLatencyDisplay = (latency?: number) => {
    if (latency === undefined) return '—';
    return `${latency}ms`;
  };

  const getCostDisplay = (cost?: number) => {
    if (cost === undefined) return '—';
    if (cost === 0) return '$0.00';
    return `$${cost.toFixed(4)}`;
  };

  const getTokensDisplay = (tokens?: number) => {
    if (tokens === undefined) return '—';
    return tokens.toLocaleString();
  };

  return (
    <div className="livestream-container card" id="livestream-section">
      <div className="livestream-header">
        <div className="livestream-title-group">
          <h3 className="card-title">Live Request Logger</h3>
          <div className={`status-indicator ${isStreaming ? 'pulse-green' : 'gray'}`}>
            {isStreaming ? 'Streaming Live' : 'Paused'}
          </div>
        </div>
        <div className="livestream-actions">
          <button 
            id="btn-toggle-stream"
            className={`btn ${isStreaming ? 'btn-secondary' : 'btn-primary'}`} 
            onClick={onToggleStreaming}
          >
            {isStreaming ? '⏸️ Pause Stream' : '▶️ Resume Stream'}
          </button>
          <button 
            id="btn-clear-logs"
            className="btn btn-danger" 
            onClick={onClearLogs}
          >
            🗑️ Clear Logs
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="log-table" id="live-log-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Tenant</th>
              <th>Agent</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Tokens</th>
              <th>Cost (USD)</th>
              <th>Latency</th>
              <th>Status</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, index) => (
              <tr key={e.id || index} className={e.enforcementDecision === 'deny' ? 'row-denied' : ''}>
                <td className="mono text-nowrap">
                  {new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </td>
                <td className="font-semibold">{e.tenant}</td>
                <td><span className="agent-badge">{e.agent}</span></td>
                <td className="font-capitalize">{e.provider}</td>
                <td><span className="model-tag mono">{e.model}</span></td>
                <td className="mono text-right">{getTokensDisplay(e.totalTokens)}</td>
                <td className="mono text-right font-semibold">{getCostDisplay(e.costUsd)}</td>
                <td className="mono text-right">{getLatencyDisplay(e.latencyMs)}</td>
                <td>{getStatusBadge(e.enforcementDecision, e.upstreamStatus)}</td>
                <td>
                  <button 
                    className="btn-link" 
                    onClick={() => setSelectedEvent(e)}
                  >
                    View JSON
                  </button>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={10} className="table-empty">
                  {isStreaming ? 'Waiting for incoming requests flowing through the gateway...' : 'Streaming paused. Resume to listen for requests.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* JSON Payload Modal */}
      {selectedEvent && (
        <div className="modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Request Details: {selectedEvent.id}</h3>
              <button className="close-btn" onClick={() => setSelectedEvent(null)}>×</button>
            </div>
            <div className="modal-body">
              <pre className="json-display">
                {JSON.stringify(selectedEvent, null, 2)}
              </pre>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
