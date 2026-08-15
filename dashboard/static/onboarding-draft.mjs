/**
 * Safe, resumable onboarding state. This module deliberately has no field for a
 * credential or raw provider response: callers must keep those in an input only.
 */
export const ONBOARDING_DRAFT_VERSION = 1;

const safeText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const safeAgents = (agents) => Array.isArray(agents)
  ? [...new Set(agents.map((agent) => safeText(agent)).filter(Boolean))]
  : [];

function safeProvider(provider) {
  if (!provider || typeof provider !== 'object' || !safeText(provider.id)) return null;
  const metadata = provider.metadata && typeof provider.metadata === 'object'
    ? Object.fromEntries(Object.entries(provider.metadata).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    : {};
  return { id: safeText(provider.id), metadata };
}

function safeValidation(validation, provider) {
  if (!validation || typeof validation !== 'object' || !provider || validation.providerId !== provider.id) return null;
  const status = ['valid', 'invalid', 'unreachable', 'timeout'].includes(validation.status) ? validation.status : null;
  if (!status) return null;
  return {
    providerId: provider.id,
    status,
    retryable: validation.retryable === true,
    messageCode: safeText(validation.messageCode, 'provider_validation_required'),
    latencyMs: Number.isFinite(validation.latencyMs) ? Math.max(0, validation.latencyMs) : null,
    modelsFound: Number.isFinite(validation.modelsFound) ? Math.max(0, validation.modelsFound) : null,
    testedAt: safeText(validation.testedAt) || null,
  };
}

export function createOnboardingDraft(input = {}) {
  const provider = safeProvider(input.provider);
  return {
    version: ONBOARDING_DRAFT_VERSION,
    installationName: safeText(input.installationName, 'My Tenant'),
    agents: safeAgents(Object.hasOwn(input, 'agents') ? input.agents : ['builder', 'reviewer']),
    monthlyBudgetUsd: Number(input.monthlyBudgetUsd ?? 100),
    provider,
    validation: safeValidation(input.validation, provider),
    lastSafeStep: ['identity', 'provider', 'budget', 'review', 'complete'].includes(input.lastSafeStep) ? input.lastSafeStep : 'identity',
    reviewConfirmed: input.reviewConfirmed === true,
    revision: safeText(input.revision) || crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
}

export function validateOnboardingDraft(input, { requireValidation = false } = {}) {
  const draft = createOnboardingDraft(input);
  if (!draft.installationName) throw new Error('installation name is required');
  if (!draft.agents.length) throw new Error('at least one agent is required');
  if (!Number.isFinite(draft.monthlyBudgetUsd) || draft.monthlyBudgetUsd <= 0) throw new Error('monthly budget must be a positive number');
  if (!draft.provider) throw new Error('a provider is required');
  if (requireValidation && draft.validation?.status !== 'valid') throw new Error('a validated provider is required');
  return draft;
}

export function serializeOnboardingDraft(input) {
  const draft = createOnboardingDraft(input);
  // Stringify a fixed allow-list rather than cloning arbitrary caller fields.
  return JSON.stringify({
    version: draft.version, installationName: draft.installationName, agents: draft.agents,
    monthlyBudgetUsd: draft.monthlyBudgetUsd, provider: draft.provider, validation: draft.validation,
    lastSafeStep: draft.lastSafeStep, reviewConfirmed: draft.reviewConfirmed, revision: draft.revision,
    updatedAt: draft.updatedAt,
  });
}

export function deserializeOnboardingDraft(serialized) {
  try { return createOnboardingDraft(JSON.parse(serialized)); } catch { return createOnboardingDraft(); }
}

export function persistOnboardingDraft(storage, key, draft) {
  try { storage.setItem(key, serializeOnboardingDraft(draft)); return true; } catch { return false; }
}

export function loadOnboardingDraft(storage, key) {
  try { return deserializeOnboardingDraft(storage.getItem(key) || ''); } catch { return createOnboardingDraft(); }
}

export function clearOnboardingDraft(storage, key) {
  try { storage.removeItem(key); return true; } catch { return false; }
}
