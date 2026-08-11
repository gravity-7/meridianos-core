# Webhook recovery

Delivery history is tenant/project scoped, cursor-paginated, response-redacted, and retained for 30 days. Only retained terminal failures can replay. Replay uses a deterministic delivery-generation idempotency key, records a reason and correlation, and returns duplicate or ineligible outcomes without making an outbound request.
