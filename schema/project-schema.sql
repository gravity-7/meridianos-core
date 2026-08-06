-- Project Database Schema Template
-- This schema is applied to each project's database
--
-- Reconciled 2026-08 (008) against the actual runtime schema: project/task-comments.mjs's
-- TaskComment class uses the column name `content`, not `comment` as an earlier version of this
-- doc claimed — nothing actually executes this file at runtime (TaskComment.initializeTables()
-- issues its own CREATE TABLE IF NOT EXISTS against the injected project db), so the mismatch
-- was purely a stale-docs issue, not a live bug, but worth fixing so this file is trustworthy.

-- Task comments table
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);
