import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { LicenseKey } from '../../licensing/license-key.mjs';
import { LicenseValidator } from '../../licensing/license-validate.mjs';

describe('License Validation Integration Tests', () => {
  let db;
  let testLicenseKey;
  let licenseValidator;

  before(async () => {
    // Setup: Create test database
    db = new Database(':memory:');
    
    // Create licenses table
    db.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        license_key TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        features TEXT NOT NULL,
        customer_id TEXT,
        subscription_id TEXT,
        expires_at INTEGER,
        last_validated INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
      CREATE INDEX IF NOT EXISTS idx_licenses_tier ON licenses(tier);
      CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
    `);

    // Initialize license validator
    licenseValidator = new LicenseValidator(db);

    // Generate test license key
    const payload = {
      tier: 'pro',
      customer_id: 'cus_test123',
      features: ['unlimited_agents', 'all_providers', 'budget_enforcement', 'remote_dashboard', 'team_collaboration'],
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 30 // 30 days
    };

    testLicenseKey = LicenseKey.generate(payload);
  });

  after(() => {
    if (db) db.close();
  });

  describe('LicenseKey.generate()', () => {
    it('should generate valid license key with correct format', () => {
      const payload = {
        tier: 'pro',
        customer_id: 'cus_test123',
        features: ['unlimited_agents', 'all_providers'],
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
      };

      const licenseKey = LicenseKey.generate(payload);

      // Check format: mer-XXXX-XXXX-XXXX-XXXX (4 groups of 4 chars)
      assert.match(licenseKey, /^mer-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it('should encode payload correctly', () => {
      const payload = {
        tier: 'enterprise',
        customer_id: 'cus_enterprise',
        features: ['all_features'],
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 365
      };

      const licenseKey = LicenseKey.generate(payload);
      const decoded = LicenseKey.decodePayload(licenseKey);

      assert.strictEqual(decoded.tier, payload.tier);
      assert.strictEqual(decoded.customer_id, payload.customer_id);
      assert.deepStrictEqual(decoded.features, payload.features);
      assert.strictEqual(decoded.expires_at, payload.expires_at);
    });

    it('should generate different keys for same payload', () => {
      const payload = {
        tier: 'pro',
        customer_id: 'cus_test',
        features: ['test'],
        expires_at: Math.floor(Date.now() / 1000) + 86400
      };

      const key1 = LicenseKey.generate(payload);
      const key2 = LicenseKey.generate(payload);

      assert.notStrictEqual(key1, key2);
    });
  });

  describe('LicenseKey.validate()', () => {
    it('should validate correctly signed license key', () => {
      const payload = {
        tier: 'pro',
        customer_id: 'cus_test',
        features: ['test'],
        expires_at: Math.floor(Date.now() / 1000) + 86400
      };

      const licenseKey = LicenseKey.generate(payload);
      const result = LicenseKey.validate(licenseKey);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.tier, payload.tier);
      assert.deepStrictEqual(result.features, payload.features);
    });

    it('should reject invalid license key format', () => {
      const result = LicenseKey.validate('invalid-key-format');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error);
    });

    it('should reject expired license key', () => {
      const payload = {
        tier: 'pro',
        customer_id: 'cus_test',
        features: ['test'],
        expires_at: Math.floor(Date.now() / 1000) - 86400 // Expired yesterday
      };

      const licenseKey = LicenseKey.generate(payload);
      const result = LicenseKey.validate(licenseKey);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('expired'));
    });

    it('should reject tampered license key', () => {
      const payload = {
        tier: 'pro',
        customer_id: 'cus_test',
        features: ['test'],
        expires_at: Math.floor(Date.now() / 1000) + 86400
      };

      const licenseKey = LicenseKey.generate(payload);
      const tamperedKey = licenseKey.replace('mer-', 'mer-X');

      const result = LicenseKey.validate(tamperedKey);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('signature'));
    });
  });

  describe('LicenseKey.decodePayload()', () => {
    it('should decode payload from valid license key', () => {
      const payload = {
        tier: 'enterprise',
        customer_id: 'cus_enterprise',
        features: ['feature1', 'feature2', 'feature3'],
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 365
      };

      const licenseKey = LicenseKey.generate(payload);
      const decoded = LicenseKey.decodePayload(licenseKey);

      assert.strictEqual(decoded.tier, payload.tier);
      assert.strictEqual(decoded.customer_id, payload.customer_id);
      assert.deepStrictEqual(decoded.features, payload.features);
      assert.strictEqual(decoded.expires_at, payload.expires_at);
      assert.ok(decoded.issued_at);
    });

    it('should throw error for invalid license key', () => {
      assert.throws(() => {
        LicenseKey.decodePayload('invalid-key');
      });
    });
  });

  describe('LicenseValidator.validate()', () => {
    it('should validate and store license key in database', () => {
      const result = licenseValidator.validate(testLicenseKey);

      assert.strictEqual(result.success, true);
      assert.ok(result.license_id);

      // Verify stored in database
      const stored = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(testLicenseKey);
      assert.ok(stored);
      assert.strictEqual(stored.tier, 'pro');
      assert.strictEqual(stored.status, 'active');
    });

    it('should return existing license if already validated', () => {
      const result1 = licenseValidator.validate(testLicenseKey);
      const result2 = licenseValidator.validate(testLicenseKey);

      assert.strictEqual(result1.license_id, result2.license_id);
    });

    it('should reject invalid license key', () => {
      const result = licenseValidator.validate('invalid-key');

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should update last_validated timestamp', async () => {
      const result1 = licenseValidator.validate(testLicenseKey);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      const result2 = licenseValidator.validate(testLicenseKey);

      const stored = db.prepare('SELECT last_validated FROM licenses WHERE id = ?').get(result1.license_id);
      assert.ok(stored.last_validated > result1.last_validated);
    });
  });

  describe('LicenseValidator.checkFeature()', () => {
    it('should return true for feature available in tier', () => {
      const result = licenseValidator.checkFeature('unlimited_agents');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.tier, 'pro');
    });

    it('should return false for feature not available in tier', () => {
      // Free tier doesn't have unlimited_agents
      const freePayload = {
        tier: 'free',
        customer_id: 'cus_free',
        features: ['basic_features'],
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
      };

      const freeKey = LicenseKey.generate(freePayload);
      licenseValidator.validate(freeKey);

      const result = licenseValidator.checkFeature('unlimited_agents');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.tier, 'free');
    });

    it('should return error when no license exists', () => {
      // Clear licenses table
      db.exec('DELETE FROM licenses');

      const result = licenseValidator.checkFeature('unlimited_agents');

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('No license found'));
    });
  });

  describe('LicenseValidator.getLimits()', () => {
    it('should return limits for pro tier', () => {
      const result = licenseValidator.getLimits();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tier, 'pro');
      assert.ok(result.limits.max_projects > 0);
      assert.ok(result.limits.max_agents > 0);
      assert.ok(result.limits.max_seats > 0);
      assert.ok(result.limits.max_monthly_spend > 0);
    });

    it('should return different limits for different tiers', () => {
      const proLimits = licenseValidator.getLimits();

      // Create free tier license
      const freePayload = {
        tier: 'free',
        customer_id: 'cus_free',
        features: ['basic_features'],
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
      };

      const freeKey = LicenseKey.generate(freePayload);
      licenseValidator.validate(freeKey);

      const freeLimits = licenseValidator.getLimits();

      assert.ok(proLimits.limits.max_projects > freeLimits.limits.max_projects);
      assert.ok(proLimits.limits.max_agents > freeLimits.limits.max_agents);
    });

    it('should return error when no license exists', () => {
      db.exec('DELETE FROM licenses');

      const result = licenseValidator.getLimits();

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('No license found'));
    });
  });

  describe('License caching', () => {
    it('should cache validation result for 24 hours', () => {
      const startTime = Date.now();
      const result1 = licenseValidator.validate(testLicenseKey);
      const midTime = Date.now();
      const result2 = licenseValidator.validate(testLicenseKey);
      const endTime = Date.now();

      // Second validation should be faster (from cache)
      const firstDuration = midTime - startTime;
      const secondDuration = endTime - midTime;

      assert.ok(secondDuration < firstDuration);
    });

    it('should bypass cache when force_refresh is true', () => {
      const result = licenseValidator.validate(testLicenseKey, { force_refresh: true });

      assert.strictEqual(result.success, true);
      assert.ok(result.from_cache === false);
    });
  });
});