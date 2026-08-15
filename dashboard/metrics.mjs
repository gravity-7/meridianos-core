/**
 * Performance Monitoring and Metrics Collection
 * Tracks API response times, database queries, and system resources
 */

import { performance } from 'node:perf_hooks';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const METRICS_PATH = join(HERE, '..', '.ai', 'metrics.json');

// Metrics storage
const metrics = {
  api: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    responseTimeDistribution: {
      '0-100ms': 0,
      '100-500ms': 0,
      '500-1000ms': 0,
      '1000-5000ms': 0,
      '5000ms+': 0
    }
  },
  database: {
    totalQueries: 0,
    slowQueries: 0,
    queryTimeDistribution: {
      '0-10ms': 0,
      '10-50ms': 0,
      '50-100ms': 0,
      '100-500ms': 0,
      '500ms+': 0
    }
  },
  system: {
    cpuUsage: 0,
    memoryUsage: 0,
    diskUsage: 0,
    activeConnections: 0
  },
  endpoints: {}
};

// Performance tracking
const endpointTimings = new Map();

/**
 * Record API request timing
 */
export function recordApiRequest(endpoint, duration, success) {
  metrics.api.totalRequests++;
  if (success) {
    metrics.api.successfulRequests++;
  } else {
    metrics.api.failedRequests++;
  }

  // Update response time distribution
  if (duration < 100) metrics.api.responseTimeDistribution['0-100ms']++;
  else if (duration < 500) metrics.api.responseTimeDistribution['100-500ms']++;
  else if (duration < 1000) metrics.api.responseTimeDistribution['500-1000ms']++;
  else if (duration < 5000) metrics.api.responseTimeDistribution['1000-5000ms']++;
  else metrics.api.responseTimeDistribution['5000ms+']++;

  // Track endpoint-specific metrics
  if (!metrics.endpoints[endpoint]) {
    metrics.endpoints[endpoint] = {
      totalRequests: 0,
      successfulRequests: 0,
      averageResponseTime: 0,
      responseTimeDistribution: {
        '0-100ms': 0,
        '100-500ms': 0,
        '500-1000ms': 0,
        '1000-5000ms': 0,
        '5000ms+': 0
      }
    };
  }

  const endpointMetrics = metrics.endpoints[endpoint];
  endpointMetrics.totalRequests++;
  if (success) endpointMetrics.successfulRequests++;

  if (duration < 100) endpointMetrics.responseTimeDistribution['0-100ms']++;
  else if (duration < 500) endpointMetrics.responseTimeDistribution['100-500ms']++;
  else if (duration < 1000) endpointMetrics.responseTimeDistribution['500-1000ms']++;
  else if (duration < 5000) endpointMetrics.responseTimeDistribution['1000-5000ms']++;
  else endpointMetrics.responseTimeDistribution['5000ms+']++;

  // Update average response time
  endpointMetrics.averageResponseTime =
    (endpointMetrics.averageResponseTime * (endpointMetrics.totalRequests - 1) + duration) /
    endpointMetrics.totalRequests;
}

/**
 * Record database query timing
 */
export function recordDatabaseQuery(duration, isSlow = false) {
  metrics.database.totalQueries++;

  if (isSlow) {
    metrics.database.slowQueries++;
  }

  // Update query time distribution
  if (duration < 10) metrics.database.queryTimeDistribution['0-10ms']++;
  else if (duration < 50) metrics.database.queryTimeDistribution['10-50ms']++;
  else if (duration < 100) metrics.database.queryTimeDistribution['50-100ms']++;
  else if (duration < 500) metrics.database.queryTimeDistribution['100-500ms']++;
  else metrics.database.queryTimeDistribution['500ms+']++;
}

/**
 * Record system metrics
 */
export function recordSystemMetrics(cpuUsage, memoryUsage, diskUsage, activeConnections) {
  metrics.system.cpuUsage = cpuUsage;
  metrics.system.memoryUsage = memoryUsage;
  metrics.system.diskUsage = diskUsage;
  metrics.system.activeConnections = activeConnections;
}

/**
 * Get current metrics
 */
export function getMetrics() {
  return JSON.parse(JSON.stringify(metrics));
}

/**
 * Get metrics summary
 */
export function getMetricsSummary() {
  const totalRequests = metrics.api.totalRequests;
  const successRate = totalRequests > 0
    ? ((metrics.api.successfulRequests / totalRequests) * 100).toFixed(2)
    : 0;
  const avgResponseTime = totalRequests > 0
    ? (metrics.api.averageResponseTime / totalRequests).toFixed(2)
    : 0;

  // Defensive numeric coercion: system collectors must never be able to poison the summary with a
  // non-number (a string diskUsage previously crashed here — `diskUsage.toFixed is not a function`).
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  return {
    api: {
      totalRequests,
      successfulRequests: metrics.api.successfulRequests,
      failedRequests: metrics.api.failedRequests,
      successRate: `${successRate}%`,
      averageResponseTime: `${avgResponseTime}ms`,
      responseTimeDistribution: metrics.api.responseTimeDistribution
    },
    database: {
      totalQueries: metrics.database.totalQueries,
      slowQueries: metrics.database.slowQueries,
      queryTimeDistribution: metrics.database.queryTimeDistribution
    },
    system: {
      cpuUsage: `${num(metrics.system.cpuUsage).toFixed(2)}%`,
      memoryUsage: `${num(metrics.system.memoryUsage).toFixed(2)}MB`,
      diskUsage: `${num(metrics.system.diskUsage).toFixed(2)}%`,
      activeConnections: metrics.system.activeConnections
    },
    endpoints: metrics.endpoints
  };
}

