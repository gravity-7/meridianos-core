import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '.ai', 'control-plane.db');

/**
 * Activity Logger for tracking user actions and system events
 */
export class ActivityLogger {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Initialize tables
    this.initializeTables();
  }

  /**
   * Initialize database tables
   */
  initializeTables() {
    // Create activity_log table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        project_id TEXT,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create compliance_log table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compliance_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        ip_address TEXT
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_project_id ON activity_log(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
      CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_compliance_log_user_id ON compliance_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_compliance_log_action ON compliance_log(action);
      CREATE INDEX IF NOT EXISTS idx_compliance_log_category ON compliance_log(category);
      CREATE INDEX IF NOT EXISTS idx_compliance_log_timestamp ON compliance_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id);
      CREATE INDEX IF NOT EXISTS idx_compliance_log_user ON compliance_log(user_id);
    `);
  }

  /**
   * Log an activity event. Returns the created row (matching every other create()/log()-style
   * method in this codebase — UserStore.createUser, InvitationManager.create, TaskComment.create
   * all return what they made) so a caller that needs the new activity's id/timestamp doesn't
   * have to issue a second query.
   */
  log({ user_id = null, project_id = null, action, details = {} }) {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO activity_log (id, user_id, project_id, action, details, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Math.floor(Date.now() / 1000);
    const detailsJson = JSON.stringify(details);
    stmt.run(id, user_id, project_id, action, detailsJson, now, now);
    return { id, user_id, project_id, action, details: detailsJson, timestamp: now, created_at: now };
  }

  /**
   * Query activity logs
   */
  query(filters = {}) {
    let query = 'SELECT * FROM activity_log WHERE 1=1';
    const params = [];

    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.project_id) {
      query += ' AND project_id = ?';
      params.push(filters.project_id);
    }
    if (filters.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(Math.floor(new Date(filters.startDate).getTime() / 1000));
    }
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(Math.floor(new Date(filters.endDate).getTime() / 1000));
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params).map(row => ({
      ...row,
      details: JSON.parse(row.details)
    }));
  }

  /**
   * Get project activity feed
   * @param {string} projectId - Project ID
   * @param {Object} options - Filter options
   * @param {number} options.limit - Maximum number of activities
   * @returns {Array} Project activity feed
   */
  getProjectFeed(projectId, options = {}) {
    const { limit = 50, action, startDate, endDate } = options;

    // query()'s filter is `project_id` (snake_case, matching the column name) — passing
    // camelCase `projectId` here silently no-ops the filter and returns every project's
    // activity, not just this one's.
    const activities = this.query({
      project_id: projectId,
      limit,
      action,
      startDate,
      endDate
    });

    // Enrich with user information
    return activities.map(activity => ({
      ...activity,
      user_name: this.getUserName(activity.user_id),
      action_display: this.getActionDisplay(activity.action, activity.details)
    }));
  }

  /**
   * Get global activity feed
   * @param {Object} options - Filter options
   * @param {number} options.limit - Maximum number of activities
   * @returns {Array} Global activity feed
   */
  getGlobalFeed(options = {}) {
    const { limit = 100 } = options;
    
    const activities = this.query({
      limit
    });

    // Enrich with user information
    return activities.map(activity => ({
      ...activity,
      user_name: this.getUserName(activity.user_id),
      action_display: this.getActionDisplay(activity.action, activity.details)
    }));
  }

  /**
   * Get user name by ID
   * @param {string} userId - User ID
   * @returns {string} User name or 'Unknown'
   */
  getUserName(userId) {
    if (!userId) return 'System';
    
    try {
      const stmt = this.db.prepare('SELECT full_name FROM users WHERE id = ?');
      const user = stmt.get(userId);
      return user ? user.full_name : 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Get display text for action
   * @param {string} action - Action type
   * @param {Object} details - Action details
   * @returns {string} Display text
   */
  getActionDisplay(action, details) {
    const actionMap = {
      'create_project': 'Created project',
      'update_project': 'Updated project',
      'delete_project': 'Deleted project',
      'join_project': 'Joined project',
      'leave_project': 'Left project',
      'create_task': 'Created task',
      'update_task': 'Updated task',
      'complete_task': 'Completed task',
      'delete_task': 'Deleted task',
      'comment': 'Added comment',
      'login': 'Logged in',
      'logout': 'Logged out',
      'change_password': 'Changed password',
      'create_user': 'Created user',
      'update_user': 'Updated user',
      'delete_user': 'Deleted user',
      'system_startup': 'System started',
      'system_shutdown': 'System stopped',
      'system_config': 'Updated configuration'
    };

    let display = actionMap[action] || action;
    
    // Add details for specific actions
    if (details) {
      try {
        const parsedDetails = JSON.parse(details);
        
        switch (action) {
          case 'create_project':
            display += `: ${parsedDetails.name || 'New project'}`;
            break;
          case 'create_task':
            display += `: ${parsedDetails.task || 'New task'}`;
            break;
          case 'comment':
            display += ` on task: ${parsedDetails.task || 'Unknown task'}`;
            break;
          case 'join_project':
            display += ` as ${parsedDetails.role || 'member'}`;
            break;
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }

    return display;
  }

  /**
   * Get activity statistics
   * @param {Object} options - Filter options
   * @param {string} options.projectId - Filter by project ID
   * @param {string} options.userId - Filter by user ID
   * @param {number} options.startDate - Filter by start date
   * @param {number} options.endDate - Filter by end date
   * @returns {Object} Activity statistics
   */
  getStats(options = {}) {
    const { projectId, userId, startDate, endDate } = options;

    let query = 'SELECT COUNT(*) as total FROM activity_log WHERE 1=1';
    const params = [];

    // Add filters
    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params);

    // Get action breakdown. actionParams starts EMPTY, not a copy of `params` — the same filter
    // values get pushed again below (rebuilt fresh for actionQuery's own placeholders), so
    // starting from a copy double-counted every active filter, throwing "Too many parameter
    // values were provided" as soon as any filter (e.g. projectId) was actually set.
    let actionQuery = 'SELECT action, COUNT(*) as count FROM activity_log WHERE 1=1';
    const actionParams = [];

    if (projectId) {
      actionQuery += ' AND project_id = ?';
      actionParams.push(projectId);
    }

    if (userId) {
      actionQuery += ' AND user_id = ?';
      actionParams.push(userId);
    }

    if (startDate) {
      actionQuery += ' AND timestamp >= ?';
      actionParams.push(startDate);
    }

    if (endDate) {
      actionQuery += ' AND timestamp <= ?';
      actionParams.push(endDate);
    }

    actionQuery += ' GROUP BY action ORDER BY count DESC LIMIT 10';

    const actionStmt = this.db.prepare(actionQuery);
    const actionStats = actionStmt.all(...actionParams);

    return {
      total: result.total,
      actions: actionStats
    };
  }

  /**
   * Clean up old activities
   * @param {number} days - Number of days to keep
   * @returns {number} Number of deleted activities
   */
  cleanup(days = 90) {
    const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    
    const stmt = this.db.prepare('DELETE FROM activity_log WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    
    return result.changes;
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

// Singleton instance
let activityLoggerInstance = null;

/**
 * Get singleton ActivityLogger instance
 * @returns {ActivityLogger} ActivityLogger instance
 */
export function getActivityLogger() {
  if (!activityLoggerInstance) {
    activityLoggerInstance = new ActivityLogger();
  }
  return activityLoggerInstance;
}

/**
 * Audit Logger for compliance tracking
 */
export class AuditLogger {
  constructor(dbPath = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    // Ensure tables exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compliance_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        ip_address TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_compliance_log_user ON compliance_log(user_id);`);
  }

  /**
   * Log a compliance event
   * @param {Object} event - Event data
   */
  logCompliance({ user_id = null, action, category, details = {}, ip_address = null }) {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO compliance_log (id, user_id, action, category, details, timestamp, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, user_id, action, category, JSON.stringify(details), Math.floor(Date.now() / 1000), ip_address);
  }

  /**
   * Query compliance logs
   * @param {Object} filters - Query filters
   * @returns {Array} List of events
   */
  query(filters = {}) {
    let query = 'SELECT * FROM compliance_log WHERE 1=1';
    const params = [];

    if (filters.user_id) {
      query += ' AND user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.action) {
      query += ' AND action = ?';
      params.push(filters.action);
    }
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(Math.floor(new Date(filters.startDate).getTime() / 1000));
    }
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(Math.floor(new Date(filters.endDate).getTime() / 1000));
    }

    query += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params).map(row => ({
      ...row,
      details: JSON.parse(row.details)
    }));
  }
}

let auditLoggerInstance = null;

export function getAuditLogger() {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger();
  }
  return auditLoggerInstance;
}