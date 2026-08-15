import { randomBytes, randomUUID } from 'node:crypto';

const MATERIAL = new Map();
export const safeManagementError = () => ({ code: 'MANAGEMENT_OPERATION_FAILED', message: 'The operation could not be completed safely.' });
export function createOneTimeDisclosure({ keyId, material, ttlMs = 60000 }) { const nonce = randomUUID(); MATERIAL.set(nonce, { keyId, material, expiresAt: Date.now() + ttlMs, consumed: false }); return { nonce, expiresAt: new Date(Date.now() + ttlMs).toISOString() }; }
export function consumeOneTimeDisclosure(nonce, keyId) { const entry = MATERIAL.get(nonce); MATERIAL.delete(nonce); if (!entry || entry.consumed || entry.keyId !== keyId || entry.expiresAt < Date.now()) return null; entry.consumed = true; return entry.material; }
export function clearOneTimeDisclosure(nonce) { MATERIAL.delete(nonce); }
export function generateSecretMaterial() { return `mk-${randomBytes(24).toString('base64url')}`; }
export function publicCredential(row) { const { secret, material, ...safe } = row; return safe; }
export function sanitizeManagementResponse(value) { return JSON.parse(JSON.stringify(value, (key, current) => /secret|credential|password|authorization/i.test(key) ? undefined : current)); }
export function redactManagementText(value) { return String(value ?? '').replace(/(?:mk-|sk-|Bearer\s+)[A-Za-z0-9_=-]+/gi, '[REDACTED]'); }
/** Browser-safe cleanup used by disclosure close, Escape, reload listeners, and route disposal. */
export function clearSecretDom(root) { if (!root?.querySelectorAll) return; for (const node of root.querySelectorAll('[data-management-secret]')) { node.textContent = ''; node.removeAttribute('data-management-secret'); } }
