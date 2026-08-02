import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { UserStore, InvitationManager } from '../../auth/user-store.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Invitation Lifecycle Integration Tests', () => {
  let userStore;
  let invitationManager;
  let testDbPath;

  before(async () => {
    // Create a unique temporary database file for testing
    testDbPath = path.join(__dirname, `test-invitation-${Date.now()}.db`);
    
    // Initialize user store (will create tables)
    userStore = new UserStore(testDbPath);
    
    // Initialize invitation manager
    invitationManager = new InvitationManager(userStore);
  });

  after(() => {
    // Clean up test database
    if (testDbPath && fs.existsSync(testDbPath)) {
      // Close database connection first
      if (userStore) {
        userStore.close();
      }
      // Try to delete the file
      try {
        fs.unlinkSync(testDbPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Invitation Creation and Acceptance', () => {
    it('should create invitation token', () => {
      const email = 'test@example.com';
      const projectId = 'project123';
      const role = 'operator';

      const invitation = invitationManager.create(email, projectId, role);

      assert.strictEqual(invitation.email, email);
      assert.strictEqual(invitation.project_id, projectId);
      assert.strictEqual(invitation.role, role);
      assert.ok(invitation.token);
      assert.ok(invitation.expires_at * 1000 > Date.now());
    });

    it('should validate valid invitation token', () => {
      const email = 'test2@example.com';
      const projectId = 'project456';
      const role = 'viewer';

      const invitation = invitationManager.create(email, projectId, role);
      const validation = invitationManager.validate(invitation.token);

      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.email, email);
      assert.strictEqual(validation.project_id, projectId);
      assert.strictEqual(validation.role, role);
    });

    it('should reject expired invitation token', () => {
      // Create a token that expires immediately
      const expiredToken = crypto.randomBytes(32).toString('hex');
      
      // Insert expired token directly
      const now = Math.floor(Date.now() / 1000);
      userStore.db.prepare(`
        INSERT INTO invitations (id, token, email, project_id, role, expires_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        expiredToken,
        'expired@example.com',
        'project789',
        'admin',
        now - 1, // 1 second ago
        'pending',
        now,
        now
      );

      const validation = invitationManager.validate(expiredToken);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.error.includes('expired'));
    });

    it('should reject already accepted invitation token', async () => {
      const email = 'accepted@example.com';
      const projectId = 'project999';
      const role = 'operator';

      const invitation = invitationManager.create(email, projectId, role);
      
      // Accept the invitation
      await invitationManager.accept(invitation.token, 'password123');
      
      // Try to validate again
      const validation = invitationManager.validate(invitation.token);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.error.includes('accepted') || validation.error.includes('processed'));
    });

    it('should accept invitation and create user', async () => {
      const email = 'newuser@example.com';
      const projectId = 'project100';
      const role = 'operator';
      const password = 'SecurePassword123!';

      const invitation = invitationManager.create(email, projectId, role);
      const result = await invitationManager.accept(invitation.token, password);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.user.email, email);
      
      // Verify user is added to project
      const projectUser = userStore.db.prepare(
        'SELECT * FROM project_users WHERE user_id = ? AND project_id = ?'
      ).get(result.user.id, projectId);
      
      assert.ok(projectUser);
      assert.strictEqual(projectUser.role, role);
    });

    it('should reject invitation with invalid token', async () => {
      const result = await invitationManager.accept('invalid-token', 'password123');
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Invalid') || result.error.includes('invalid'));
    });
  });

  describe('Invitation Expiration', () => {
    it('should automatically expire invitations after 24 hours', async () => {
      const email = 'expire-test@example.com';
      const projectId = 'project200';
      const role = 'viewer';

      const invitation = await invitationManager.create(email, projectId, role);
      
      // Mock the current time to be 25 hours in the future
      const originalDate = Date.now;
      Date.now = () => invitation.expires_at * 1000 + 1000 * 60 * 60; // 1 hour past expiration
      
      try {
        const validation = invitationManager.validate(invitation.token);
        assert.strictEqual(validation.valid, false);
        assert.ok(validation.error.includes('expired'));
      } finally {
        Date.now = originalDate;
      }
    });
  });
});