/**
 * Reset metrics
 */
export function resetMetrics() {
  Object.keys(metrics).forEach(key => {
    if (key === 'endpoints') {
      metrics.endpoints = {};
    } else {
      metrics[key] = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        responseTimeDistribution: {
          '0-100ms': 0,
          '100-500ms': 0,
          '500-1000ms': 0,
          '1000-5000ms': 0,
          '5000ms+': 0
        }
      };
    }
  });
}

/**
 * Export metrics to file
 */
export async function exportMetrics(filename = METRICS_PATH) {
  const data = JSON.stringify(metrics, null, 2);
  try {
    // Ensure directory exists
    const dir = dirname(filename);
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filename, data, 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to export metrics:', error);
    return false;
  }
}

// Handles for the two background intervals startMetricsCollection() creates, so a later call
// (or stopMetricsCollection()) can clear the previous pair instead of stacking duplicates.
let systemMetricsTimer = null;
let exportMetricsTimer = null;

/**
 * Start metrics collection interval. Idempotent per-process: calling this again (e.g. a test
 * that constructs the dashboard server more than once) clears the previous pair of intervals
 * first, rather than leaking another set on every call.
 *
 * Both intervals are `.unref()`d — they must never be the reason a Node process can't exit.
 * A long-running daemon keeps them firing for as long as the process is otherwise alive (unref
 * only affects whether the timer alone counts as "work" keeping the event loop open); a test
 * process that spins up a dashboard server and closes everything else can now actually exit,
 * instead of hanging until an external timeout kills it (this was silently breaking `node --test`
 * runs against any server built with createDashboardServer, including tests/server.test.mjs).
 */
export function startMetricsCollection(intervalMs = 60000) {
  stopMetricsCollection();

  // Collect system metrics every 5 seconds
  systemMetricsTimer = setInterval(async () => {
    const cpuUsage = process.cpuUsage().user / 1000;
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    const diskUsage = await getDiskUsage();
    const activeConnections = getActiveConnections();

    recordSystemMetrics(cpuUsage, memoryUsage, diskUsage, activeConnections);
  }, 5000);
  systemMetricsTimer.unref();

  // Export metrics every intervalMs
  exportMetricsTimer = setInterval(() => {
    exportMetrics();
  }, intervalMs);
  exportMetricsTimer.unref();

  console.log(`Metrics collection started (export interval: ${intervalMs}ms)`);
}

/** Stop both background intervals started by startMetricsCollection(), if running. */
export function stopMetricsCollection() {
  if (systemMetricsTimer) { clearInterval(systemMetricsTimer); systemMetricsTimer = null; }
  if (exportMetricsTimer) { clearInterval(exportMetricsTimer); exportMetricsTimer = null; }
}

/**
 * Get disk usage.
 *
 * Returns a NUMBER (percent used). This previously recursively walked the ENTIRE current
 * directory (including node_modules/.git) every 5 seconds and — because the walk was never
 * awaited — returned the string "NaN". That pinned a CPU core, and the string then crashed
 * `getMetricsSummary()` (`diskUsage.toFixed is not a function`), which in turn left the
 * `/api/metrics` response hanging and leaked the dashboard server's keep-alive connection
 * (node --test never exited). `fs.statfs` is a single cheap syscall that reports the real
 * filesystem the cwd lives on, with no recursive scan.
 */
async function getDiskUsage() {
  try {
    const fs = await import('node:fs/promises');
    const s = await fs.statfs('.');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    if (!total) return 0;
    return Number(((1 - free / total) * 100).toFixed(2));
  } catch {
    return 0;
  }
}

/**
 * Get active connections
 */
function getActiveConnections() {
  // This is a simplified implementation
  // In production, you might want to track actual database connections
  return 1; // Default to 1 for now
}

/**
 * Middleware for tracking API request timing
 */
export function metricsMiddleware(req, res, next) {
  const startTime = performance.now();
  const endpoint = req.method + ' ' + req.url;

  res.on('finish', () => {
    const duration = performance.now() - startTime;
    const success = res.statusCode < 400;
    recordApiRequest(endpoint, duration, success);
  });

  next();
}

/**
 * Get performance report
 */
export function getPerformanceReport() {
  const summary = getMetricsSummary();

  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    summary,
    alerts: generateAlerts(summary)
  };
}

/**
 * Generate performance alerts
 */
