import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ActivityLogger } from '../../compliance/audit-log.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Unix SECONDS (not ms) — matches ActivityLogger.log()'s own Math.floor(Date.now()/1000)
// convention for the `timestamp` column. Fixed rather than Date.now()-derived so the "by date
// range" test below has a stable, reproducible window.
const BASE_TIME_SECONDS = 1_700_000_000;

describe('Activity Feed Integration Tests', () => {
  let dbPath;
  let activityLogger;

  before(async () => {
    // Setup: Create test database
    dbPath = path.join(process.cwd(), '.ai', 'test-activity-feed.db');
    
    // Ensure .ai directory exists
    const aiDir = path.dirname(dbPath);
    if (!fs.existsSync(aiDir)) {
      fs.mkdirSync(aiDir, { recursive: true });
    }

    // Initialize activity logger (will create tables)
    activityLogger = new ActivityLogger(dbPath);
  });

  after(() => {
    if (dbPath) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {
        // Ignore errors if file doesn't exist
      }
    }
  });

  describe('Activity Logging', () => {
    it('should log user action with project context', () => {
      const userId = 'user123';
      const projectId = 'project456';
      const action = 'create_project';
      const details = { name: 'Test Project', template: 'blank' };

      const activity = activityLogger.log({ user_id: userId, project_id: projectId, action, details });

      assert.strictEqual(activity.user_id, userId);
      assert.strictEqual(activity.project_id, projectId);
      assert.strictEqual(activity.action, action);
      assert.strictEqual(activity.details, JSON.stringify(details));
      assert.ok(activity.timestamp);
    });

    it('should log system action without project context', () => {
      const userId = 'system';
      const action = 'system_startup';
      const details = { version: '1.0.0', mode: 'production' };

      const activity = activityLogger.log({ user_id: userId, project_id: null, action, details });

      assert.strictEqual(activity.user_id, userId);
      assert.strictEqual(activity.project_id, null);
      assert.strictEqual(activity.action, action);
      assert.strictEqual(activity.details, JSON.stringify(details));
    });

    it('should log action with minimal details', () => {
      const userId = 'user789';
      const projectId = 'project999';
      const action = 'login';

      const activity = activityLogger.log({ user_id: userId, project_id: projectId, action });

      assert.strictEqual(activity.user_id, userId);
      assert.strictEqual(activity.project_id, projectId);
      assert.strictEqual(activity.action, action);
      assert.strictEqual(activity.details, '{}');
    });
  });

  describe('Activity Querying', () => {
    beforeEach(() => {
      // Clear the activity log
      activityLogger.db.exec('DELETE FROM activity_log');
      
      // Insert test activities
      const activities = [
        { id: 'activity1', user_id: 'user1', project_id: 'project1', action: 'create_project', details: '{"name":"Project A"}' },
        { id: 'activity2', user_id: 'user2', project_id: 'project1', action: 'join_project', details: '{"role":"operator"}' },
        { id: 'activity3', user_id: 'user1', project_id: 'project2', action: 'create_project', details: '{"name":"Project B"}' },
        { id: 'activity4', user_id: 'user3', project_id: 'project1', action: 'login', details: '{}' },
        { id: 'activity5', user_id: 'user1', project_id: null, action: 'system_config', details: '{"setting":"theme"}' }
      ];

      const insert = activityLogger.db.prepare(`
        INSERT INTO activity_log (id, user_id, project_id, action, details, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // The `timestamp` column holds Unix SECONDS (matching log()'s own Math.floor(Date.now()/1000)
      // convention) — a prior version of this fixture used a 13-digit millisecond-scale baseTime
      // directly as the column value, which the date-range test below then filtered with
      // query()'s startDate/endDate (millisecond-scale, converted to seconds internally),
      // comparing a seconds-scale bound against millisecond-scale stored data — a 1000x mismatch
      // that silently matched zero rows.
      activities.forEach((activity, index) => {
        insert.run(
          activity.id,
          activity.user_id,
          activity.project_id,
          activity.action,
          activity.details,
          BASE_TIME_SECONDS + index,
          BASE_TIME_SECONDS + index,
        );
      });
    });

    it('should query activities by user', () => {
      const activities = activityLogger.query({ user_id: 'user1' });

      assert.strictEqual(activities.length, 3);
      activities.forEach(a => assert.strictEqual(a.user_id, 'user1'));
    });

    it('should query activities by project', () => {
      const activities = activityLogger.query({ project_id: 'project1' });

      assert.strictEqual(activities.length, 3);
      activities.forEach(a => assert.strictEqual(a.project_id, 'project1'));
    });

    it('should query activities by action', () => {
      const activities = activityLogger.query({ action: 'create_project' });
      
      assert.strictEqual(activities.length, 2);
      activities.forEach(a => assert.strictEqual(a.action, 'create_project'));
    });

    it('should query activities by date range', () => {
      // query()'s startDate/endDate go through `new Date(x).getTime()` (millisecond-scale input,
      // like the Date constructor expects) before being compared against the second-scale
      // `timestamp` column — so the bounds here are the *1000 of the fixture's second-scale rows,
      // not the raw seconds themselves.
      const activities = activityLogger.query({
        startDate: (BASE_TIME_SECONDS + 1) * 1000,
        endDate: (BASE_TIME_SECONDS + 3) * 1000,
      });

      assert.strictEqual(activities.length, 3); // rows at +1, +2, +3
    });

    it('should query activities with multiple filters', () => {
      const activities = activityLogger.query({
        user_id: 'user1',
        project_id: 'project1'
      });

      assert.strictEqual(activities.length, 1);
      assert.strictEqual(activities[0].action, 'create_project');
    });

    it('should return empty array for no matching activities', () => {
      const activities = activityLogger.query({ user_id: 'nonexistent' });
      
      assert.strictEqual(activities.length, 0);
    });

    it('should sort activities by timestamp descending', () => {
      const activities = activityLogger.query({});
      
      // Check that activities are sorted by timestamp (newest first)
      for (let i = 0; i < activities.length - 1; i++) {
        assert.ok(activities[i].timestamp >= activities[i + 1].timestamp);
      }
    });

    it('should limit number of returned activities', () => {
      const activities = activityLogger.query({ limit: 2 });

      assert.strictEqual(activities.length, 2);
    });

    // Regression: getStats({projectId}) threw "Too many parameter values were provided" —
    // actionParams started as a COPY of the first query's params (already containing projectId),
    // then the same filter values were pushed onto it a second time, doubling the bound values
    // against a query with only one set of `?` placeholders. Never caught because this file (like
    // every tests/integration/test-*.mjs file) was excluded from `npm test`'s glob until 008.
    it('getStats scoped by projectId does not throw and returns the right total', () => {
      const stats = activityLogger.getStats({ projectId: 'project1' });
      assert.strictEqual(stats.total, 3); // activity1, activity2, activity4
      assert.ok(Array.isArray(stats.actions));
    });

    it('getStats scoped by userId does not throw and returns the right total', () => {
      const stats = activityLogger.getStats({ userId: 'user1' });
      assert.strictEqual(stats.total, 3); // activity1, activity3, activity5
    });

    it('getStats with multiple filters combined does not throw', () => {
      const stats = activityLogger.getStats({ projectId: 'project1', userId: 'user1' });
      assert.strictEqual(stats.total, 1); // activity1 only
    });

    it('getStats with no filters returns the full total', () => {
      const stats = activityLogger.getStats({});
      assert.strictEqual(stats.total, 5);
    });
  });

  describe('Activity Feed Generation', () => {
    beforeEach(() => {
      // Clear the activity log
      activityLogger.db.exec('DELETE FROM activity_log');
      
      // Insert test activities for project feed
      const activities = [
        { id: 'feed1', user_id: 'user1', project_id: 'project1', action: 'create_project', details: '{"name":"Test Project"}' },
        { id: 'feed2', user_id: 'user2', project_id: 'project1', action: 'join_project', details: '{"role":"operator"}' },
        { id: 'feed3', user_id: 'user1', project_id: 'project1', action: 'create_task', details: '{"task":"Setup environment"}' },
        { id: 'feed4', user_id: 'user3', project_id: 'project1', action: 'comment', details: '{"task":"Setup environment","comment":"Done"}' },
        { id: 'feed5', user_id: null, project_id: null, action: 'system_config', details: '{"setting":"theme"}' }
      ];

      const insert = activityLogger.db.prepare(`
        INSERT INTO activity_log (id, user_id, project_id, action, details, timestamp, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      activities.forEach((activity, index) => {
        insert.run(
          activity.id,
          activity.user_id,
          activity.project_id,
          activity.action,
          activity.details,
          now + index * 1000,
          now + index * 1000
        );
      });
    });

    it('should generate project activity feed', () => {
      const feed = activityLogger.getProjectFeed('project1');
      
      assert.strictEqual(feed.length, 4);
      feed.forEach(item => assert.strictEqual(item.project_id, 'project1'));
      
      // Check that feed items include user information
      assert.ok(feed[0].user_name);
      assert.ok(feed[0].action_display);
    });

    it('should generate global activity feed', () => {
      const feed = activityLogger.getGlobalFeed();
      
      assert.strictEqual(feed.length, 5);
      
      // Should include both project and system activities
      const hasProjectActivities = feed.some(item => item.project_id !== null);
      const hasSystemActivities = feed.some(item => item.project_id === null);
      
      assert.ok(hasProjectActivities);
      assert.ok(hasSystemActivities);
    });

    it('should filter activity feed by action type', () => {
      const feed = activityLogger.getProjectFeed('project1', { action: 'create_task' });
      
      assert.strictEqual(feed.length, 1);
      assert.strictEqual(feed[0].action, 'create_task');
    });
  });
});