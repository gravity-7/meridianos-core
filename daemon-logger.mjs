/**
 * daemon-logger — rotating file logger for the AIOS daemon.
 *
 * Mirrors every log line to both `console` and a size-capped rotating file so
 * that daemon output is diagnosable even when the process is launched by a
 * Windows scheduled task (no attached console).
 *
 * Rotation strategy: single backup.  When the live file exceeds `maxBytes`,
 * the live file is renamed to `<name>.1` (overwriting any prior backup) and a
 * fresh live file is opened.  This keeps total disk usage bounded at ~2×maxBytes
 * with no external dependencies.
 *
 * Design contract:
 *   • Never throws — a logging failure must never crash the daemon.
 *   • All writes are synchronous (fs.appendFileSync) — no async queue to lose
 *     entries on crash.
 *   • The module is side-effect-free at import time; call createRotatingLogger()
 *     to get an instance.
 */

import { appendFileSync, renameSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const LOG_FILE_NAME    = 'daemon.log';

/**
 * Format a log line with an ISO timestamp prefix.
 * @param {string} level  'INFO' | 'ERROR'
 * @param {string} tag    subsystem tag, e.g. 'watchdog'
 * @param {string} msg    human-readable message
 * @returns {string}      ready-to-append line (no trailing newline)
 */
function formatLine(level, tag, msg) {
  return `${new Date().toISOString()} [${level}] [aios:${tag}] ${msg}`;
}

/**
 * Serialise an error or arbitrary value to a short string.
 * @param {unknown} err
 * @returns {string}
 */
function serializeError(err) {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

/**
 * Create a rotating file logger.
 *
 * @param {object} [opts]
 * @param {string} [opts.logDir]    directory to write daemon.log (default: config.repoRoot/.ai/logs)
 * @param {number} [opts.maxBytes]  rotate when file exceeds this size (default: 2 MiB)
 * @param {object} opts.config      the injected AiosConfig (REQUIRED); only matters when `logDir`
 *                                  itself is omitted.
 * @returns {{ log(tag:string, msg:string):void,
 *             error(tag:string, msg:string, err?:unknown):void,
 *             close():void }}
 */
export function createRotatingLogger({ logDir = undefined, maxBytes = DEFAULT_MAX_BYTES, config } = {}) {
  logDir = logDir ?? join(config.repoRoot, '.ai', 'logs');
  const livePath   = join(logDir, LOG_FILE_NAME);
  const backupPath = join(logDir, `${LOG_FILE_NAME}.1`);

  /** Ensure log directory exists (best-effort). */
  function ensureDir() {
    try { if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  }

  /** Rotate if the live file is at or above the size cap. */
  function maybeRotate() {
    try {
      const size = statSync(livePath).size;
      if (size >= maxBytes) {
        renameSync(livePath, backupPath);
      }
    } catch { /* file doesn't exist yet or stat failed — no rotation needed */ }
  }

  /** Append a pre-formatted line to the live log file. Never throws. */
  function appendLine(line) {
    try {
      ensureDir();
      maybeRotate();
      appendFileSync(livePath, line + '\n', 'utf8');
    } catch { /* logging must never crash the daemon */ }
  }

  return {
    /**
     * Log an informational message.  Mirrors to console.log.
     * @param {string} tag  subsystem tag
     * @param {string} msg  message text
     */
    log(tag, msg) {
      const line = formatLine('INFO', tag, msg);
      console.log(line);
      appendLine(line);
    },

    /**
     * Log an error.  Mirrors to console.error.  Appends serialized error if provided.
     * @param {string}  tag  subsystem tag
     * @param {string}  msg  message text
     * @param {unknown} [err] the thrown error or rejection reason
     */
    error(tag, msg, err) {
      const detail = err != null ? ` — ${serializeError(err)}` : '';
      const line   = formatLine('ERROR', tag, `${msg}${detail}`);
      console.error(line);
      appendLine(line);
    },

    /**
     * Flush / close.  Currently a no-op (synchronous writes need no flush),
     * but provided so callers can hook into graceful shutdown without coupling
     * to the implementation.
     */
    close() { /* synchronous writes need no explicit flush */ },
  };
}
