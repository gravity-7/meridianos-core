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
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.processes = new Map(); // project_id -> { pid, process, startTime, restartCount }
    this.restartHistory = new Map(); // project_id -> [timestamp, ...]
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

    // Insert project
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, status, template, config_path, state_path, port, created_at, created_by, health_status, restart_count)
      VALUES (?, ?, 'stopped', ?, ?, ?, ?, ?, ?, 'unknown', 0)
    `);

    stmt.run(id, name, template, config_path, state_path, port, Math.floor(Date.now() / 1000), created_by);

    getActivityLogger().log({
      user_id: created_by,
      project_id: id,
      action: 'project_create',
      details: { name, template }
    });

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
      restartCount: 0
    });

    // Setup process monitoring
    this.monitorProcess(projectId, process);

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_start',
      details: { pid: process.pid }
    });

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

    const procInfo = this.processes.get(projectId);
    if (procInfo) {
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

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_stop',
      details: {}
    });

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
    this.processes.delete(projectId);
    this.restartHistory.delete(projectId);

    getActivityLogger().log({
      project_id: projectId,
      action: 'project_delete',
      details: {}
    });
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

      setTimeout(async () => {
        try {
          await this.startProject(projectId);
        } catch (error) {
          console.error(`Failed to auto-restart project ${projectId}:`, error);
        }
      }, 5000); // Wait 5 seconds before restart
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
   * Close database connection
   */
  close() {
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
