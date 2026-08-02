import Database from 'better-sqlite3';
import { LicenseKey } from './license-key.mjs';

/**
 * LicenseRefresh - License heartbeat and refresh mechanism
 * 
 * Periodically validates licenses against the license server to ensure
 * they are still active and up-to-date. Updates local cache with latest
 * license information.
 */
export class LicenseRefresh {
  #db;
  #licenseServerUrl;
  #refreshInterval = 86400; // 24 hours in seconds
  #lastRefresh = 0;
  #refreshTimer = null;

  /**
   * Create a new LicenseRefresh
   * @param {Database} db - Control plane database instance
   * @param {Object} options - Configuration options
   * @param {string} options.licenseServerUrl - License server URL
   * @param {number} options.refreshInterval - Refresh interval in seconds (default: 86400)
   */
  constructor(db, options = {}) {
    this.#db = db;
    this.#licenseServerUrl = options.licenseServerUrl || process.env.LICENSE_SERVER_URL;
    this.#refreshInterval = options.refreshInterval || this.#refreshInterval;
  }

  /**
   * Start automatic license refresh
   * @param {number} interval - Refresh interval in milliseconds
   */
  start(interval = this.#refreshInterval * 1000) {
    if (this.#refreshTimer) {
      this.stop();
    }

    this.#refreshTimer = setInterval(() => {
      this.refresh().catch(error => {
        console.error('License refresh failed:', error);
      });
    }, interval);

    // Initial refresh
    this.refresh().catch(error => {
      console.error('Initial license refresh failed:', error);
    });
  }

  /**
   * Stop automatic license refresh
   */
  stop() {
    if (this.#refreshTimer) {
      clearInterval(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }

  /**
   * Refresh license from server
   * @param {Object} options - Refresh options
   * @param {boolean} options.force - Force refresh even if not due
   * @returns {Object} Refresh result
   */
  async refresh(options = {}) {
    const { force = false } = options;
    const now = Math.floor(Date.now() / 1000);

    // Check if refresh is due
    if (!force && (now - this.#lastRefresh) < this.#refreshInterval) {
      return {
        success: true,
        skipped: true,
        reason: 'Refresh not due yet',
        next_refresh: this.#lastRefresh + this.#refreshInterval
      };
    }

    // Get active license
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    if (!license) {
      return {
        success: false,
        error: 'No active license to refresh'
      };
    }

    try {
      // In production, this would call the license server
      // For now, we'll validate the license key locally
      const validation = LicenseKey.validate(license.license_key);

      if (!validation.valid) {
        // License is invalid, update status
        this.#updateLicenseStatus(license.id, 'expired');
        return {
          success: false,
          error: validation.error,
          license_id: license.id
        };
      }

      // Update last_validated timestamp
      this.#updateLastValidated(license.id, now);
      this.#lastRefresh = now;

      return {
        success: true,
        license_id: license.id,
        tier: validation.tier,
        expires_at: validation.expires_at,
        last_validated: now,
        next_refresh: now + this.#refreshInterval
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        license_id: license.id
      };
    }
  }

  /**
   * Refresh license from remote server (production implementation)
   * @param {string} licenseKey - License key to refresh
   * @returns {Object} Refresh result
   */
  async refreshFromServer(licenseKey) {
    if (!this.#licenseServerUrl) {
      throw new Error('License server URL not configured');
    }

    try {
      const response = await fetch(`${this.#licenseServerUrl}/api/v1/licenses/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ license_key: licenseKey })
      });

      if (!response.ok) {
        throw new Error(`License server returned ${response.status}`);
      }

      const data = await response.json();

      if (!data.valid) {
        return {
          success: false,
          error: data.error || 'License validation failed'
        };
      }

      // Update local license with server data
      const license = this.#db.prepare(
        'SELECT * FROM licenses WHERE license_key = ?'
      ).get(licenseKey);

      if (license) {
        const now = Math.floor(Date.now() / 1000);
        this.#db.prepare(`
          UPDATE licenses
          SET tier = ?, features = ?, expires_at = ?, last_validated = ?, updated_at = ?
          WHERE id = ?
        `).run(
          data.tier,
          JSON.stringify(data.features),
          data.expires_at,
          now,
          now,
          license.id
        );
      }

      return {
        success: true,
        tier: data.tier,
        features: data.features,
        expires_at: data.expires_at
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get refresh status
   * @returns {Object} Refresh status
   */
  getStatus() {
    const now = Math.floor(Date.now() / 1000);
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT 1'
    ).get('active');

    return {
      is_running: this.#refreshTimer !== null,
      last_refresh: this.#lastRefresh,
      next_refresh: this.#lastRefresh + this.#refreshInterval,
      seconds_until_next_refresh: Math.max(0, this.#lastRefresh + this.#refreshInterval - now),
      refresh_interval: this.#refreshInterval,
      has_active_license: !!license,
      license_id: license?.id,
      license_tier: license?.tier
    };
  }

  /**
   * Update license last_validated timestamp
   * @param {string} licenseId - License ID
   * @param {number} timestamp - Unix timestamp
   */
  #updateLastValidated(licenseId, timestamp) {
    this.#db.prepare(`
      UPDATE licenses
      SET last_validated = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, licenseId);
  }

  /**
   * Update license status
   * @param {string} licenseId - License ID
   * @param {string} status - New status
   */
  #updateLicenseStatus(licenseId, status) {
    const now = Math.floor(Date.now() / 1000);
    this.#db.prepare(`
      UPDATE licenses
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, licenseId);
  }

  /**
   * Manually trigger refresh
   * @returns {Promise<Object>} Refresh result
   */
  async trigger() {
    return this.refresh({ force: true });
  }
}