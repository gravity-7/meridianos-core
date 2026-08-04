/**
 * keychain — OS keychain-backed API key storage for the Electron desktop app (FR-005), via
 * `keytar` (Windows Credential Manager / macOS Keychain / Linux libsecret — the second justified
 * zero-dependency exception, constitution III). Kept as a plain .mjs module (no `electron` import)
 * so it's unit-testable with Node's test runner and an injected fake `keytar`.
 *
 * T036 — error handling: every call is wrapped so a keychain access failure (locked keyring,
 * missing libsecret on a minimal Linux install, denied permission) degrades to a null/false
 * result with a descriptive error, rather than crashing the app or losing the user's key.
 */

export const SERVICE_NAME = 'meridianos';
export const ACCOUNTS = {
  anthropic: 'anthropic-api-key',
  deepseek: 'deepseek-api-key',
};

/**
 * Store `value` under `account` in the OS keychain.
 * @param {{keytar: object, account: string, value: string}} opts
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function setApiKey({ keytar, account, value }) {
  try {
    await keytar.setPassword(SERVICE_NAME, account, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Retrieve the value stored under `account`, or `null` if absent/inaccessible.
 * @param {{keytar: object, account: string}} opts
 * @returns {Promise<{ok: boolean, value: string|null, error?: string}>}
 */
export async function getApiKey({ keytar, account }) {
  try {
    const value = await keytar.getPassword(SERVICE_NAME, account);
    return { ok: true, value: value ?? null };
  } catch (err) {
    return { ok: false, value: null, error: String(err?.message || err) };
  }
}

/** Delete the stored credential for `account`. Never throws. */
export async function deleteApiKey({ keytar, account }) {
  try {
    const deleted = await keytar.deletePassword(SERVICE_NAME, account);
    return { ok: true, deleted };
  } catch (err) {
    return { ok: false, deleted: false, error: String(err?.message || err) };
  }
}

/**
 * Load every known provider key from the keychain into an env-var map suitable for spawning the
 * daemon (ANTHROPIC_API_KEY / DEEPSEEK_KEY — matching gateway/known-providers.json's `keyEnv`).
 * A keychain failure for one provider doesn't block the others; `errors` reports which, if any,
 * couldn't be read.
 * @param {{keytar: object}} opts
 * @returns {Promise<{env: object, errors: Array<{account: string, error: string}>}>}
 */
export async function loadDaemonEnv({ keytar }) {
  const env = {};
  const errors = [];

  const anthropic = await getApiKey({ keytar, account: ACCOUNTS.anthropic });
  if (anthropic.ok && anthropic.value) env.ANTHROPIC_API_KEY = anthropic.value;
  else if (!anthropic.ok) errors.push({ account: ACCOUNTS.anthropic, error: anthropic.error });

  const deepseek = await getApiKey({ keytar, account: ACCOUNTS.deepseek });
  if (deepseek.ok && deepseek.value) env.DEEPSEEK_KEY = deepseek.value;
  else if (!deepseek.ok) errors.push({ account: ACCOUNTS.deepseek, error: deepseek.error });

  return { env, errors };
}
