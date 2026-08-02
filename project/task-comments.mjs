import Database from 'better-sqlite3';

/**
 * Task Comment Manager for handling task comments in project databases
 */
export class TaskComment {
  constructor(projectDb) {
    this.db = projectDb;
    this.initializeTables();
  }

  /**
   * Initialize task_comments table
   */
  initializeTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);
    `);
  }

  /**
   * Create a new task comment
   * @param {string} taskId - Task ID
   * @param {string} userId - User ID
   * @param {string} content - Comment content
   * @returns {Object} Created comment
   */
  create(taskId, userId, content) {
    // Validate inputs
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Task ID is required');
    }

    if (!userId || typeof userId !== 'string') {
      throw new Error('User ID is required');
    }

    // Allow empty content but ensure it's a string
    const sanitizedContent = content ? this.sanitizeContent(content) : '';

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO task_comments (id, task_id, user_id, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, taskId, userId, sanitizedContent, now, now);

    return {
      id,
      task_id: taskId,
      user_id: userId,
      content: sanitizedContent,
      created_at: now,
      updated_at: now
    };
  }

  /**
   * Get comments for a task
   * @param {string} taskId - Task ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of comments
   * @param {number} options.offset - Offset for pagination
   * @returns {Array} Comments for the task
   */
  list(taskId, options = {}) {
    const { limit = 100, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT tc.*
      FROM task_comments tc
      WHERE tc.task_id = ?
      ORDER BY tc.created_at ASC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(taskId, limit, offset);
  }

  /**
   * Get a single comment by ID
   * @param {string} commentId - Comment ID
   * @returns {Object|null} Comment or null
   */
  getById(commentId) {
    const stmt = this.db.prepare(`
      SELECT tc.*
      FROM task_comments tc
      WHERE tc.id = ?
    `);

    return stmt.get(commentId);
  }

  /**
   * Update a comment
   * @param {string} commentId - Comment ID
   * @param {string} content - New content
   * @returns {Object|null} Updated comment or null
   */
  update(commentId, content) {
    // Validate inputs
    if (!content || typeof content !== 'string') {
      throw new Error('Comment content is required');
    }

    // Sanitize content
    const sanitizedContent = this.sanitizeContent(content);

    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      UPDATE task_comments
      SET content = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(sanitizedContent, now, commentId, this.currentUserId);
    
    if (result.changes === 0) {
      return null;
    }

    return this.getById(commentId);
  }

  /**
   * Delete a comment
   * @param {string} commentId - Comment ID
   * @param {string} userId - User ID (for authorization)
   * @returns {boolean} True if deleted
   */
  delete(commentId, userId) {
    const stmt = this.db.prepare(`
      DELETE FROM task_comments
      WHERE id = ? AND user_id = ?
    `);

    const result = stmt.run(commentId, userId);
    return result.changes > 0;
  }

  /**
   * Get comments for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of comments
   * @returns {Array} Comments by the user
   */
  getByUser(userId, options = {}) {
    const { limit = 50 } = options;

    const stmt = this.db.prepare(`
      SELECT tc.*, t.title as task_title
      FROM task_comments tc
      LEFT JOIN tasks t ON tc.task_id = t.id
      WHERE tc.user_id = ?
      ORDER BY tc.created_at DESC
      LIMIT ?
    `);

    return stmt.all(userId, limit);
  }

  /**
   * Get recent comments across all tasks
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of comments
   * @returns {Array} Recent comments
   */
  getRecent(options = {}) {
    const { limit = 20 } = options;

    const stmt = this.db.prepare(`
      SELECT tc.*, t.title as task_title, u.name as user_name, u.email as user_email
      FROM task_comments tc
      LEFT JOIN tasks t ON tc.task_id = t.id
      LEFT JOIN users u ON tc.user_id = u.id
      ORDER BY tc.created_at DESC
      LIMIT ?
    `);

    return stmt.all(limit);
  }

  /**
   * Count comments for a task
   * @param {string} taskId - Task ID
   * @returns {number} Number of comments
   */
  count(taskId) {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM task_comments WHERE task_id = ?');
    const result = stmt.get(taskId);
    return result.count;
  }

  /**
   * Sanitize content to prevent XSS
   * @param {string} content - Raw content
   * @returns {string} Sanitized content
   */
  sanitizeContent(content) {
    if (!content) return '';

    // Basic HTML escaping
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Set current user ID (for authorization)
   * @param {string} userId - Current user ID
   */
  setCurrentUser(userId) {
    this.currentUserId = userId;
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
  }
}

// Import crypto for UUID generation
import crypto from 'node:crypto';