import { actionButton, feedback, labeledInput } from './ui-primitives.mjs';
import { clearOnboardingDraft, createOnboardingDraft, loadOnboardingDraft, persistOnboardingDraft, validateOnboardingDraft } from './onboarding-draft.mjs';

const DRAFT_KEY = 'meridianos.onboarding.draft.v1';
const COMPLETION_KEY = 'meridianos.onboarding.completion.v1';
const steps = ['identity', 'provider', 'budget', 'review', 'complete'];
const stepLabels = { identity: 'Installation', provider: 'Provider', budget: 'Budget', review: 'Review', complete: 'Complete' };
const text = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });
function api(path, init = {}) {
  const headers = { ...(init.headers ?? {}), 'content-type': 'application/json' };
  if (window.AIOS_TOKEN) headers['x-aios-token'] = window.AIOS_TOKEN;
  return fetch(path, { ...init, headers });
}
function statusMessage(code) {
  return ({ provider_auth_failed: 'The provider did not accept that credential. Enter it again and retry.', provider_unreachable: 'The provider could not be reached. Check your connection and retry.', provider_timeout: 'The provider took too long to respond. Retry when it is available.', provider_validation_required: 'Validate this provider again before continuing.', existing_installation: 'An existing installation was found. Use the dashboard to manage it instead.', secure_storage_unavailable: 'Secure storage is unavailable. Unlock or configure your system keychain, then retry.', secure_storage_existing: 'A secure provider credential already exists. Manage that installation instead of overwriting it.' })[code] ?? 'We could not complete that step. Try again.';
}

