import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { StripeWebhook } from '../../licensing/stripe-webhook.mjs';
import { LicenseKey } from '../../licensing/license-key.mjs';
import Database from 'better-sqlite3';

describe('Stripe Webhook Integration Tests', () => {
  let db;
  let stripeWebhook;
  let webhookSecret;

  before(async () => {
    // Setup: Create test database
    db = new Database(':memory:');

    // Generate webhook secret for testing
    webhookSecret = crypto.randomBytes(32).toString('hex');

    // Initialize Stripe webhook handler (will create tables)
    stripeWebhook = new StripeWebhook(db, webhookSecret);
  });

  after(() => {
    if (db) db.close();
  });

  describe('Webhook signature verification', () => {
    it('should verify valid webhook signature', () => {
      const payload = {
        id: 'evt_test123',
        type: 'test.event',
        data: { object: {} }
      };

      const signature = generateStripeSignature(payload, webhookSecret);
      const result = stripeWebhook.verifySignature(JSON.stringify(payload), signature);

      assert.strictEqual(result, true);
    });

    it('should reject invalid webhook signature', () => {
      const payload = {
        id: 'evt_test123',
        type: 'test.event',
        data: { object: {} }
      };

      const invalidSignature = 't=1234567890,v1=invalid';
      const result = stripeWebhook.verifySignature(JSON.stringify(payload), invalidSignature);

      assert.strictEqual(result, false);
    });

    it('should reject webhook with wrong secret', () => {
      const payload = {
        id: 'evt_test123',
        type: 'test.event',
        data: { object: {} }
      };

      const wrongSecret = crypto.randomBytes(32).toString('hex');
      const signature = generateStripeSignature(payload, wrongSecret);
      const result = stripeWebhook.verifySignature(JSON.stringify(payload), signature);

      assert.strictEqual(result, false);
    });
  });

  describe('handleCheckoutCompleted()', () => {
    it('should generate license key on checkout completion', () => {
      const event = {
        id: 'evt_checkout123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test123',
            customer: 'cus_customer123',
            subscription: 'sub_subscription123',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      const result = stripeWebhook.handleCheckoutCompleted(event);

      assert.strictEqual(result.success, true);
      assert.ok(result.license_id);
      assert.ok(result.license_key);

      // Verify license stored in database
      const stored = db.prepare('SELECT * FROM licenses WHERE customer_id = ?').get('cus_customer123');
      assert.ok(stored);
      assert.strictEqual(stored.tier, 'pro');
      assert.strictEqual(stored.subscription_id, 'sub_subscription123');
      assert.strictEqual(stored.status, 'active');
    });

    it('should use correct features based on tier', () => {
      const event = {
        id: 'evt_checkout456',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test456',
            customer: 'cus_customer456',
            subscription: 'sub_subscription456',
            metadata: {
              tier: 'enterprise',
              seats: '10'
            },
            payment_status: 'paid'
          }
        }
      };

      const result = stripeWebhook.handleCheckoutCompleted(event);

      const stored = db.prepare('SELECT * FROM licenses WHERE customer_id = ?').get('cus_customer456');
      const features = JSON.parse(stored.features);

      assert.ok(features.includes('all_features'));
      assert.ok(features.includes('priority_support'));
    });

    it('should handle missing metadata gracefully', () => {
      const event = {
        id: 'evt_checkout789',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test789',
            customer: 'cus_customer789',
            subscription: 'sub_subscription789',
            metadata: {},
            payment_status: 'paid'
          }
        }
      };

      const result = stripeWebhook.handleCheckoutCompleted(event);

      assert.strictEqual(result.success, true);
      // Should default to pro tier
      const stored = db.prepare('SELECT * FROM licenses WHERE customer_id = ?').get('cus_customer789');
      assert.strictEqual(stored.tier, 'pro');
    });

    it('should not generate license for unpaid checkout', () => {
      const event = {
        id: 'evt_checkout_unpaid',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_unpaid',
            customer: 'cus_unpaid',
            subscription: 'sub_unpaid',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'unpaid'
          }
        }
      };

      const result = stripeWebhook.handleCheckoutCompleted(event);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('unpaid'));

      const stored = db.prepare('SELECT * FROM licenses WHERE customer_id = ?').get('cus_unpaid');
      assert.strictEqual(stored, undefined);
    });
  });

  describe('handleSubscriptionUpdated()', () => {
    it('should update license tier on subscription upgrade', () => {
      // First create a license
      const checkoutEvent = {
        id: 'evt_checkout_upgrade',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_upgrade',
            customer: 'cus_upgrade',
            subscription: 'sub_upgrade',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      // Now upgrade subscription
      const updateEvent = {
        id: 'evt_sub_update',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_upgrade',
            customer: 'cus_upgrade',
            items: {
              data: [{
                price: {
                  metadata: {
                    tier: 'enterprise'
                  }
                }
              }]
            }
          }
        }
      };

      const result = stripeWebhook.handleSubscriptionUpdated(updateEvent);

      assert.strictEqual(result.success, true);

      const stored = db.prepare('SELECT * FROM licenses WHERE subscription_id = ?').get('sub_upgrade');
      assert.strictEqual(stored.tier, 'enterprise');
    });

    it('should update seats count on subscription update', () => {
      const checkoutEvent = {
        id: 'evt_checkout_seats',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_seats',
            customer: 'cus_seats',
            subscription: 'sub_seats',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      const updateEvent = {
        id: 'evt_sub_seats',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_seats',
            customer: 'cus_seats',
            quantity: 10,
            items: {
              data: [{
                price: {
                  metadata: {
                    tier: 'pro'
                  }
                }
              }]
            }
          }
        }
      };

      const result = stripeWebhook.handleSubscriptionUpdated(updateEvent);

      assert.strictEqual(result.success, true);
      // Seats count should be updated in license metadata
    });

    it('should handle subscription downgrade', () => {
      const checkoutEvent = {
        id: 'evt_checkout_downgrade',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_downgrade',
            customer: 'cus_downgrade',
            subscription: 'sub_downgrade',
            metadata: {
              tier: 'enterprise',
              seats: '10'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      const updateEvent = {
        id: 'evt_sub_downgrade',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_downgrade',
            customer: 'cus_downgrade',
            items: {
              data: [{
                price: {
                  metadata: {
                    tier: 'pro'
                  }
                }
              }]
            }
          }
        }
      };

      const result = stripeWebhook.handleSubscriptionUpdated(updateEvent);

      assert.strictEqual(result.success, true);

      const stored = db.prepare('SELECT * FROM licenses WHERE subscription_id = ?').get('sub_downgrade');
      assert.strictEqual(stored.tier, 'pro');
    });
  });

  describe('handleSubscriptionDeleted()', () => {
    it('should revoke license on subscription cancellation', () => {
      // First create a license
      const checkoutEvent = {
        id: 'evt_checkout_cancel',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_cancel',
            customer: 'cus_cancel',
            subscription: 'sub_cancel',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      // Now cancel subscription
      const deleteEvent = {
        id: 'evt_sub_delete',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_cancel',
            customer: 'cus_cancel'
          }
        }
      };

      const result = stripeWebhook.handleSubscriptionDeleted(deleteEvent);

      assert.strictEqual(result.success, true);

      const stored = db.prepare('SELECT * FROM licenses WHERE subscription_id = ?').get('sub_cancel');
      assert.strictEqual(stored.status, 'revoked');
    });

    it('should handle cancellation of non-existent license', () => {
      const deleteEvent = {
        id: 'evt_sub_delete_nonexistent',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_nonexistent',
            customer: 'cus_nonexistent'
          }
        }
      };

      const result = stripeWebhook.handleSubscriptionDeleted(deleteEvent);

      // Should not throw error, just return success
      assert.strictEqual(result.success, true);
    });
  });

  describe('handleInvoicePaymentFailed()', () => {
    it('should enter grace period on payment failure', () => {
      // First create a license
      const checkoutEvent = {
        id: 'evt_checkout_grace',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_grace',
            customer: 'cus_grace',
            subscription: 'sub_grace',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      // Simulate payment failure
      const invoiceEvent = {
        id: 'evt_invoice_failed',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_failed',
            customer: 'cus_grace',
            subscription: 'sub_grace',
            attempt_count: 1
          }
        }
      };

      const result = stripeWebhook.handleInvoicePaymentFailed(invoiceEvent);

      assert.strictEqual(result.success, true);

      const stored = db.prepare('SELECT * FROM licenses WHERE subscription_id = ?').get('sub_grace');
      assert.strictEqual(stored.status, 'grace_period');
    });

    it('should revoke license after multiple payment failures', () => {
      // First create a license
      const checkoutEvent = {
        id: 'evt_checkout_revoke',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_revoke',
            customer: 'cus_revoke',
            subscription: 'sub_revoke',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      stripeWebhook.handleCheckoutCompleted(checkoutEvent);

      // Simulate 3 payment failures
      for (let i = 1; i <= 3; i++) {
        const invoiceEvent = {
          id: `evt_invoice_failed_${i}`,
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: `in_failed_${i}`,
              customer: 'cus_revoke',
              subscription: 'sub_revoke',
              attempt_count: i
            }
          }
        };

        stripeWebhook.handleInvoicePaymentFailed(invoiceEvent);
      }

      const stored = db.prepare('SELECT * FROM licenses WHERE subscription_id = ?').get('sub_revoke');
      assert.strictEqual(stored.status, 'revoked');
    });
  });

  describe('handle() - main webhook handler', () => {
    it('should route checkout.session.completed event', () => {
      const event = {
        id: 'evt_route_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_route',
            customer: 'cus_route',
            subscription: 'sub_route',
            metadata: {
              tier: 'pro',
              seats: '5'
            },
            payment_status: 'paid'
          }
        }
      };

      const result = stripeWebhook.handle(event);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.event_type, 'checkout.session.completed');
    });

    it('should route customer.subscription.updated event', () => {
      const event = {
        id: 'evt_route_update',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_route_update',
            customer: 'cus_route_update',
            items: {
              data: [{
                price: {
                  metadata: {
                    tier: 'enterprise'
                  }
                }
              }]
            }
          }
        }
      };

      const result = stripeWebhook.handle(event);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.event_type, 'customer.subscription.updated');
    });

    it('should route customer.subscription.deleted event', () => {
      const event = {
        id: 'evt_route_delete',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_route_delete',
            customer: 'cus_route_delete'
          }
        }
      };

      const result = stripeWebhook.handle(event);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.event_type, 'customer.subscription.deleted');
    });

    it('should route invoice.payment_failed event', () => {
      const event = {
        id: 'evt_route_invoice',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_route',
            customer: 'cus_route_invoice',
            subscription: 'sub_route_invoice',
            attempt_count: 1
          }
        }
      };

      const result = stripeWebhook.handle(event);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.event_type, 'invoice.payment_failed');
    });

    it('should ignore unknown event types', () => {
      const event = {
        id: 'evt_unknown',
        type: 'unknown.event',
        data: {
          object: {}
        }
      };

      const result = stripeWebhook.handle(event);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.ignored, true);
    });
  });
});

// Helper function to generate Stripe webhook signature
function generateStripeSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = `${timestamp}.${JSON.stringify(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');

  return `t=${timestamp},v1=${signature}`;
}