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
      cpuUsage: `${metrics.system.cpuUsage.toFixed(2)}%`,
      memoryUsage: `${metrics.system.memoryUsage.toFixed(2)}MB`,
      diskUsage: `${metrics.system.diskUsage.toFixed(2)}%`,
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

/**
 * Start metrics collection interval
 */
export function startMetricsCollection(intervalMs = 60000) {
  // Collect system metrics every 5 seconds
  setInterval(async () => {
    const cpuUsage = process.cpuUsage().user / 1000;
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    const diskUsage = await getDiskUsage();
    const activeConnections = getActiveConnections();

    recordSystemMetrics(cpuUsage, memoryUsage, diskUsage, activeConnections);
  }, 5000);

  // Export metrics every intervalMs
  setInterval(() => {
    exportMetrics();
  }, intervalMs);

  console.log(`Metrics collection started (export interval: ${intervalMs}ms)`);
}

/**
 * Get disk usage
 */
async function getDiskUsage() {
  try {
    const fs = await import('node:fs/promises');
    const stats = await fs.stat('.');
    const total = stats.size;
    const used = getDirectorySize('.');
    return ((used / total) * 100).toFixed(2);
  } catch (error) {
    return '0.00';
  }
}

/**
 * Get directory size
 */
async function getDirectorySize(dir) {
  const fs = await import('node:fs/promises');
  let size = 0;

  try {
    const files = await fs.readdir(dir, { withFileTypes: true });

    for (const file of files) {
      const path = join(dir, file.name);
      if (file.isDirectory()) {
        size += await getDirectorySize(path);
      } else {
        const stats = await fs.stat(path);
        size += stats.size;
      }
    }
  } catch (error) {
    // Ignore errors for individual files
  }

  return size;
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
