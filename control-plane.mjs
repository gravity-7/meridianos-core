/**
 * control-plane — the L1 (single-machine, single-process) supervisor over N declarative project
 * records (card C5, ADR 0001 D3.2). One operator, one process, many projects: `add()` turns a
 * DomainPlugin record (card C2's `domain-record.mjs` contract) into a fully-isolated AIOS instance
 * — its own `createAios({root, domain})` (own state store, own worktree root, own policy.yaml, own
 * tenant label) — and `tickAll()` runs ONE supervisor pass over every registered project.
 *
 * Isolation model:
 *   - PER-PROJECT (nothing shared): the AIOS config `createAios` returns — `resolvePaths` derives
 *     every path (dbPath, policyPath, worktreeRoot, ...) from THAT project's own `root`, so two
 *     projects registered here never read/write the same file. config.mjs already guarantees zero
 *     shared mutable module state for this (see its own doc comment) — this module leans on that
 *     rather than reimplementing isolation.
 *   - SHARED (by design, the one exception): the `gateway` — a single sidecar assembled once
 *     (gateway/index.mjs's `assembleGateway`) and passed into `createControlPlane` unchanged.
 *     Cross-project separation on the shared ledger comes from the per-project `tenant` label
 *     (gateway/ledger.mjs's events are tenant-scoped rows in one ledger, not one ledger per tenant).
 *
 * `tickAll()` isolates failures PER PROJECT: one project's tick throwing is caught and reported as
 * that project's own `{ok:false, error}` Result — it never aborts or contaminates any other
 * project's tick in the same pass (AC4).
 *
 * L1 ONLY: same machine, same process, no containers, no Postgres, no live registry push/pull.
 * Those are later cards.
 */
import { validateDomainRecord, loadDomainRecord } from './domain-record.mjs';
import { createAios } from './config.mjs';
import { loadPolicy } from './budget.mjs';
import { openDb } from './db.mjs';
import { createProjectStore } from './project-store.mjs';
import { tick as watchdogTick } from './watchdog.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml-lite.mjs';
import { getActivityLogger } from './compliance/audit-log.mjs';
import { getTelemetryCollector } from './control-plane-telemetry.mjs';
import { watchPolicy, unwatchPolicy, getHotReloadedConfig } from './config-hot-reload.mjs';
import { backupDatabaseTimestamped, restoreDatabase } from './db-backup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** The tenant label for a project: an explicit `record.tenant` wins; otherwise fall back to the
 *  project's own `policy.yaml` (`policy.gateway.tenant`, the same field scheduler.mjs's
 *  `maybeStartGateway` reads at boot) — read via the project's OWN isolated `config`, never a
 *  shared one; a project with neither just uses its own name (still unique across the fleet, since
 *  `record.name` is the projectId). loadPolicy never throws — a missing/absent policy.yaml simply
 *  yields `{}`, so this works for a hermetic project with no policy file on disk. */
function deriveTenant(record, config) {
  if (isNonEmptyString(record.tenant)) return record.tenant;
  const policy = loadPolicy(undefined, config);
  return policy?.gateway?.tenant ?? record.name;
}

function toHandle(project) {
  return { id: project.id, name: project.name, root: project.root, tenant: project.tenant };
}

/**
 * The default `tick` implementation: one REAL watchdog cycle (reap + health + escalations, see
 * watchdog.mjs's `tick`) against the project's own on-disk state store, opened fresh and closed
 * again each pass (an MVP-simple choice — no long-lived per-project db handle to manage yet). The
 * shared `gateway` (when supplied) is forwarded alongside `config` for a future tick implementation
 * to use for metering; this default only reaps/reports and never launches an agent or touches the
 * network — L1 supervision, not L1 execution.
 */
