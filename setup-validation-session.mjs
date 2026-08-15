/**
 * Short-lived, server-memory-only secret handoff for legacy /setup provider validation.
 * Nothing in this module persists a credential or returns it to a browser-facing caller.
 */
import { randomUUID } from 'node:crypto';

const INVALID_VALIDATION = 'Setup validation is invalid, expired, or no longer available.';

function invalidValidation() {
  return new Error(INVALID_VALIDATION);
}

/**
 * @param {{now?: () => number, ttlMs?: number, randomId?: () => string}} [options]
 */
export function createSetupValidationSessionStore({
  now = () => Date.now(),
  ttlMs = 5 * 60 * 1000,
  randomId = randomUUID,
} = {}) {
  const validations = new Map();
  const reviews = new Map();
  const activeValidationBySession = new Map();

  function clearExpiryTimer(record) {
    if (record?.expiryTimer) clearTimeout(record.expiryTimer);
  }

  function revokeReview(reviewId) {
    const record = reviews.get(reviewId);
    if (!record) return;
    clearExpiryTimer(record);
    reviews.delete(reviewId);
  }

  function revokeReviewsForValidation(validationId) {
    for (const [reviewId, record] of reviews) {
      if (record.validationId === validationId) revokeReview(reviewId);
    }
  }

  function revokeValidation(validationId) {
    const record = validations.get(validationId);
    if (!record) return;
    clearExpiryTimer(record);
    validations.delete(validationId);
    if (activeValidationBySession.get(record.sessionId) === validationId) {
      activeValidationBySession.delete(record.sessionId);
    }
    revokeReviewsForValidation(validationId);
  }

  function scheduleExpiry(delayMs, expire) {
    const timer = setTimeout(expire, Math.max(0, delayMs));
    timer.unref?.();
    return timer;
  }

  function nextId() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = randomId();
      if (!validations.has(id) && !reviews.has(id)) return id;
    }
    throw invalidValidation();
  }

  function read(validationId, sessionId) {
    const record = validations.get(validationId);
    if (!record || record.sessionId !== sessionId || record.consumed || record.expiresAt <= now()) {
      if (record && record.expiresAt <= now()) revokeValidation(validationId);
      throw invalidValidation();
    }
    return record;
  }

  function readReview(reviewId, validationId, sessionId, review) {
    const record = reviews.get(reviewId);
    if (
      !record
      || record.validationId !== validationId
      || record.sessionId !== sessionId
      || record.consumed
      || record.expiresAt <= now()
      || JSON.stringify(record.review) !== JSON.stringify(review)
    ) {
      if (record && record.expiresAt <= now()) revokeReview(reviewId);
      throw invalidValidation();
    }
    read(validationId, sessionId);
    return record;
  }

  return {
    createValidated({ choice, secret, sessionId }) {
      if (!choice || typeof secret !== 'string' || secret.length === 0 || typeof sessionId !== 'string' || sessionId.length === 0) {
        throw invalidValidation();
      }
      revokeValidation(activeValidationBySession.get(sessionId));
      const id = nextId();
      const record = {
        choice: { ...choice },
        secret,
        sessionId,
        expiresAt: now() + ttlMs,
        consumed: false,
      };
      record.expiryTimer = scheduleExpiry(ttlMs, () => revokeValidation(id));
      validations.set(id, record);
      activeValidationBySession.set(sessionId, id);
      return { id, status: 'valid', summary: 'Connection verified. Continue to budget.' };
    },

    getValidatedChoice({ validationId, sessionId }) {
      const record = read(validationId, sessionId);
      return { choice: { ...record.choice }, secret: record.secret };
    },

    /** Idempotently revoke a browser-abandoned validation without returning its secret. */
    revokeValidatedChoice({ validationId, sessionId }) {
      const record = validations.get(validationId);
      if (!record || record.sessionId !== sessionId) return false;
      revokeValidation(validationId);
      return true;
    },

    /** Revoke every secret-bearing validation associated with an expired browser session. */
    revokeSetupSession(sessionId) {
      let revoked = false;
      for (const [validationId, record] of validations) {
        if (record.sessionId === sessionId) {
          revokeValidation(validationId);
          revoked = true;
        }
      }
      return revoked;
    },

    createReviewedSetup({ validationId, sessionId, review }) {
      const validation = read(validationId, sessionId);
      if (!review || typeof review !== 'object') throw invalidValidation();
      const id = nextId();
      const expiresAt = validation.expiresAt;
      const record = {
        validationId,
        sessionId,
        review: JSON.parse(JSON.stringify(review)),
        expiresAt,
        consumed: false,
      };
      record.expiryTimer = scheduleExpiry(expiresAt - now(), () => revokeReview(id));
      reviews.set(id, record);
      return id;
    },

    getReviewedChoice({ reviewId, validationId, sessionId, review }) {
      readReview(reviewId, validationId, sessionId, review);
      return this.getValidatedChoice({ validationId, sessionId });
    },

    consumeReviewedChoice({ reviewId, validationId, sessionId, review }) {
      const record = readReview(reviewId, validationId, sessionId, review);
      record.consumed = true;
      revokeReview(reviewId);
      return this.consumeValidatedChoice({ validationId, sessionId });
    },

    consumeValidatedChoice({ validationId, sessionId }) {
      const record = read(validationId, sessionId);
      record.consumed = true;
      const choice = { ...record.choice };
      const { secret } = record;
      revokeValidation(validationId);
      return { choice, secret };
    },
  };
}
