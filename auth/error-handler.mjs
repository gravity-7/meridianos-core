/**
 * Error handling and logging for multi-tenant operations
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', '.ai', 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log levels
 */
export const LogLevel = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG'
};

/**
 * Format log entry
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} context - Additional context
 * @returns {string} Formatted log entry
 */
function formatLogEntry(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level}] ${message}${contextStr}\n`;
}

/**
 * Write to log file
 * @param {string} filename - Log filename
 * @param {string} entry - Log entry
 */
function writeLog(filename, entry) {
  const logPath = path.join(LOG_DIR, filename);
  fs.appendFileSync(logPath, entry);
}

/**
 * Log error
 * @param {string} message - Error message
 * @param {Error|Object} error - Error object or context
 * @param {Object} context - Additional context
 */
export function logError(message, error = null, context = {}) {
  const errorContext = {
    ...context,
    error: error ? {
      message: error.message,
      stack: error.stack,
      code: error.code
    } : null
  };

  const entry = formatLogEntry(LogLevel.ERROR, message, errorContext);
  writeLog('error.log', entry);
  console.error(entry.trim());
}

/**
 * Log warning
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
export function logWarn(message, context = {}) {
  const entry = formatLogEntry(LogLevel.WARN, message, context);
  writeLog('warn.log', entry);
  console.warn(entry.trim());
}

/**
 * Log info
 * @param {string} message - Info message
 * @param {Object} context - Additional context
 */
export function logInfo(message, context = {}) {
  const entry = formatLogEntry(LogLevel.INFO, message, context);
  writeLog('info.log', entry);
  console.log(entry.trim());
}

/**
 * Log debug
 * @param {string} message - Debug message
 * @param {Object} context - Additional context
 */
export function logDebug(message, context = {}) {
  if (process.env.DEBUG === 'true') {
    const entry = formatLogEntry(LogLevel.DEBUG, message, context);
    writeLog('debug.log', entry);
    console.debug(entry.trim());
  }
}

/**
 * Multi-tenant error class
 */
export class MultiTenantError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = 'MultiTenantError';
    this.code = code;
    this.context = context;
  }
}

/**
 * Error codes
 */
export const ErrorCode = {
  // Authentication errors
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',

  // Authorization errors
  AUTHZ_INSUFFICIENT_PERMISSIONS: 'AUTHZ_INSUFFICIENT_PERMISSIONS',
  AUTHZ_FORBIDDEN: 'AUTHZ_FORBIDDEN',

  // Project errors
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_ALREADY_EXISTS: 'PROJECT_ALREADY_EXISTS',
  PROJECT_INVALID_STATE: 'PROJECT_INVALID_STATE',
  PROJECT_START_FAILED: 'PROJECT_START_FAILED',
  PROJECT_STOP_FAILED: 'PROJECT_STOP_FAILED',

  // User errors
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_INACTIVE: 'USER_INACTIVE',

  // Billing errors
  BILLING_LICENSE_INVALID: 'BILLING_LICENSE_INVALID',
  BILLING_LICENSE_EXPIRED: 'BILLING_LICENSE_EXPIRED',
  BILLING_FEATURE_NOT_AVAILABLE: 'BILLING_FEATURE_NOT_AVAILABLE',
  BILLING_LIMIT_EXCEEDED: 'BILLING_LIMIT_EXCEEDED',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Internal errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR'
};

/**
 * Create error response
 * @param {MultiTenantError|Error} error - Error object
 * @returns {Object} Error response
 */
export function createErrorResponse(error) {
  if (error instanceof MultiTenantError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        context: error.context
      }
    };
  }

  return {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: error.message || 'An unexpected error occurred'
    }
  };
}

/**
 * Wrap async function with error handling
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError('Unhandled error in async function', error, { function: fn.name });
      throw error;
    }
  };
}

/**
 * Express-style error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
export function errorHandler(err, req, res, next) {
  logError('Request error', err, {
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    projectId: req.params?.project_id
  });

  const statusCode = getStatusCode(err);
  const response = createErrorResponse(err);

  res.status(statusCode).json(response);
}

/**
 * Get HTTP status code from error
 * @param {Error} err - Error object
 * @returns {number} HTTP status code
 */
function getStatusCode(err) {
  if (err instanceof MultiTenantError) {
    switch (err.code) {
      case ErrorCode.AUTH_INVALID_CREDENTIALS:
      case ErrorCode.AUTH_TOKEN_EXPIRED:
      case ErrorCode.AUTH_TOKEN_INVALID:
        return 401;
      case ErrorCode.AUTHZ_INSUFFICIENT_PERMISSIONS:
      case ErrorCode.AUTHZ_FORBIDDEN:
        return 403;
      case ErrorCode.PROJECT_NOT_FOUND:
      case ErrorCode.USER_NOT_FOUND:
        return 404;
      case ErrorCode.PROJECT_ALREADY_EXISTS:
      case ErrorCode.USER_ALREADY_EXISTS:
        return 409;
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_INPUT:
        return 400;
      default:
        return 500;
    }
  }

  return 500;
}