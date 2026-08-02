import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

/**
 * LicenseKey - RSA-based license key generation and validation
 * 
 * License key format: mer-XXXX-XXXX-XXXX-XXXX
 * - Prefix: "mer-"
 * - Payload: Base32-encoded JSON payload (tier, customer_id, features, expires_at)
 * - Signature: RSA signature of payload
 * 
 * The license key is cryptographically signed to prevent tampering.
 * Validation verifies the RSA signature and checks expiration.
 */
export class LicenseKey {
  static #privateKey = null;
  static #publicKey = null;

  /**
   * Initialize RSA key pair for license signing
   * Keys are generated once and reused for all license operations
   */
  static initializeKeys() {
    if (this.#privateKey && this.#publicKey) {
      return; // Already initialized
    }

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
  }

  /**
   * Generate a new license key from payload
   * @param {Object} payload - License payload
   * @param {string} payload.tier - License tier (free, pro, enterprise)
   * @param {string} payload.customer_id - Stripe customer ID
   * @param {string[]} payload.features - Array of enabled features
   * @param {number} payload.expires_at - Unix timestamp of expiration
   * @returns {string} License key in format mer-XXXX-XXXX-XXXX-XXXX
   */
  static generate(payload) {
    this.initializeKeys();

    // Add issued_at timestamp
    const fullPayload = {
      ...payload,
      issued_at: Math.floor(Date.now() / 1000)
    };

    // Validate required fields
    if (!fullPayload.tier || !fullPayload.customer_id || !fullPayload.expires_at) {
      throw new Error('Missing required fields: tier, customer_id, expires_at');
    }

    // Validate tier
    const validTiers = ['free', 'pro', 'enterprise'];
    if (!validTiers.includes(fullPayload.tier)) {
      throw new Error(`Invalid tier: ${fullPayload.tier}. Must be one of: ${validTiers.join(', ')}`);
    }

    // Validate expires_at is in the future
    if (fullPayload.expires_at <= Math.floor(Date.now() / 1000)) {
      throw new Error('expires_at must be in the future');
    }

    // Encode payload to Base64URL
    const payloadString = JSON.stringify(fullPayload);
    const payloadBase64 = Buffer.from(payloadString).toString('base64url');

    // Sign payload with RSA private key
    const signature = crypto.sign('sha256', Buffer.from(payloadString), {
      key: this.#privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING
    });

    // Encode signature to Base64URL
    const signatureBase64 = signature.toString('base64url');

    // Combine payload and signature
    const combined = payloadBase64 + '.' + signatureBase64;

    // Format as mer-XXXX-XXXX-XXXX-XXXX (take first 16 chars of combined)
    const formatted = this.formatLicenseKey(combined);

    return formatted;
  }

  /**
   * Validate a license key
   * @param {string} licenseKey - License key to validate
   * @returns {Object} Validation result
   * @returns {boolean} result.valid - Whether the license is valid
   * @returns {string} [result.tier] - License tier if valid
   * @returns {string[]} [result.features] - Enabled features if valid
   * @returns {string} [result.customer_id] - Customer ID if valid
   * @returns {number} [result.expires_at] - Expiration timestamp if valid
   * @returns {string} [result.error] - Error message if invalid
   */
  static validate(licenseKey) {
    this.initializeKeys();

    try {
      // Check format
      if (!licenseKey || typeof licenseKey !== 'string') {
        return { valid: false, error: 'Invalid license key format' };
      }

      // Remove prefix and format
      const normalized = licenseKey.replace(/^mer-/, '').replace(/-/g, '');

      // Split payload and signature
      const parts = normalized.split('.');
      if (parts.length !== 2) {
        return { valid: false, error: 'Invalid license key format' };
      }

      const [payloadBase64, signatureBase64] = parts;

      // Decode payload
      const payloadString = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadString);

      // Decode signature
      const signatureBuffer = Buffer.from(signatureBase64, 'base64url');

      // Verify signature
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(payloadString),
        {
          key: this.#publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING
        },
        signatureBuffer
      );

      if (!isValid) {
        return { valid: false, error: 'Invalid license signature' };
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.expires_at < now) {
        return { valid: false, error: 'License expired' };
      }

