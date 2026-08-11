# API-key lifecycle

Management API keys disclose generated material once. Close, reload, history navigation, expiry, or a consumed nonce removes the material; metadata, audit evidence, diagnostics, and routes never retain it. A lost key is replaced, never recovered. Rotation records a policy-bounded overlap (one hour by default, never more than 24 hours); emergency revocation has no overlap and requires fresh reauthentication plus `REVOKE <key name>` confirmation.