function defaultTick({ config, gateway } = {}) {
  const db = openDb(undefined, config);
  try {
    const store = createProjectStore({ db, config });
    return watchdogTick(store, { config, ...(gateway ? { gateway } : {}) });
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
}

/**
 * Build a control plane over an initially-empty (or pre-seeded, via `projects`) fleet.
 *   - `projects` — optional array of records to `add()` immediately (same validation as a later
 *     `add()` call; a bad seed record throws just like a bad `add()` call would).
 *   - `gateway`  — the SHARED gateway sidecar (e.g. `assembleGateway(...)`'s return value), or
 *     `null` if this control plane runs with no gateway wired up yet.
 *   - `tick`     — injectable per-project tick function, `({config, gateway, project}) => result`.
 *     Defaults to `defaultTick` (real watchdog reap+report). Tests inject a stub.
 */
export function createControlPlane({ projects = [], gateway = null, tick = defaultTick } = {}) {
  const registry = new Map(); // id -> { id, name, root, tenant, aios }

  function add(record) {
    const { ok, errors } = validateDomainRecord(record);
    if (!ok) {
      throw new Error(`createControlPlane.add: invalid project record:\n  - ${errors.join('\n  - ')}`);
    }
    if (!isNonEmptyString(record.root)) {
      throw new Error('createControlPlane.add: invalid project record:\n  - root: required (non-empty string project root path)');
    }
    const id = record.name;
    if (registry.has(id)) {
      throw new Error(`createControlPlane.add: a project named "${id}" is already registered`);
    }

    // Compile the record into a DomainPlugin, then build a FULLY ISOLATED AIOS instance from it —
    // own state store, own worktree root, own policy.yaml, own tenant label. No shared mutable
    // state with any other registered project (config.mjs's own guarantee).
    const domain = loadDomainRecord(record);
    const aios = createAios({ root: record.root, domain });
    const tenant = deriveTenant(record, aios.config);

    registry.set(id, { id, name: record.name, root: record.root, tenant, aios });
    return id;
  }

  async function tickAll() {
    const results = [];
    for (const project of registry.values()) {
      try {
        const result = await tick({ config: project.aios.config, gateway, project: toHandle(project) });
        results.push({ id: project.id, ok: true, result });
      } catch (error) {
        results.push({ id: project.id, ok: false, error });
      }
    }
    return results;
  }

  function list() {
    return [...registry.values()].map(toHandle);
  }

  function remove(id) {
    return registry.delete(id);
  }

  for (const record of projects) add(record);

  return { add, tickAll, list, remove };
}

/**
 * Project Manager for Multi-Project Supervision
 * Extends control-plane with database-backed project lifecycle management
 */
export class ProjectManager {
  constructor(dbPath = path.join(__dirname, '.ai', 'control-plane.db')) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.processes = new Map(); // project_id -> { pid, process, startTime, restartCount, intentionalStop }
    this.restartHistory = new Map(); // project_id -> [timestamp, ...]
    this.restartTimeouts = new Map(); // project_id -> pending crash-auto-restart setTimeout handle
    this.watchedConfigPaths = new Set(); // config_path values with an active hot-reload watch
    this.ensureSchema();
    this.reconcileAfterCrash();
  }

  /**
   * Ensure the `projects` table exists with the columns this class relies on (template,
   * config_path, state_path, port, created_by, health_status, last_health_check, restart_count,
   * last_restart). `auth/user-store.mjs` also creates a `projects` table on the same db, for its own
   * project_users/invitations FKs — a much narrower one, missing every column above. Whichever of
   * the two constructors runs first against a fresh db wins the initial CREATE, so this backfills
   * any columns a narrower create left out via ALTER TABLE, keeping both callers safe regardless of
   * boot order instead of failing with "no such column" the first time a project is created.
   */
  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'stopped',
        created_at INTEGER NOT NULL
      )
    `);
    const existingColumns = new Set(this.db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name));
    const requiredColumns = {
      template: 'TEXT',
      config_path: 'TEXT',
      state_path: 'TEXT',
      port: 'INTEGER',
      created_by: 'TEXT',
      health_status: "TEXT NOT NULL DEFAULT 'unknown'",
      last_health_check: 'INTEGER',
      restart_count: 'INTEGER NOT NULL DEFAULT 0',
      last_restart: 'INTEGER',
      updated_at: 'INTEGER',
    };
    for (const [column, definition] of Object.entries(requiredColumns)) {
      if (!existingColumns.has(column)) {
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  /**
   * Reconcile project state after a control-plane crash/restart (T195 edge case). `this.processes`
   * is ALWAYS empty right after construction — no in-memory process handle survives a crash — so
   * any project whose DB row still says 'running' is stale: the control plane died (or was
   * killed) while that project was tracked, and there is no live handle to reconnect to. Without
   * this, a fresh ProjectManager would report a phantom 'running' project with no actual process
   * behind it. Marks those 'stopped'/'down' so callers (dashboard, watchdog) see accurate state
   * and can decide to restart them, and logs one activity event per reconciled project.
   * @returns {string[]} ids of projects reconciled
   */
  reconcileAfterCrash() {
    const stale = this.db.prepare("SELECT id FROM projects WHERE status = 'running'").all();
    if (stale.length === 0) return [];
    const now = Math.floor(Date.now() / 1000);
    const update = this.db.prepare(
      "UPDATE projects SET status = 'stopped', health_status = 'down', last_health_check = ? WHERE id = ?"
    );
    for (const { id } of stale) {
      update.run(now, id);
      getActivityLogger().log({
        project_id: id,
        action: 'project_reconciled_after_crash',
        details: { previous_status: 'running' }
      });
    }
    return stale.map((s) => s.id);
  }

  /**
   * Create a new project
   * @param {Object} projectData - Project data
   * @returns {Object} Created project
   */
  createProject(projectData) {
    const { name, template, config_path, state_path, created_by } = projectData;

    // Validate name
    if (!name || name.length < 1 || name.length > 100) {
      throw new Error('Project name must be 1-100 characters');
    }

    // Check if name already exists
    const existing = this.db.prepare('SELECT id FROM projects WHERE name = ?').get(name);
    if (existing) {
      throw new Error('Project name already exists');
    }

    // Generate UUID and allocate port
    const id = crypto.randomUUID();
    const port = this.allocatePort();

    // Create directories
    fs.mkdirSync(state_path, { recursive: true });

    // Apply template if provided
    if (template) {
      try {
        const loader = getTemplateLoader();
        loader.apply(template, state_path);
      } catch (err) {
        console.warn(`Failed to apply template ${template}:`, err);
      }
    }

    // Insert project. updated_at is required here even though ProjectManager itself never reads
    // it — auth/user-store.mjs creates its own narrower `projects` table (same db, for its
    // project_users/invitations FKs) with `updated_at INTEGER NOT NULL` and no default; whichever
    // of the two constructors runs first wins the initial CREATE TABLE (see ensureSchema() above),
    // so on that boot order this INSERT trips the NOT NULL constraint unless it's set explicitly.
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, status, template, config_path, state_path, port, created_at, updated_at, created_by, health_status, restart_count)
      VALUES (?, ?, 'stopped', ?, ?, ?, ?, ?, ?, ?, 'unknown', 0)
    `);

    stmt.run(id, name, template, config_path, state_path, port, now, now, created_by);

    getActivityLogger().log({
      user_id: created_by,
      project_id: id,
      action: 'project_create',
      details: { name, template }
    });
    getTelemetryCollector().record('project_create', { project_id: id, template: template ?? null });

    return this.getProject(id);
  }

  /**
   * Start a project
   * @param {string} projectId - Project ID
   * @returns {Object} Updated project
   */
  async startProject(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (project.status === 'running') {
      throw new Error('Project is already running');
    }

    // Spawn process
    const process = await this.spawnProcess(project);

    // Update status
    this.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('running', projectId);

    // Track process
    this.processes.set(projectId, {
      pid: process.pid,
      process,
      startTime: Date.now(),
      restartCount: 0,
      intentionalStop: false
    });

    // Setup process monitoring
    this.monitorProcess(projectId, process);

    // Hot-reload watch (T198): non-critical policy.yaml settings for this project apply live
    // from now on, without needing a restart of this spawned process.
    if (project.config_path) {
      watchPolicy(project.config_path);
      this.watchedConfigPaths.add(project.config_path);
    }

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_start',
      details: { pid: process.pid }
    });
    getTelemetryCollector().record('project_start', { project_id: projectId });

    return this.getProject(projectId);
  }

  /**
   * Stop a project
   * @param {string} projectId - Project ID
   * @returns {Object} Updated project
   */
  async stopProject(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (project.status !== 'running') {
      throw new Error('Project is not running');
    }

    // Cancel any crash auto-restart already scheduled by monitorProcess, so a stop that lands
    // during the 5s backoff window doesn't let the pending restart fire anyway.
    const pendingRestart = this.restartTimeouts.get(projectId);
    if (pendingRestart) {
      clearTimeout(pendingRestart);
      this.restartTimeouts.delete(projectId);
    }

    const procInfo = this.processes.get(projectId);
    if (procInfo) {
      // Mark this as an intentional stop BEFORE killing, so monitorProcess's 'exit' listener
      // (still attached to this same process object) knows to skip its auto-restart logic.
      procInfo.intentionalStop = true;

      // Send SIGTERM for graceful shutdown
      procInfo.process.kill('SIGTERM');

      // Wait up to 10 seconds for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running
          procInfo.process.kill('SIGKILL');
          resolve();
        }, 10000);

        procInfo.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.processes.delete(projectId);
    }

    // Update status
    this.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('stopped', projectId);

    if (project.config_path && this.watchedConfigPaths.has(project.config_path)) {
      unwatchPolicy(project.config_path);
      this.watchedConfigPaths.delete(project.config_path);
    }

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_stop',
      details: {}
    });
    getTelemetryCollector().record('project_stop', { project_id: projectId });

    return this.getProject(projectId);
  }

  /**
   * Restart a project
   * @param {string} projectId - Project ID
   * @returns {Object} Updated project
   */
  async restartProject(projectId) {
    await this.stopProject(projectId);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
    return this.startProject(projectId);
  }

  /**
   * Delete a project
   * @param {string} projectId - Project ID
   */
  async deleteProject(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (project.status === 'running') {
      throw new Error('Cannot delete running project. Stop it first.');
    }

    // Cleanup directories
    if (fs.existsSync(project.state_path)) {
      fs.rmSync(project.state_path, { recursive: true, force: true });
    }

    // Delete from database
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    // Clear process tracking
    const pendingRestart = this.restartTimeouts.get(projectId);
    if (pendingRestart) {
      clearTimeout(pendingRestart);
      this.restartTimeouts.delete(projectId);
    }
    const procInfo = this.processes.get(projectId);
    if (procInfo) {
      procInfo.intentionalStop = true;
    }
    this.processes.delete(projectId);
    this.restartHistory.delete(projectId);

    if (project.config_path && this.watchedConfigPaths.has(project.config_path)) {
      unwatchPolicy(project.config_path);
      this.watchedConfigPaths.delete(project.config_path);
    }

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_delete',
      details: {}
    });
  }

  /**
   * The current live snapshot of this project's hot-reloadable policy.yaml settings (T198).
   * Only meaningful while the project is running (hot-reload watching starts in `startProject`
   * and stops in `stopProject`/`deleteProject`) — returns `{}` for a project that was never
   * started or whose watch has since stopped.
   * @param {string} projectId
   * @returns {object}
   */
  getEffectiveConfig(projectId) {
    const project = this.getProject(projectId);
    if (!project || !project.config_path) return {};
    return getHotReloadedConfig(project.config_path);
  }

  /**
   * List all projects
   * @param {Object} filters - Optional filters
   * @returns {Array} List of projects
   */
  listProjects(filters = {}) {
    let query = 'SELECT * FROM projects';
    const params = [];

    if (filters.status) {
      query += ' WHERE status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get project health status
   * @param {string} projectId - Project ID
   * @returns {Object} Health status
   */
  async getProjectHealth(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const procInfo = this.processes.get(projectId);

    // HTTP heartbeat check
    let httpHealthy = false;
    if (project.status === 'running' && procInfo) {
      try {
        const response = await fetch(`http://localhost:${project.port}/health`, {
          signal: AbortSignal.timeout(5000)
        });
        httpHealthy = response.ok;
      } catch (error) {
        httpHealthy = false;
      }
    }

    // Resource metrics
    const metrics = this.getResourceMetrics(projectId);

    // Update health status in database
    const healthStatus = httpHealthy ? 'healthy' : (project.status === 'running' ? 'degraded' : 'down');
    this.db.prepare(`
      UPDATE projects SET health_status = ?, last_health_check = ? WHERE id = ?
    `).run(healthStatus, Math.floor(Date.now() / 1000), projectId);

    return {
      project_id: projectId,
      status: healthStatus,
      http_healthy: httpHealthy,
      process_running: procInfo !== null,
      metrics,
      last_check: new Date().toISOString()
    };
  }

  /**
   * Spawn a project process
   * @param {Object} project - Project object
   * @returns {Promise<ChildProcess>} Spawned process
   */
  async spawnProcess(project) {
    const { spawn } = await import('node:child_process');

    const env = {
      ...process.env,
      MERIDIANOS_PROJECT_ID: project.id,
      MERIDIANOS_PROJECT_NAME: project.name,
      MERIDIANOS_PORT: project.port.toString(),
      MERIDIANOS_CONFIG_PATH: project.config_path,
      MERIDIANOS_STATE_PATH: project.state_path
    };

    const process = spawn('node', ['daemon-entry.mjs'], {
      cwd: project.state_path,
      env,
      detached: false,
      stdio: 'pipe'
    });

    // Log output
    process.stdout.on('data', (data) => {
      console.log(`[${project.name}] ${data}`);
    });

    process.stderr.on('data', (data) => {
      console.error(`[${project.name}] ${data}`);
    });

    return process;
  }

  /**
   * Monitor a process for crashes and auto-restart
   * @param {string} projectId - Project ID
   * @param {ChildProcess} process - Process to monitor
   */
  monitorProcess(projectId, process) {
    process.on('exit', (code, signal) => {
      console.log(`Project ${projectId} exited with code ${code}, signal ${signal}`);

      // A deliberate stopProject()/deleteProject() call kills this same process object, which
      // also fires this listener. Skip auto-restart when the exit was intentional.
      const procInfo = this.processes.get(projectId);
      if (procInfo && procInfo.intentionalStop) {
        console.log(`Project ${projectId} exit was an intentional stop; skipping auto-restart.`);
        return;
      }

      // Check restart rate limit (max 3 per hour)
      const now = Date.now();
      const hourAgo = now - (60 * 60 * 1000);
      const recentRestarts = (this.restartHistory.get(projectId) || [])
        .filter(ts => ts > hourAgo);

      if (recentRestarts.length >= 3) {
        console.error(`Project ${projectId} exceeded restart rate limit. Stopping auto-restart.`);
        this.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('error', projectId);
        return;
      }

      // Auto-restart
      console.log(`Auto-restarting project ${projectId}...`);
      this.restartHistory.set(projectId, [...recentRestarts, now]);

      const timeoutHandle = setTimeout(async () => {
        this.restartTimeouts.delete(projectId);
        try {
          await this.startProject(projectId);
        } catch (error) {
          console.error(`Failed to auto-restart project ${projectId}:`, error);
        }
      }, 5000); // Wait 5 seconds before restart
      this.restartTimeouts.set(projectId, timeoutHandle);
    });
  }

  /**
   * Get resource metrics for a project
   * @param {string} projectId - Project ID
   * @returns {Object} Resource metrics
   */
  getResourceMetrics(projectId) {
    const procInfo = this.processes.get(projectId);
    if (!procInfo) {
      return { cpu: 0, memory: 0, disk: 0 };
    }

    try {
      // Get process resource usage
      const usage = process.cpuUsage(procInfo.process);
      const memoryUsage = procInfo.process.memoryUsage();

      return {
        cpu: (usage.user + usage.system) / 1000000, // Convert to seconds
        memory: memoryUsage.heapUsed / 1024 / 1024, // Convert to MB
        disk: 0 // TODO: Implement disk usage tracking
      };
    } catch (error) {
      return { cpu: 0, memory: 0, disk: 0 };
    }
  }

  /**
   * Allocate a unique port for a project
   * @returns {number} Allocated port
   */
  allocatePort() {
    const usedPorts = this.db.prepare('SELECT port FROM projects').all()
      .map(p => p.port);

    // Start from 4320 and find first available port
    for (let port = 4320; port <= 65535; port++) {
      if (!usedPorts.includes(port)) {
        return port;
      }
    }

    throw new Error('No available ports');
  }

  /**
   * Get project by ID
   * @param {string} id - Project ID
   * @returns {Object|null} Project object or null
   */
  getProject(id) {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const project = stmt.get(id);
    return project || null;
  }

  /**
   * Back up the control-plane database to a timestamped file (T197).
   * @param {string} [backupDir] - defaults to `.ai/backups` alongside this instance's DB
   * @returns {{path: string, size: number, timestamp: string}}
   */
  backupDatabase(backupDir = path.join(path.dirname(this.dbPath), 'backups')) {
    return backupDatabaseTimestamped(this.db, backupDir, 'control-plane');
  }

  /**
   * Restore the control-plane database from a backup file (T197). Closes and reopens this
   * instance's DB handle around the file swap — required because SQLite corrupts if its file is
   * replaced while a handle (and its WAL) is open. In-memory process tracking (`this.processes`)
   * is intentionally left untouched; call `reconcileAfterCrash()` afterward if the restored data
   * disagrees with what's actually running.
   * @param {string} backupPath
   * @returns {{path: string, restoredFrom: string}}
   */
  restoreDatabase(backupPath) {
    this.db.close();
    const result = restoreDatabase(backupPath, this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    return result;
  }

  /**
   * Close database connection
   */
  close() {
    for (const p of this.watchedConfigPaths) unwatchPolicy(p);
    this.watchedConfigPaths.clear();
    this.db.close();
  }
}

// Singleton instance
let projectManagerInstance = null;

/**
 * Get singleton ProjectManager instance
 * @returns {ProjectManager} ProjectManager instance
 */
export function getProjectManager() {
  if (!projectManagerInstance) {
    projectManagerInstance = new ProjectManager();
  }
  return projectManagerInstance;
}

/**
 * TemplateLoader for loading, validating, and applying project templates
 */
export class TemplateLoader {
  constructor(templatesDir = path.join(__dirname, 'templates')) {
    this.templatesDir = templatesDir;
  }

  /**
   * Load and parse a template by ID
   * @param {string} templateId - e.g. "saas-web-app"
   * @returns {Object} Parsed template
   */
  load(templateId) {
    const templatePath = path.join(this.templatesDir, `${templateId}.yaml`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateId}`);
    }
    const yamlContent = fs.readFileSync(templatePath, 'utf8');
    const parsed = parseYaml(yamlContent);
    this._validateTemplate(parsed);
    return parsed;
  }

  /**
   * Validate that the template has the required structure
   * @param {Object} template - Parsed template
   */
  _validateTemplate(template) {
    if (typeof template !== 'object' || template === null) {
      throw new Error('Invalid template: root must be an object');
    }
    if (template.agents && typeof template.agents !== 'object') {
      throw new Error('Invalid template: agents must be an object');
    }
    if (template.taskCategories && typeof template.taskCategories !== 'object') {
      throw new Error('Invalid template: taskCategories must be an object');
    }
  }

  /**
   * List all available templates
   * @returns {Array<Object>} List of template IDs and minimal info
   */
  list() {
    if (!fs.existsSync(this.templatesDir)) {
      return [];
    }
    const files = fs.readdirSync(this.templatesDir);
    return files
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
      .map(file => {
        const id = file.replace(/\.ya?ml$/, '');
        try {
          const content = this.load(id);
          return {
            id,
            name: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            agentCount: content.agents ? Object.keys(content.agents).length : 0,
            categoryCount: content.taskCategories ? Object.keys(content.taskCategories).length : 0
          };
        } catch (err) {
          // Skip invalid templates in the list
          return null;
        }
      })
      .filter(Boolean);
  }

  /**
   * Apply template to a project directory
   * @param {string} templateId - Template ID
   * @param {string} projectRoot - Target project directory
   */
  apply(templateId, projectRoot) {
    const template = this.load(templateId);
    
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
    }

    const aiDir = path.join(projectRoot, '.ai');
    if (!fs.existsSync(aiDir)) {
      fs.mkdirSync(aiDir, { recursive: true });
    }
    
    // Write out the configuration as policy.yaml (or similar)
    // Note: yaml-lite doesn't have a stringify, so we implement a simple one or use JSON.
    // For policy.yaml, we can use a basic manual stringifier or write JSON (since YAML is a superset).
    // Actually, yaml-lite is just for read. We will write JSON to a config.json or basic YAML.
    const policyPath = path.join(aiDir, 'policy.yaml');
    
    // Quick stringifier for the subset of YAML we support
    const stringifyYAML = (obj, indent = 0) => {
      let out = '';
      const pad = '  '.repeat(indent);
      for (const [key, val] of Object.entries(obj)) {
        if (val === null) {
          out += `${pad}${key}: null\n`;
        } else if (typeof val === 'object' && !Array.isArray(val)) {
          out += `${pad}${key}:\n${stringifyYAML(val, indent + 1)}`;
        } else if (Array.isArray(val)) {
          // Flow array
          out += `${pad}${key}: [${val.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]\n`;
        } else if (typeof val === 'string') {
          out += `${pad}${key}: ${val}\n`;
        } else {
          out += `${pad}${key}: ${val}\n`;
        }
      }
      return out;
    };
    
    fs.writeFileSync(policyPath, stringifyYAML(template), 'utf8');
  }
}

// Singleton for TemplateLoader
let templateLoaderInstance = null;

export function getTemplateLoader() {
  if (!templateLoaderInstance) {
    templateLoaderInstance = new TemplateLoader();
  }
  return templateLoaderInstance;
}

/**
 * ReviewerAssigner — round-robin PR reviewer assignment from a project's team roster (008 — Team
 * Collaboration, US3/FR-014: "System MUST automatically assign PR reviewers from the team
 * roster"). Referenced by runner.mjs (T122, already correctly `await import()`s this) and
 * dashboard/server.mjs's /api/reviews/* routes since before either had anything to call — this
 * class did not previously exist anywhere in the codebase.
 *
 * Fairness: prefers whoever was assigned longest ago (or never), computed from
 * `reviewer_assignments` history — not pure random — so load spreads across the roster instead of
 * always landing on the same person.
 *
 * GitHub identity: needs each candidate's `users.github_username` to call
 * `gh pr edit --add-reviewer <username>` — nothing tracked this before (see auth/user-store.mjs's
 * UserStore, which now creates the column; this class's ensureSchema() ALSO backfills it via
 * ALTER TABLE, the same ProjectManager.ensureSchema()-established pattern, for the case where
 * this class's constructor happens to run against a fresher control-plane.db before UserStore's
 * does). A project member with no github_username set is excluded from the pool, never assigned
 * under a fabricated identity.
 */
export class ReviewerAssigner {
  constructor(dbPath = path.join(__dirname, '.ai', 'control-plane.db')) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reviewer_assignments (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        pr_url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reviewer_assignments_project ON reviewer_assignments(project_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reviewer_assignments_assignment_id ON reviewer_assignments(id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reviewer_assignments_user ON reviewer_assignments(user_id)`);

    // See class doc comment — backfill users.github_username if this constructor runs before
    // auth/user-store.mjs's UserStore has had a chance to create it as part of its own schema.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);
    const existingColumns = new Set(this.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!existingColumns.has('github_username')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN github_username TEXT`);
    }
  }

  /**
   * Assign up to `reviewerCount` reviewers to `prUrl` from `projectId`'s roster. Never errors for
   * "not enough reviewers" — returns fewer than requested if the eligible pool is smaller; only
   * fails when the pool is completely empty (no project member has a github_username set).
   *
   * @returns {Promise<{success:true, assignment_id:string, pr_url:string, reviewers:Array<{user_id:string,username:string}>, reviewer_count:number}|{success:false, error:string}>}
   */
  async assign(projectId, prUrl, reviewerCount = 2) {
    if (!projectId) return { success: false, error: 'projectId is required' };
    if (!prUrl) return { success: false, error: 'prUrl is required' };

    const candidates = this.db.prepare(`
      SELECT u.id AS user_id, u.github_username AS username,
             (SELECT MAX(ra.created_at) FROM reviewer_assignments ra
                WHERE ra.user_id = u.id AND ra.project_id = ?) AS last_assigned
      FROM project_users pu
      JOIN users u ON u.id = pu.user_id
      WHERE pu.project_id = ? AND u.github_username IS NOT NULL AND u.is_active = 1
      ORDER BY last_assigned IS NOT NULL, last_assigned ASC
    `).all(projectId, projectId);

    if (candidates.length === 0) {
      return {
        success: false,
        error: 'no eligible reviewers: no project member has a GitHub username set (PUT /api/auth/me with { github_username })',
      };
    }

    const selected = candidates.slice(0, Math.max(1, reviewerCount));
    const assignmentId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const insert = this.db.prepare(`
      INSERT INTO reviewer_assignments (id, project_id, pr_url, user_id, username, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const c of selected) {
      insert.run(assignmentId, projectId, prUrl, c.user_id, c.username, now);
    }

    return {
      success: true,
      assignment_id: assignmentId,
      pr_url: prUrl,
      reviewers: selected.map((c) => ({ user_id: c.user_id, username: c.username })),
      reviewer_count: selected.length,
    };
  }

  /** Recent assignment EVENTS for `projectId`, newest first — one entry per assign() call (which
   *  may cover several reviewers), not one row per reviewer. */
  getRecentAssignments(projectId, limit = 10) {
    const rows = this.db.prepare(`
      SELECT id, project_id, pr_url, user_id, username, created_at
      FROM reviewer_assignments
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(projectId);

    const byAssignment = new Map();
    for (const row of rows) {
      if (!byAssignment.has(row.id)) {
        byAssignment.set(row.id, {
          assignment_id: row.id, project_id: row.project_id, pr_url: row.pr_url,
          created_at: row.created_at, reviewers: [],
        });
      }
      byAssignment.get(row.id).reviewers.push({ user_id: row.user_id, username: row.username });
    }
    return [...byAssignment.values()].slice(0, limit);
  }

  /** Per-reviewer assignment counts for `projectId`, most-assigned first — surfaces whether
   *  round-robin fairness is actually holding up in practice. */
  getAssignmentStats(projectId) {
    const byReviewer = this.db.prepare(`
      SELECT username, COUNT(*) AS assignment_count, MAX(created_at) AS last_assigned
      FROM reviewer_assignments
      WHERE project_id = ?
      GROUP BY username
      ORDER BY assignment_count DESC
    `).all(projectId);

    const totalEvents = this.db.prepare(`
      SELECT COUNT(DISTINCT id) AS n FROM reviewer_assignments WHERE project_id = ?
    `).get(projectId).n;

    return { total_assignment_events: totalEvents, by_reviewer: byReviewer };
  }

  close() {
    this.db.close();
  }
}

let reviewerAssignerInstance = null;

export function getReviewerAssigner() {
  if (!reviewerAssignerInstance) {
    reviewerAssignerInstance = new ReviewerAssigner();
  }
  return reviewerAssignerInstance;
}
