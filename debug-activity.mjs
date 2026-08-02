import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ActivityLogger } from './compliance/audit-log.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

describe('Debug Activity Feed', () => {
  let dbPath;
  let activityLogger;

  it('should query activities by date range', () => {
    // Setup: Create test database
    dbPath = path.join(process.cwd(), '.ai', 'debug-activity.db');
    
    // Ensure .ai directory exists
    const aiDir = path.dirname(dbPath);
    if (!fs.existsSync(aiDir)) {
      fs.mkdirSync(aiDir, { recursive: true });
    }

    // Initialize activity logger (will create tables)
    activityLogger = new ActivityLogger(dbPath);

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

    const baseTime = 1000000000000; // Fixed timestamp for consistent testing
    activities.forEach((activity, index) => {
      insert.run(
        activity.id,
        activity.user_id,
        activity.project_id,
        activity.action,
        activity.details,
        baseTime + index * 1000,
        baseTime + index * 1000
      );
    });

    // Query all activities first
    const allActivities = activityLogger.query({});
    console.log('All activities:', allActivities.length);
    console.log('All activity timestamps:', allActivities.map(a => a.timestamp));
    
    // Check what's actually in the database
    const allActivities = activityLogger.db.prepare('SELECT * FROM activity_log ORDER BY timestamp').all();
    console.log('Database records:', allActivities);
    
    // Query by date range - try both milliseconds and seconds
    console.log('\nTrying with milliseconds:');
    const activitiesInRangeMs = activityLogger.query({ 
      startDate: baseTime + 1000,
      endDate: baseTime + 3000
    });
    console.log('Activities in range (ms):', activitiesInRangeMs.length);
    
    console.log('\nTrying with seconds:');
    const activitiesInRangeSec = activityLogger.query({ 
      startDate: Math.floor((baseTime + 1000) / 1000),
      endDate: Math.floor((baseTime + 3000) / 1000)
    });
    console.log('Activities in range (sec):', activitiesInRangeSec.length);
    
    assert.strictEqual(activitiesInRangeMs.length + activitiesInRangeSec.length, 3);
    
    // Cleanup
    fs.unlinkSync(dbPath);
  });
});