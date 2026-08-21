import { make, notice, page, formPanel, badge, money, instant, iconLabel } from '../../shared/view-helpers.mjs';

export async function renderRoute(context) {
  const view = page('AI Provider Subscriptions', 'Manage subscription-based plans (Claude Pro, Copilot, Anti-Gravity) alongside BYO-key gateway traffic.');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  let data = { subscriptions: [], combinedMonthlyTotal: 0 };
  try {
    const res = await fetch('/api/subscriptions');
    data = await res.json();
  } catch (err) {
    feedback.replaceChildren(notice('Failed to load subscriptions data.', { error: true }));
  }

  // Combined Monthly Commitment Banner
  const totalBanner = make('div', null, 'combined-total-banner');
  const totalLabel = make('span', 'Combined Monthly Commitment:');
  const totalVal = make('strong', money(data.combinedMonthlyTotal || 0));
  totalBanner.append(totalLabel, totalVal);

  // Subscriptions List
  const listCard = make('div', null, 'subscriptions-list-card');
  const listTitle = make('h2', 'Active Provider Plans');
  const subList = make('div', null, 'subscriptions-items');

  if (!data.subscriptions || !data.subscriptions.length) {
    subList.append(notice('No subscription plans are currently configured.'));
  } else {
    for (const sub of data.subscriptions) {
      const row = make('div', null, 'subscription-row');
      
      const info = make('div', null, 'subscription-info');
      const planName = make('strong', sub.planName, 'subscription-plan-name');
      const activeBadge = badge('Active', 'ok');
      const costBadge = make('span', `${money(sub.monthlyCostUsd)}/mo`, 'subscription-cost');
      const envTag = make('code', `env: ${sub.tokenEnv || '—'}`, 'entity-tag');
      
      info.append(planName, activeBadge, costBadge, envTag);

      const reportBtn = make('button', 'Report broken', 'btn-secondary');
      reportBtn.title = 'Report broken token extraction';
      reportBtn.addEventListener('click', () => {
        const url = `https://github.com/gravity-7/meridianos-core/issues/new?title=Subscription%20token%20extraction%20broken:%20${encodeURIComponent(sub.providerName || sub.planName)}&labels=bug,docs`;
        window.open(url, '_blank');
      });

      row.append(info, reportBtn);
      subList.append(row);
    }
  }

  listCard.append(listTitle, subList);

  // Add Subscription Form Card
  const addForm = make('form', null, 'management-form');
  const fieldset = make('div', null, 'subscription-form-grid');

  const providerLabel = make('label', 'Provider Plan');
  const providerSelect = make('select');
  const provOpts = [
    { val: 'claude_pro', text: 'Anthropic Claude Pro ($20/mo)' },
    { val: 'copilot', text: 'GitHub Copilot ($10/mo)' },
    { val: 'antigravity', text: 'Google Antigravity ($20/mo)' },
    { val: 'custom', text: 'Custom Subscription' }
  ];
  for (const opt of provOpts) {
    const o = make('option', opt.text); o.value = opt.val;
    providerSelect.append(o);
  }
  providerLabel.append(providerSelect);

  const envLabel = make('label', 'Session / Token Env Name');
  const envInput = make('input');
  envInput.placeholder = 'e.g. CLAUDE_CODE_TOKEN';
  envInput.required = true;
  envLabel.append(envInput);

  const legalLabel = make('label', null, 'checkbox-label');
  const legalCheck = make('input', null, 'custom-checkbox');
  legalCheck.type = 'checkbox';
  legalCheck.id = 'sub-legal-check';
  legalCheck.required = true;
  legalLabel.htmlFor = 'sub-legal-check';
  const textSpan = make('span', ' I acknowledge subscription token proxy compliance terms.', 'checkbox-text');
  legalLabel.append(legalCheck, textSpan);

  const submitBtn = make('button', '+ Add Subscription Plan', 'btn-primary');
  submitBtn.type = 'submit';

  fieldset.append(providerLabel, envLabel);
  addForm.append(fieldset, legalLabel, submitBtn);

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding…';
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: providerSelect.value,
          tokenEnv: envInput.value.trim()
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      feedback.replaceChildren(notice('Subscription plan added successfully.'));
      void context.refresh();
    } catch (err) {
      feedback.replaceChildren(notice(`Failed to add subscription: ${err.message}`, { error: true }));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '+ Add Subscription Plan';
    }
  });

  const formPanelCard = formPanel(document, {
    title: 'Add AI Provider Subscription',
    icon: 'cash',
    subtitle: 'Register a fixed-cost subscription plan for gateway cost amortization.'
  }, addForm);

  view.node.append(totalBanner, listCard, formPanelCard, feedback);
  context.root.replaceChildren(view.node);
}