      // Return validated payload
      return {
        valid: true,
        tier: payload.tier,
        features: payload.features || [],
        customer_id: payload.customer_id,
        expires_at: payload.expires_at,
        issued_at: payload.issued_at
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Encode payload for license key
   * @param {Object} payload - License payload
   * @returns {string} Base32-encoded payload
   */
  static encodePayload(payload) {
    const payloadString = JSON.stringify(payload);
    return this.base32Encode(payloadString);
  }

  /**
   * Decode payload from license key
   * @param {string} licenseKey - License key
   * @returns {Object} Decoded payload
   * @throws {Error} If license key is invalid
   */
  static decodePayload(licenseKey) {
    const normalized = licenseKey.replace(/^mer-/, '').replace(/-/g, '');
    const parts = normalized.split('.');

    if (parts.length !== 2) {
      throw new Error('Invalid license key format');
    }

    const [payloadBase64] = parts;
    const payloadString = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    return JSON.parse(payloadString);
  }

  /**
   * Encode string to Base32 (RFC 4648)
   * @param {string} str - String to encode
   * @returns {string} Base32-encoded string
   */
  static base32Encode(str) {
    const buffer = Buffer.from(str, 'utf-8');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';

    for (let i = 0; i < buffer.length; i += 5) {
      const chunk = buffer.slice(i, i + 5);
      const padded = Buffer.concat([chunk, Buffer.alloc(5 - chunk.length)]);

      const value = padded.readUInt32BE(0);
      const chars = [
        (value >> 35) & 0x1F,
        (value >> 30) & 0x1F,
        (value >> 25) & 0x1F,
        (value >> 20) & 0x1F,
        (value >> 15) & 0x1F,
        (value >> 10) & 0x1F,
        (value >> 5) & 0x1F,
        value & 0x1F
      ];

      for (let j = 0; j < 8; j++) {
        result += alphabet[chars[j]];
      }
    }

    return result;
  }

  /**
   * Decode Base32 string (RFC 4648)
   * @param {string} str - Base32-encoded string
   * @returns {string} Decoded string
   */
  static base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const lookup = {};
    for (let i = 0; i < alphabet.length; i++) {
      lookup[alphabet[i]] = i;
    }

    const buffer = [];
    let bits = 0;
    let value = 0;

    for (const char of str.toUpperCase()) {
      if (char === '=') break;
      if (!(char in lookup)) continue;

      value = (value << 5) | lookup[char];
      bits += 5;

      if (bits >= 8) {
        bits -= 8;
        buffer.push((value >> bits) & 0xFF);
      }
    }

    return Buffer.from(buffer).toString('utf-8');
  }

  /**
   * Format license key as mer-XXXX-XXXX-XXXX-XXXX
   * @param {string} combined - Combined payload.signature string
   * @returns {string} Formatted license key
   */
  static formatLicenseKey(combined) {
    // Use a hash of the combined string to ensure uniqueness
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    
    // Take first 16 characters of the hash for the formatted key
    const clean = hash.slice(0, 16);

    // Add prefix
    let result = 'mer-';

    // Add groups of 4 characters
    for (let i = 0; i < clean.length; i += 4) {
      if (i > 0) result += '-';
      result += clean.slice(i, i + 4);
    }

    return result;
  }

  /**
   * Get tier features
   * @param {string} tier - License tier
   * @returns {string[]} Array of enabled features
   */
  static getTierFeatures(tier) {
    const features = {
      free: [
        'basic_features',
        'single_project',
        'local_dashboard'
      ],
      pro: [
        'unlimited_agents',
        'all_providers',
        'budget_enforcement',
        'remote_dashboard',
        'team_collaboration',
        'project_templates',
        'api_access'
      ],
      enterprise: [
        'all_features',
        'priority_support',
        'custom_integrations',
        'sso',
        'audit_logs',
        'compliance_reports',
        'sla_guarantee'
      ]
    };

    return features[tier] || features.free;
  }

  /**
   * Get tier limits
   * @param {string} tier - License tier
   * @returns {Object} Tier limits
   */
  static getTierLimits(tier) {
    const limits = {
      free: {
        max_projects: 1,
        max_agents: 3,
        max_seats: 1,
        max_monthly_spend: 100
      },
      pro: {
        max_projects: 10,
        max_agents: 50,
        max_seats: 10,
        max_monthly_spend: 1000
      },
      enterprise: {
        max_projects: -1, // Unlimited
        max_agents: -1, // Unlimited
        max_seats: -1, // Unlimited
        max_monthly_spend: -1 // Unlimited
      }
    };

    return limits[tier] || limits.free;
  }
}