function generateAlerts(summary) {
  const alerts = [];

  // Check for slow API responses
  const slowApiRate = summary.api.successfulRequests > 0
    ? (summary.api.responseTimeDistribution['5000ms+'] / summary.api.successfulRequests) * 100
    : 0;

  if (slowApiRate > 5) {
    alerts.push({
      type: 'warning',
      message: `High rate of slow API responses (${slowApiRate.toFixed(2)}% > 5%)`,
      severity: 'medium'
    });
  }

  // Check for database slow queries
  const slowQueryRate = summary.database.totalQueries > 0
    ? (summary.database.slowQueries / summary.database.totalQueries) * 100
    : 0;

  if (slowQueryRate > 10) {
    alerts.push({
      type: 'warning',
      message: `High rate of slow database queries (${slowQueryRate.toFixed(2)}% > 10%)`,
      severity: 'high'
    });
  }

  // Check for high CPU usage
  if (parseFloat(summary.system.cpuUsage) > 80) {
    alerts.push({
      type: 'critical',
      message: `High CPU usage (${summary.system.cpuUsage})`,
      severity: 'high'
    });
  }

  // Check for high memory usage
  if (parseFloat(summary.system.memoryUsage) > 80 * 1024) { // 80MB
    alerts.push({
      type: 'warning',
      message: `High memory usage (${summary.system.memoryUsage}MB)`,
      severity: 'medium'
    });
  }

  return alerts;
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body);
}

/**
 * Render the current metrics in Prometheus text exposition format (code-review follow-up: "Add
 * metrics export for monitoring") — the de-facto standard scrape format, so this daemon can be
 * added to an existing Prometheus/Grafana setup with zero extra glue. `extra` lets callers (e.g.
 * dashboard/server.mjs) fold in counters this module doesn't itself track — webhook delivery
 * counts, cloud metadata report counts — without this module needing to know about Phase 7's
 * tables directly.
 * @param {{webhookDeliveries?: Record<string, number>, apiKeysActive?: number, cloudMetadataReports?: number}} [extra]
 */
export function toPrometheusText(extra = {}) {
  const summary = getMetricsSummary();
  const lines = [];

  lines.push('# HELP meridianos_api_requests_total Total API requests handled since daemon start.');
  lines.push('# TYPE meridianos_api_requests_total counter');
  lines.push(`meridianos_api_requests_total ${summary.api.totalRequests}`);

  lines.push('# HELP meridianos_api_requests_failed_total Total API requests that returned an error status.');
  lines.push('# TYPE meridianos_api_requests_failed_total counter');
  lines.push(`meridianos_api_requests_failed_total ${summary.api.failedRequests}`);

  lines.push('# HELP meridianos_api_response_time_bucket_total Requests by response-time bucket.');
  lines.push('# TYPE meridianos_api_response_time_bucket_total counter');
  for (const [bucket, count] of Object.entries(summary.api.responseTimeDistribution)) {
    lines.push(`meridianos_api_response_time_bucket_total{bucket="${bucket}"} ${count}`);
  }

  lines.push('# HELP meridianos_process_uptime_seconds Daemon process uptime.');
  lines.push('# TYPE meridianos_process_uptime_seconds gauge');
  lines.push(`meridianos_process_uptime_seconds ${process.uptime().toFixed(0)}`);

  lines.push('# HELP meridianos_process_memory_bytes Resident heap usage.');
  lines.push('# TYPE meridianos_process_memory_bytes gauge');
  lines.push(`meridianos_process_memory_bytes ${process.memoryUsage().heapUsed}`);

  if (extra.apiKeysActive != null) {
    lines.push('# HELP meridianos_api_keys_active Currently active (non-revoked) public API keys.');
    lines.push('# TYPE meridianos_api_keys_active gauge');
    lines.push(`meridianos_api_keys_active ${extra.apiKeysActive}`);
  }

  if (extra.webhookDeliveries) {
    lines.push('# HELP meridianos_webhook_deliveries_total Webhook delivery attempts by outcome.');
    lines.push('# TYPE meridianos_webhook_deliveries_total counter');
    for (const [status, count] of Object.entries(extra.webhookDeliveries)) {
      lines.push(`meridianos_webhook_deliveries_total{status="${status}"} ${count}`);
    }
  }

  if (extra.cloudMetadataReports != null) {
    lines.push('# HELP meridianos_cloud_metadata_reports_total Metadata reports received by the cloud control plane.');
    lines.push('# TYPE meridianos_cloud_metadata_reports_total counter');
    lines.push(`meridianos_cloud_metadata_reports_total ${extra.cloudMetadataReports}`);
  }

  return lines.join('\n') + '\n';
}

// Export metrics endpoint handler
export function createMetricsEndpoint() {
  return async (req, res) => {
    if (req.method === 'GET') {
      const report = getPerformanceReport();
      send(res, 200, JSON.stringify(report));
    } else if (req.method === 'POST') {
      // Reset metrics
      resetMetrics();
      send(res, 200, JSON.stringify({ success: true, message: 'Metrics reset' }));
    } else {
      send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
    }
  };
}