export function createOnboardingController({ root, storage = window.localStorage } = {}) {
  let draft = loadOnboardingDraft(storage, DRAFT_KEY);
  let providers = [];
  let transientCredential = '';
  let review = null;
  let storageAvailable = true;
  try {
    const completion = JSON.parse(storage.getItem(COMPLETION_KEY) || 'null');
    if (location.pathname.endsWith('/complete') && completion?.checklist?.firstTaskTarget) {
      review = { checklist: { firstTaskTarget: String(completion.checklist.firstTaskTarget), firstRunTarget: null } };
      draft = createOnboardingDraft({ ...draft, lastSafeStep: 'complete' });
    }
  } catch { storageAvailable = false; }
  const startedAt = performance.now();
  const elapsedMs = () => Math.max(0, Math.round(performance.now() - startedAt));
  const save = () => { storageAvailable = persistOnboardingDraft(storage, DRAFT_KEY, draft); return storageAvailable; };
  const clearCredential = () => { transientCredential = ''; };
  const setStep = (step) => {
    // Returning to an earlier step intentionally discards the DOM-only secret.
    // A refresh, browser history navigation, or revalidation therefore requires
    // a fresh credential entry rather than silently retaining it.
    if (['identity', 'provider'].includes(step)) clearCredential();
    draft = createOnboardingDraft({ ...draft, lastSafeStep: step }); save(); render();
  };
  window.addEventListener('pagehide', clearCredential, { once: true });
  const addStatus = (message, error = false) => {
    const notice = feedback(message, { error });
    if (error) { notice.tabIndex = -1; root.append(notice); notice.focus(); }
    else root.append(notice);
  };
  function stepper() {
    const nav = document.createElement('nav'); nav.className = 'setup-stepper'; nav.setAttribute('aria-label', 'Setup progress'); const list = document.createElement('ol'); list.setAttribute('role', 'list');
    for (const [index, step] of steps.entries()) { const item = text('li', stepLabels[step]); item.setAttribute('role', 'listitem'); item.setAttribute('aria-label', `${stepLabels[step]}, step ${index + 1} of ${steps.length}`); item.setAttribute('aria-current', draft.lastSafeStep === step ? 'step' : 'false'); list.append(item); }
    nav.append(list); return nav;
  }
  function identity() {
    const section = document.createElement('section'); section.className = 'card'; section.append(text('h1', 'Name your installation'), text('p', 'Choose a name and the agents that will work on your first tasks.'));
    const name = labeledInput('Installation name', { id: 'onboarding-name', value: draft.installationName }); const agents = labeledInput('Agent roster (comma-separated)', { id: 'onboarding-agents', value: draft.agents.join(', ') });
    section.append(name.label, agents.label, actionButton('Continue', { onClick: () => { const nextDraft = createOnboardingDraft({ ...draft, installationName: name.input.value, agents: agents.input.value.split(',') }); try { validateOnboardingDraft({ ...nextDraft, provider: { id: 'pending' } }); draft = nextDraft; setStep('provider'); } catch (error) { addStatus(error.message, true); } } })); return section;
  }
  function provider() {
    const section = document.createElement('section'); section.className = 'card'; section.append(text('h1', 'Connect a provider'), text('p', 'Your credential is used only to validate and commit this setup. It is never saved in this browser.'));
    const selectLabel = text('label', 'Provider'); const select = document.createElement('select'); select.id = 'onboarding-provider'; selectLabel.htmlFor = select.id;
    for (const provider of providers) { const option = text('option', provider.label); option.value = provider.id; option.selected = draft.provider?.id === provider.id; select.append(option); }
    const credential = labeledInput('Provider credential', { id: 'onboarding-credential', type: 'password' }); credential.input.autocomplete = 'off';
    const test = actionButton('Validate provider', { onClick: async () => { transientCredential = credential.input.value; if (!select.value || !transientCredential) return addStatus('Choose a provider and enter its credential.', true); test.disabled = true; try { const desktop = window.meridianos?.onboarding; const body = desktop ? await desktop.validateCredential(select.value, transientCredential) : await (async () => { const response = await api('/api/onboarding/provider-validation', { method: 'POST', body: JSON.stringify({ draftRevision: draft.revision, provider: { id: select.value }, credential: transientCredential, elapsedMs: elapsedMs() }) }); return response.json(); })(); if (!body.ok || body.result?.status !== 'valid') { transientCredential = ''; credential.input.value = ''; return addStatus(statusMessage(body.result?.messageCode ?? body.code), true); } draft = createOnboardingDraft({ ...draft, provider: { id: select.value }, validation: body.result, revision: body.revision, lastSafeStep: 'budget' }); save(); render(); } catch { transientCredential = ''; credential.input.value = ''; addStatus('Provider validation is unavailable. Retry when you are online.', true); } finally { test.disabled = false; } } });
    section.append(selectLabel, select, credential.label, actionButton('Back', { onClick: () => setStep('identity') }), test); return section;
  }
  function budget() {
    const section = document.createElement('section'); section.className = 'card'; section.append(text('h1', 'Set your budget'), text('p', 'Choose a positive monthly USD limit. You will review the resulting policy before anything is written.'));
    const input = labeledInput('Monthly budget (USD)', { id: 'onboarding-budget', type: 'number', value: String(draft.monthlyBudgetUsd) }); input.input.min = '1'; input.input.step = '1';
    section.append(input.label, actionButton('Back', { onClick: () => setStep('provider') }), actionButton('Review setup', { onClick: async () => { try { draft = validateOnboardingDraft({ ...draft, monthlyBudgetUsd: Number(input.input.value) }, { requireValidation: true }); save(); const response = await api('/api/onboarding/preview', { method: 'POST', body: JSON.stringify({ draft }) }); const body = await response.json(); if (!body.ok) return addStatus(statusMessage(body.code), true); review = body.review; setStep('review'); } catch (error) { addStatus(error.message, true); } } })); return section;
  }
  function reviewStep() {
    const section = document.createElement('section'); section.className = 'card'; section.append(text('h1', 'Review setup'));
    if (!review) { section.append(feedback('Your setup review is no longer available. Return to the budget step to refresh it.', { error: true }), actionButton('Back to budget', { onClick: () => setStep('budget') })); return section; }
    const summary = document.createElement('dl'); for (const [label, value] of [['Provider', review.provider.label], ['Agents', review.agents.join(', ')], ['Monthly budget', `$${review.monthlyBudgetUsd}`], ['Files', review.files.join(', ')]]) summary.append(text('dt', label), text('dd', value));
    const confirm = document.createElement('input'); confirm.type = 'checkbox'; confirm.id = 'onboarding-confirm'; const label = text('label', 'I have reviewed these non-secret changes.'); label.htmlFor = confirm.id;
    section.append(summary, confirm, label, actionButton('Back', { onClick: () => setStep('budget') }), actionButton('Commit setup', { onClick: async () => { if (!confirm.checked) return addStatus('Confirm the review before committing setup.', true); if (!transientCredential) return addStatus('Enter and validate the provider credential again before committing.', true); try { draft = createOnboardingDraft({ ...draft, reviewConfirmed: true }); const desktop = window.meridianos?.onboarding; let body; if (desktop) { const stored = await desktop.storeCredential(draft.provider.id, transientCredential); body = stored.ok ? await desktop.commitSetup(draft) : stored; } else { const response = await api('/api/onboarding/commit', { method: 'POST', body: JSON.stringify({ draft, credential: transientCredential, elapsedMs: elapsedMs() }) }); body = await response.json(); } transientCredential = ''; if (!body.ok) return addStatus(statusMessage(body.code), true); clearOnboardingDraft(storage, DRAFT_KEY); try { storage.setItem(COMPLETION_KEY, JSON.stringify({ checklist: body.checklist })); } catch { storageAvailable = false; } review = body; draft = createOnboardingDraft({ ...draft, lastSafeStep: 'complete' }); history.replaceState({}, '', '/app/setup/complete'); render(); } catch { transientCredential = ''; addStatus('Setup could not be committed. No credentials were saved in this browser.', true); } } })); return section;
  }
  function complete() {
    const section = document.createElement('section'); section.className = 'card';
    section.append(text('h1', 'Setup complete'), text('p', 'Your provider and budget are ready. Continue to your first task, then return here to observe its first run.'));
    const task = document.createElement('a'); task.href = review?.checklist?.firstTaskTarget ?? '/?workspace=admin'; task.textContent = 'Create or import your first task';
    const run = text('p', 'Your first-run link will appear after a task creates a run.'); run.dataset.firstRun = 'unavailable'; section.append(task, run);
    const requestedRun = new URLSearchParams(location.search).get('run');
    void (async () => {
      try {
        const response = await fetch('/api/onboarding/checklist'); const body = await response.json(); const firstRun = body.firstRun;
        if (!body.ok || !firstRun?.id) return;
        const link = document.createElement('a'); link.href = firstRun.target; link.textContent = 'View first run'; link.dataset.firstRun = firstRun.id;
        run.replaceWith(link);
        if (requestedRun === firstRun.id) {
          const detailResponse = await fetch(`/api/run?id=${encodeURIComponent(firstRun.id)}`); const detail = await detailResponse.json();
          if (detail.ok) { const status = text('p', `Observing first run ${detail.run.run_id}: ${detail.run.outcome ?? 'unknown'}.`); status.dataset.firstRunStatus = String(detail.run.outcome ?? 'unknown'); link.after(status); }
        }
      } catch { run.textContent = 'Your first-run link will appear after a task creates a run.'; }
    })();
    return section;
  }
  async function render() { root.replaceChildren(stepper()); if (!storageAvailable) root.append(feedback('Browser storage is unavailable. Your non-secret choices will not resume after this tab closes.', { error: true })); if (!providers.length && draft.lastSafeStep !== 'complete') { try { const response = await fetch('/api/onboarding/status'); const body = await response.json(); if (body.installation === 'configured' || body.installation === 'repair_needed') { root.append(feedback(body.installation === 'repair_needed' ? 'A partial installation needs repair. MeridianOS will not overwrite it.' : 'An existing installation was found. Use the dashboard to manage it.', { error: true })); return; } providers = body.providers ?? []; const desktopProviders = window.meridianos?.onboarding?.capabilities?.providerIds; if (Array.isArray(desktopProviders)) providers = providers.filter((provider) => desktopProviders.includes(provider.id)); if (!providers.length) { root.append(feedback('No securely supported provider is available on this device. Use the legacy setup recovery path.', { error: true })); return; } } catch { root.append(feedback('Setup status is unavailable. Retry shortly.', { error: true })); return; } } root.append(({ identity, provider, budget, review: reviewStep, complete }[draft.lastSafeStep] ?? identity)()); }
  return { render, dispose: clearCredential, reset: () => { clearOnboardingDraft(storage, DRAFT_KEY); draft = createOnboardingDraft(); clearCredential(); review = null; render(); } };
}
