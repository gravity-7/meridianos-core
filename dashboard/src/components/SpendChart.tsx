import React, { useState } from 'react';
import { SpendOverTimePoint } from '../types';

interface SpendChartProps {
  data: SpendOverTimePoint[];
  loading: boolean;
}

export const SpendChart: React.FC<SpendChartProps> = ({ data, loading }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (loading || data.length === 0) {
    return (
      <div className="chart-card card">
        <h3 className="card-title">Spend & Usage Over Time</h3>
        <div className="chart-placeholder">
          {loading ? 'Aggregating usage metrics...' : 'No data in selected date range'}
        </div>
      </div>
    );
  }

  // Find max values for scaling
  const maxCost = Math.max(...data.map(d => d.costUsd), 0.01);
  const maxTokens = Math.max(...data.map(d => d.tokens), 1);

  // SVG dimensions
  const width = 800;
  const height = 220;
  const paddingLeft = 50;
  const paddingRight = 50;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const pointsCount = data.length;
  const colWidth = pointsCount > 1 ? chartWidth / (pointsCount - 1) : chartWidth;
  const barWidth = Math.max(2, Math.min(24, (chartWidth / pointsCount) * 0.6));

  const formatCost = (val: number) => {
    return `$${val.toFixed(4)}`;
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + 
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Generate bar coordinates for Cost
  const bars = data.map((d, index) => {
    const x = paddingLeft + (index * (chartWidth / Math.max(1, pointsCount - 1))) - (barWidth / 2);
    const barHeight = (d.costUsd / maxCost) * chartHeight;
    const y = height - paddingBottom - barHeight;
    return { x, y, width: barWidth, height: barHeight, val: d.costUsd, raw: d };
  });

  // Generate line path coordinates for Token Volume
  const linePoints = data.map((d, index) => {
    const x = paddingLeft + (index * (chartWidth / Math.max(1, pointsCount - 1)));
    const y = height - paddingBottom - ((d.tokens / maxTokens) * chartHeight);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="chart-card card" id="spend-chart-card">
      <div className="chart-header">
        <h3 className="card-title">Spend & Usage Volume</h3>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-color bar-color"></span> Cost (USD)</span>
          <span className="legend-item"><span className="legend-color line-color"></span> Tokens</span>
        </div>
      </div>

      <div className="svg-container">
        <svg viewBox={`0 0 ${width} ${height}`} className="spend-svg">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = paddingTop + r * chartHeight;
            const costVal = maxCost * (1 - r);
            return (
              <g key={i} className="grid-group">
                <line 
                  x1={paddingLeft} 
                  y1={y} 
                  x2={width - paddingRight} 
                  y2={y} 
                  className="grid-line" 
                />
                <text 
                  x={paddingLeft - 8} 
                  y={y + 4} 
                  className="axis-text axis-left"
                >
                  ${costVal.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Render Bars (Cost) */}
          {bars.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.width}
              height={Math.max(2, b.height)}
              className={`chart-bar ${hoveredIndex === i ? 'bar-hovered' : ''}`}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}

          {/* Render Line (Tokens) */}
          {data.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--color-warning)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={linePoints}
              className="chart-line"
            />
          )}

          {/* Render Line Dots */}
          {data.length > 1 && data.map((d, index) => {
            const x = paddingLeft + (index * (chartWidth / Math.max(1, pointsCount - 1)));
            const y = height - paddingBottom - ((d.tokens / maxTokens) * chartHeight);
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r={hoveredIndex === index ? 5 : 3.5}
                className={`chart-dot ${hoveredIndex === index ? 'dot-hovered' : ''}`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}

          {/* Date labels at bottom */}
          {data.length > 0 && [0, Math.floor(pointsCount / 2), pointsCount - 1].map((idx) => {
            if (idx >= pointsCount || idx < 0) return null;
            const x = paddingLeft + (idx * (chartWidth / Math.max(1, pointsCount - 1)));
            const align = idx === 0 ? 'start' : (idx === pointsCount - 1 ? 'end' : 'middle');
            return (
              <text
                key={idx}
                x={x}
                y={height - 8}
                textAnchor={align}
                className="axis-text date-label"
              >
                {new Date(data[idx].timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            );
          })}
        </svg>

        {/* Dynamic Tooltip */}
        {hoveredIndex !== null && data[hoveredIndex] && (
          <div 
            className="chart-tooltip"
            style={{
              left: `${(hoveredIndex / (data.length - 1)) * 75 + 10}%`,
              top: '10%'
            }}
          >
            <div className="tooltip-time">{formatDate(data[hoveredIndex].timestamp)}</div>
            <div className="tooltip-row">
              <span className="dot bar-color"></span> Cost: <strong>{formatCost(data[hoveredIndex].costUsd)}</strong>
            </div>
            <div className="tooltip-row">
              <span className="dot line-color"></span> Tokens: <strong>{data[hoveredIndex].tokens.toLocaleString()}</strong>
            </div>
            <div className="tooltip-row">
              <span className="dot bg-neutral"></span> Reqs: <strong>{data[hoveredIndex].requests}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
