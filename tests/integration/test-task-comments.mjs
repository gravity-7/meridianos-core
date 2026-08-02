import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { TaskComment } from '../../project/task-comments.mjs';

describe('Task Comments Integration Tests', () => {
  let projectDbPath;
  let projectDb;
  let taskCommentManager;

  before(async () => {
    // Setup: Create test project database
    projectDbPath = path.join(process.cwd(), '.ai', 'test-task-comments.db');
    
    // Ensure .ai directory exists
    const aiDir = path.dirname(projectDbPath);
    if (!fs.existsSync(aiDir)) {
      fs.mkdirSync(aiDir, { recursive: true });
    }

    projectDb = new Database(projectDbPath);

    // Initialize task comment manager (will create tables)
    taskCommentManager = new TaskComment(projectDb);
  });

  after(() => {
    if (projectDb) projectDb.close();
    if (projectDbPath) {
      try {
        fs.unlinkSync(projectDbPath);
      } catch (e) {
        // Ignore errors if file doesn't exist
      }
    }
  });

  describe('Task Comment Creation', () => {
    it('should create task comment', () => {
      const taskId = 'task1';
      const userId = 'user1';
      const content = 'This is a test comment';

      const comment = taskCommentManager.create(taskId, userId, content);

      assert.strictEqual(comment.task_id, taskId);
      assert.strictEqual(comment.user_id, userId);
      assert.strictEqual(comment.content, content);
      assert.ok(comment.id);
      assert.ok(comment.created_at);
    });

    it('should create comment with empty content', () => {
      const taskId = 'task2';
      const userId = 'user2';
      const content = '';

      const comment = taskCommentManager.create(taskId, userId, content);

      assert.strictEqual(comment.task_id, taskId);
      assert.strictEqual(comment.user_id, userId);
      assert.strictEqual(comment.content, content);
      assert.ok(comment.id);
      assert.ok(comment.created_at);
    });

    it('should create comment with special characters', () => {
      const taskId = 'task3';
      const userId = 'user3';
      const content = 'Comment with <strong>HTML</strong> & special chars!';
      const expectedContent = 'Comment with &lt;strong&gt;HTML&lt;/strong&gt; &amp; special chars!';

      const comment = taskCommentManager.create(taskId, userId, content);

      assert.strictEqual(comment.task_id, taskId);
      assert.strictEqual(comment.user_id, userId);
      assert.strictEqual(comment.content, expectedContent);
      assert.ok(comment.id);
      assert.ok(comment.created_at);
    });
  });

  describe('Task Comment Listing', () => {
    it('should list comments for a task', () => {
      const taskId = 'task_list';
      const userId = 'user_list';
      
      // Create multiple comments
      const comment1 = taskCommentManager.create(taskId, userId, 'First comment');
      const comment2 = taskCommentManager.create(taskId, userId, 'Second comment');
      
      // List comments
      const comments = taskCommentManager.list(taskId);
      
      assert.strictEqual(comments.length, 2);
      assert.strictEqual(comments[0].content, 'First comment');
      assert.strictEqual(comments[1].content, 'Second comment');
    });

    it('should return empty array for task with no comments', () => {
      const taskId = 'task_empty';
      const comments = taskCommentManager.list(taskId);
      
      assert.strictEqual(comments.length, 0);
    });
  });

  describe('Comment Notifications', () => {
    it('should detect new comments for task', () => {
      const taskId = 'task_notify';
      const userId = 'user_notify';
      
      // Get initial comment count
      const initialComments = taskCommentManager.list(taskId);
      const initialCount = initialComments.length;
      
      // Add new comment
      const newComment = taskCommentManager.create(taskId, userId, 'New comment');
      
      // Check that comment was added
      const comments = taskCommentManager.list(taskId);
      assert.strictEqual(comments.length, initialCount + 1);
      assert.strictEqual(comments[comments.length - 1].content, 'New comment');
    });

    it('should handle multiple comments on same task', () => {
      const taskId = 'task_multiple';
      const users = ['user1', 'user2', 'user3'];
      const contents = ['First comment', 'Second comment', 'Third comment'];

      // Add multiple comments
      const comments = [];
      for (let i = 0; i < users.length; i++) {
        const comment = taskCommentManager.create(taskId, users[i], contents[i]);
        comments.push(comment);
      }

      // List all comments
      const allComments = taskCommentManager.list(taskId);
      assert.strictEqual(allComments.length, 3);
      
      // Check that comments are in chronological order
      assert.strictEqual(allComments[0].content, 'First comment');
      assert.strictEqual(allComments[1].content, 'Second comment');
      assert.strictEqual(allComments[2].content, 'Third comment');
    });
  });

  describe('Comment Data Validation', () => {
    it('should handle very long comments', () => {
      const taskId = 'task_long';
      const userId = 'user_long';
      const longContent = 'A'.repeat(10000); // 10k character comment

      const comment = taskCommentManager.create(taskId, userId, longContent);

      assert.strictEqual(comment.task_id, taskId);
      assert.strictEqual(comment.user_id, userId);
      assert.strictEqual(comment.content, longContent);
      assert.ok(comment.id);
      assert.ok(comment.created_at);
    });

    it('should handle comments with newlines and formatting', () => {
      const taskId = 'task_format';
      const userId = 'user_format';
      const content = `Line 1
Line 2
Line 3

Line 4 with <strong>HTML</strong>`;
      const expectedContent = `Line 1
Line 2
Line 3

Line 4 with &lt;strong&gt;HTML&lt;/strong&gt;`;

      const comment = taskCommentManager.create(taskId, userId, content);

      assert.strictEqual(comment.content, expectedContent);
    });
  });
});