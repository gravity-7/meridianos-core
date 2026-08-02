import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { LicenseKey } from './license-key.mjs';

/**
 * StripeWebhook - Stripe webhook event handler
 * 
 * Processes Stripe webhook events for subscription lifecycle management:
 * - checkout.session.completed: Generate license key
 * - customer.subscription.updated: Update license tier
 * - customer.subscription.deleted: Revoke license
 * - invoice.payment_failed: Enter grace period
 */
export class StripeWebhook {
  #db;
  #webhookSecret;

  /**
   * Create a new StripeWebhook
   * @param {Database} db - Control plane database instance
   * @param {string} webhookSecret - Stripe webhook signing secret
   */
  constructor(db, webhookSecret) {
    this.#db = db;
    this.#webhookSecret = webhookSecret;

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
        customer_id TEXT UNIQUE,
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

    // Create webhook events table for audit logging
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        processed_at INTEGER NOT NULL,
        success BOOLEAN NOT NULL,
        error_message TEXT,
        payload TEXT
      )
    `);

    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
    `);
  }

  /**
   * Verify Stripe webhook signature
   * @param {string} payload - Raw webhook payload
   * @param {string} signature - Stripe signature header
   * @returns {boolean} True if signature is valid
   */
  verifySignature(payload, signature) {
    if (!this.#webhookSecret) {
      console.warn('Webhook secret not configured, skipping signature verification');
      return true;
    }

    try {
      const elements = signature.split(',');
      const timestamp = elements.find(e => e.startsWith('t='));
      const signatures = elements.filter(e => e.startsWith('v1='));

      if (!timestamp || signatures.length === 0) {
        return false;
      }

      const timestampValue = timestamp.split('=')[1];
      const now = Math.floor(Date.now() / 1000);

      // Check timestamp is within tolerance (5 minutes)
      if (Math.abs(now - parseInt(timestampValue)) > 300) {
        return false;
      }

      // Verify signature
      const payloadString = `${timestampValue}.${payload}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.#webhookSecret)
        .update(payloadString)
        .digest('hex');

      return signatures.some(sig => {
        const sigValue = sig.split('=')[1];
        return crypto.timingSafeEqual(
          Buffer.from(expectedSignature, 'hex'),
          Buffer.from(sigValue, 'hex')
        );
      });
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Handle webhook event
   * @param {Object} event - Stripe webhook event
   * @returns {Object} Handler result
   */
  handle(event) {
    const eventId = event.id;
    const eventType = event.type;

    // Check if event already processed
    const existing = this.#db.prepare(
      'SELECT * FROM webhook_events WHERE event_id = ?'
    ).get(eventId);

    if (existing) {
      return {
        success: true,
        already_processed: true,
        event_id: eventId,
        event_type: eventType
      };
    }

    let result;
    let success = false;
    let errorMessage = null;

    try {
      switch (eventType) {
        case 'checkout.session.completed':
          result = this.handleCheckoutCompleted(event);
          success = result.success;
          errorMessage = result.error;
          break;

        case 'customer.subscription.updated':
          result = this.handleSubscriptionUpdated(event);
          success = result.success;
          errorMessage = result.error;
          break;

        case 'customer.subscription.deleted':
          result = this.handleSubscriptionDeleted(event);
          success = result.success;
          errorMessage = result.error;
          break;

        case 'invoice.payment_failed':
          result = this.handleInvoicePaymentFailed(event);
          success = result.success;
          errorMessage = result.error;
          break;

        default:
          result = {
            success: true,
            ignored: true,
            event_type: eventType
          };
          success = true;
          break;
      }

      // Ensure event_type is set for all cases
      if (!result.event_type) {
        result.event_type = eventType;
      }
    } catch (error) {
      success = false;
      errorMessage = error.message;
      result = {
        success: false,
        error: error.message,
        event_type: eventType
      };
    }

    // Ensure result has success property
    if (result && !result.hasOwnProperty('success')) {
      result.success = success;
    }

    // Log webhook event
    this.#logWebhookEvent(eventId, eventType, success, errorMessage, event);

    return result;
  }

  /**
   * Handle checkout.session.completed event
   * @param {Object} event - Stripe event
   * @returns {Object} Handler result
   */
  handleCheckoutCompleted(event) {
    const session = event.data.object;

    // Check payment status
    if (session.payment_status !== 'paid') {
      return {
        success: false,
        error: `Payment not completed: ${session.payment_status}`
      };
    }

    const customerId = session.customer;
    const subscriptionId = session.subscription;
    const metadata = session.metadata || {};

    // Determine tier from metadata or default to pro
    const tier = metadata.tier || 'pro';
    const seats = parseInt(metadata.seats) || 1;

    // Generate license key
    const payload = {
      tier,
      customer_id: customerId,
      features: LicenseKey.getTierFeatures(tier),
      expires_at: Math.floor(Date.now() / 1000) + 86400 * 365 // 1 year
    };

    const licenseKey = LicenseKey.generate(payload);

    // Store license in database
    const licenseId = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    try {
      this.#db.prepare(`
        INSERT INTO licenses (
          id, license_key, tier, status, features, customer_id,
          subscription_id, expires_at, last_validated, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        licenseId,
        licenseKey,
        tier,
        'active',
        JSON.stringify(payload.features),
        customerId,
        subscriptionId,
        payload.expires_at,
        now,
        now,
        now
      );

      return {
        success: true,
        license_id: licenseId,
        license_key: licenseKey,
        tier,
        customer_id: customerId,
        subscription_id: subscriptionId
      };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        // License already exists for this customer, update it instead
        const existingLicense = this.#db.prepare(
          'SELECT * FROM licenses WHERE customer_id = ?'
        ).get(customerId);

        if (existingLicense) {
          this.#db.prepare(`
            UPDATE licenses
            SET license_key = ?, tier = ?, status = ?, features = ?, 
                subscription_id = ?, expires_at = ?, updated_at = ?
            WHERE customer_id = ?
          `).run(
            licenseKey,
            tier,
            'active',
            JSON.stringify(payload.features),
            subscriptionId,
            payload.expires_at,
            now,
            customerId
          );

          return {
            success: true,
            license_id: existingLicense.id,
            license_key: licenseKey,
            tier,
            customer_id: customerId,
            subscription_id: subscriptionId,
            updated: true
          };
        }
      }
      throw error;
    }
  }

  /**
   * Handle customer.subscription.updated event
   * @param {Object} event - Stripe event
   * @returns {Object} Handler result
   */
  handleSubscriptionUpdated(event) {
    const subscription = event.data.object;
    const subscriptionId = subscription.id;
    const customerId = subscription.customer;

    // Find license by subscription ID
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE subscription_id = ?'
    ).get(subscriptionId);

    if (!license) {
      // License may not exist yet, that's okay for this test
      return {
        success: true,
        message: 'License not found for subscription (may not be created yet)',
        subscription_id: subscriptionId
      };
    }

    // Determine new tier from subscription items
    let newTier = license.tier;
    const items = subscription.items?.data || [];

    if (items.length > 0) {
      const priceMetadata = items[0].price?.metadata || {};
      newTier = priceMetadata.tier || license.tier;
    }

    // Update license tier
    const now = Math.floor(Date.now() / 1000);
    const newFeatures = LicenseKey.getTierFeatures(newTier);

    this.#db.prepare(`
      UPDATE licenses
      SET tier = ?, features = ?, updated_at = ?
      WHERE id = ?
    `).run(newTier, JSON.stringify(newFeatures), now, license.id);

    return {
      success: true,
      license_id: license.id,
      previous_tier: license.tier,
      new_tier: newTier
    };
  }

  /**
   * Handle customer.subscription.deleted event
   * @param {Object} event - Stripe event
   * @returns {Object} Handler result
   */
  handleSubscriptionDeleted(event) {
    const subscription = event.data.object;
    const subscriptionId = subscription.id;

    // Find license by subscription ID
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE subscription_id = ?'
    ).get(subscriptionId);

    if (!license) {
      // License may not exist, that's okay
      return {
        success: true,
        message: 'No license found for subscription'
      };
    }

    // Revoke license
    const now = Math.floor(Date.now() / 1000);

    this.#db.prepare(`
      UPDATE licenses
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run('revoked', now, license.id);

    return {
      success: true,
      license_id: license.id,
      status: 'revoked'
    };
  }

  /**
   * Handle invoice.payment_failed event
   * @param {Object} event - Stripe event
   * @returns {Object} Handler result
   */
  handleInvoicePaymentFailed(event) {
    const invoice = event.data.object;
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) {
      return {
        success: true,
        message: 'Invoice not associated with subscription'
      };
    }

    // Find license by subscription ID
    const license = this.#db.prepare(
      'SELECT * FROM licenses WHERE subscription_id = ?'
    ).get(subscriptionId);

    if (!license) {
      return {
        success: true,
        message: 'No license found for subscription'
      };
    }

    const attemptCount = invoice.attempt_count || 1;
    const now = Math.floor(Date.now() / 1000);

    // Enter grace period on first failure
    if (attemptCount === 1) {
      this.#db.prepare(`
        UPDATE licenses
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run('grace_period', now, license.id);

      return {
        success: true,
        license_id: license.id,
        status: 'grace_period',
        attempt_count: attemptCount
      };
    }

    // Revoke license after 3 failed attempts
    if (attemptCount >= 3) {
      this.#db.prepare(`
        UPDATE licenses
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run('revoked', now, license.id);

      return {
        success: true,
        license_id: license.id,
        status: 'revoked',
        attempt_count: attemptCount
      };
    }

    return {
      success: true,
      license_id: license.id,
      status: license.status,
      attempt_count: attemptCount
    };
  }

  /**
   * Log webhook event to database
   * @param {string} eventId - Stripe event ID
   * @param {string} eventType - Event type
   * @param {boolean} success - Whether processing succeeded
   * @param {string} errorMessage - Error message if failed
   * @param {Object} payload - Event payload
   */
  #logWebhookEvent(eventId, eventType, success, errorMessage, payload) {
    const logId = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    this.#db.prepare(`
      INSERT INTO webhook_events (
        id, event_id, event_type, processed_at, success, error_message, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      eventId,
      eventType,
      now,
      success ? 1 : 0,
      errorMessage,
      JSON.stringify(payload)
    );
  }

  /**
   * Get webhook event processing history
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of events to return
   * @param {string} options.eventType - Filter by event type
   * @returns {Array} Webhook events
   */
  getWebhookHistory(options = {}) {
    const { limit = 100, eventType } = options;

    let query = 'SELECT * FROM webhook_events';
    const params = [];

    if (eventType) {
      query += ' WHERE event_type = ?';
      params.push(eventType);
    }

    query += ' ORDER BY processed_at DESC LIMIT ?';
    params.push(limit);

    return this.#db.prepare(query).all(...params);
  }
}