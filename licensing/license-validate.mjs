import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { LicenseKey } from './license-key.mjs';

/**
 * LicenseValidator - License key validation with caching
 * 
 * Validates license keys and caches results for 24 hours to reduce
 * validation overhead. Provides feature checking and limit queries.
 */
export class LicenseValidator {
  #db;
  #cache;
  #cacheDuration = 86400; // 24 hours in seconds

  /**
   * Create a new LicenseValidator
   * @param {Database} db - Control plane database instance
   */
  constructor(db) {
    this.#db = db;
    this.#cache = new Map();

    // Initialize licenses table if not exists
    this.#initializeSchema();
  }

  /**
   * Initialize licenses table schema
   */
  #initializeSchema() {
    this.#db.exec(`
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
    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(license_key);
      CREATE INDEX IF NOT EXISTS idx_licenses_tier ON licenses(tier);
      CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
      CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
      CREATE INDEX IF NOT EXISTS idx_licenses_subscription ON licenses(subscription_id);
    `);
  }

  /**
   * Validate a license key
   * @param {string} licenseKey - License key to validate
   * @param {Object} options - Validation options
   * @param {boolean} options.force_refresh - Bypass cache and force revalidation
   * @returns {Object} Validation result
   */
  validate(licenseKey, options = {}) {
    const { force_refresh = false } = options;

    // Check cache first
    if (!force_refresh && this.#cache.has(licenseKey)) {
      const cached = this.#cache.get(licenseKey);
      const now = Math.floor(Date.now() / 1000);

      if (now - cached.timestamp < this.#cacheDuration) {
        return {
          success: true,
          license_id: cached.license_id,
          tier: cached.tier,
          features: cached.features,
          customer_id: cached.customer_id,
          expires_at: cached.expires_at,
          last_validated: cached.last_validated,
          from_cache: true
        };
      }
    }

    // Validate license key format and signature
    const validation = LicenseKey.validate(licenseKey);

    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Check if license already exists in database
    const existing = this.#db.prepare(
      'SELECT * FROM licenses WHERE license_key = ?'
    ).get(licenseKey);

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      // Update last_validated timestamp
      this.#db.prepare(
        'UPDATE licenses SET last_validated = ?, updated_at = ? WHERE id = ?'
      ).run(now, now, existing.id);

      // Update cache
      this.#cache.set(licenseKey, {
        license_id: existing.id,
        tier: existing.tier,
        features: JSON.parse(existing.features),
        customer_id: existing.customer_id,
        expires_at: existing.expires_at,
        last_validated: now,
        timestamp: now
      });

      return {
        success: true,
        license_id: existing.id,
        tier: existing.tier,
        features: JSON.parse(existing.features),
        customer_id: existing.customer_id,
        expires_at: existing.expires_at,
        last_validated: now,
        from_cache: false
      };
    }

    // Insert new license
    const licenseId = randomUUID();
    const features = validation.features || LicenseKey.getTierFeatures(validation.tier);

    this.#db.prepare(`
      INSERT INTO licenses (
        id, license_key, tier, status, features, customer_id,
        subscription_id, expires_at, last_validated, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      licenseId,
      licenseKey,
      validation.tier,
      'active',
      JSON.stringify(features),
      validation.customer_id,
      null, // subscription_id will be set by webhook
      validation.expires_at,
      now,
      now,
      now
    );

    // Update cache
    this.#cache.set(licenseKey, {
      license_id: licenseId,
      tier: validation.tier,
      features,
      customer_id: validation.customer_id,
      expires_at: validation.expires_at,
      last_validated: now,
      timestamp: now
    });

    return {
      success: true,
      license_id: licenseId,
      tier: validation.tier,
      features,
      customer_id: validation.customer_id,
      expires_at: validation.expires_at,
      last_validated: now,
      from_cache: false
    };
  }

  /**
   * Check if a feature is available for the current license
   * @param {string} feature - Feature name to check
   * @returns {Object} Feature check result
   */
  checkFeature(feature) {
    // Get active license
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    if (!license) {
      return {
        success: false,
        error: 'No license found'
      };
    }

    const features = JSON.parse(license.features);
    const allowed = features.includes(feature);

    return {
      success: true,
      allowed,
      tier: license.tier,
      feature
    };
  }

  /**
   * Get tier limits for the current license
   * @returns {Object} Limits result
   */
  getLimits() {
    // Get active license
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    if (!license) {
      return {
        success: false,
        error: 'No license found'
      };
    }

    const limits = LicenseKey.getTierLimits(license.tier);

    // Get current usage
    const projectsCount = this.#db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get().count;

    const usersCount = this.#db.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).get().count;

    return {
      success: true,
      tier: license.tier,
      limits,
      usage: {
        projects_count: projectsCount,
        seats_used: usersCount,
        seats_limit: limits.max_seats
      }
    };
  }

  /**
   * Get current license status
   * @returns {Object} License status
   */
  getLicenseStatus() {
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    if (!license) {
      return {
        success: false,
        error: 'No license found. Using free tier.'
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const isExpired = license.expires_at < now;

    return {
      success: true,
      license: {
        id: license.id,
        license_key: license.license_key,
        tier: license.tier,
        status: isExpired ? 'expired' : license.status,
        features: JSON.parse(license.features),
        expires_at: license.expires_at,
        last_validated: license.last_validated,
        customer_id: license.customer_id,
        subscription_id: license.subscription_id
      },
      usage: this.getUsage()
    };
  }

  /**
   * Get current usage statistics
   * @returns {Object} Usage statistics
   */
  getUsage() {
    const projectsCount = this.#db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get().count;

    const usersCount = this.#db.prepare(
      'SELECT COUNT(*) as count FROM users'
    ).get().count;

    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    const limits = license ? LicenseKey.getTierLimits(license.tier) : LicenseKey.getTierLimits('free');

    return {
      seats_used: usersCount,
      seats_limit: limits.max_seats,
      projects_count: projectsCount
    };
  }

  /**
   * Update license tier
   * @param {string} licenseId - License ID
   * @param {string} newTier - New tier
   */
  updateTier(licenseId, newTier) {
    const features = LicenseKey.getTierFeatures(newTier);
    const now = Math.floor(Date.now() / 1000);

    this.#db.prepare(`
      UPDATE licenses
      SET tier = ?, features = ?, updated_at = ?
      WHERE id = ?
    `).run(newTier, JSON.stringify(features), now, licenseId);

    // Clear cache
    const license = this.#db.prepare('SELECT license_key FROM licenses WHERE id = ?').get(licenseId);
    if (license) {
      this.#cache.delete(license.license_key);
    }
  }

  /**
   * Update license status
   * @param {string} licenseId - License ID
   * @param {string} newStatus - New status (active, revoked, grace_period, expired)
   */
  updateStatus(licenseId, newStatus) {
    const now = Math.floor(Date.now() / 1000);

    this.#db.prepare(`
      UPDATE licenses
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, now, licenseId);

    // Clear cache
    const license = this.#db.prepare('SELECT license_key FROM licenses WHERE id = ?').get(licenseId);
    if (license) {
      this.#cache.delete(license.license_key);
    }
  }

  /**
   * Clear validation cache
   */
  clearCache() {
    this.#cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.#cache.size,
      duration: this.#cacheDuration
    };
  }
}