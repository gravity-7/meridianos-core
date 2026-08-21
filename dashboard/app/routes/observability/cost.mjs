import { make, link, money, number, instant, page, table, scopeText, iconLabel, badge, notice } from '../../shared/view-helpers.mjs';
import { renderOperationalChart } from '../../shared/chart-adapter.mjs';
import { inheritScope } from '../../shared/operational-scope.mjs';
import { dashboardPanel, renderPanelFamily } from '../../shared/dashboard-panels.mjs';

function panelStat(documentRef, title, value, caption, badgeNode = null) {
  const panel = dashboardPanel(documentRef, { title, kind: 'stat' });
  const strong = make('strong', value == null ? '—' : String(value));
  const footer = make('div', null, 'panel-stat-footer');
  footer.append(make('span', caption ?? 'No data', 'stat-caption'));
  if (badgeNode) footer.append(badgeNode);
  panel.append(strong, footer);
  return panel;
}

const dimensions = ['provider','model','project','agent','task','run'];

export async function renderRoute(context) {
  const data = await context.api.read('/cost'); if (!context.isCurrent()) return;
  const dimension = dimensions.includes(context.url.searchParams.get('dimension')) ? context.url.searchParams.get('dimension') : 'provider';
  const view = page('Cost drivers and budget', 'Selected-scope spend and traceable provider, model, project, task, and run attribution from the canonical gateway ledger.');
  view.node.append(make('p', scopeText(context.scope), 'scope-summary'));

  // 1. Executive Budget & Financial Summary + Emergency Pause
  const summaryLayout = make('div', null, 'cost-summary-layout');
  const budgetHost = make('div');
  const budgetLimit = data.summary.budget?.monthlyLimit || 0;
  const monthSpend = data.summary.budget?.spend || 0;
  const budgetPct = budgetLimit > 0 ? Math.min(100, Math.round((monthSpend / budgetLimit) * 100)) : 0;
  const forecastStatus = data.summary.budget?.forecast > budgetLimit && budgetLimit > 0 ? 'Exceeding' : budgetPct > 80 ? 'Near limit' : 'On track';

  renderPanelFamily(budgetHost, {
    title: 'Current-month budget signals',
    kind: 'table',
    headers: ['Signal', 'Value'],
    budget: {
      spendFormatted: money(monthSpend),
      limitFormatted: money(budgetLimit),
      percent: budgetPct,
      forecastStatus,
      forecastFormatted: money(data.summary.budget?.forecast)
    },
    rows: [
      ['Spend / limit', `${money(monthSpend)} / ${money(budgetLimit)} (${budgetPct}%)`],
      ['Forecast', money(data.summary.budget?.forecast)],
      ['Daily burn rate', `${money(data.summary.budget?.dailyBurnRate)}/day`],
      ['Period', `${data.summary.budget?.periodFrom?.slice(0, 10)} to ${data.summary.budget?.periodTo?.slice(0, 10)}`]
    ]
  });
  summaryLayout.append(budgetHost.firstElementChild || budgetHost);

  const kpiGrid = make('div', null, 'cost-kpi-grid');
  kpiGrid.append(
    panelStat(document, 'Selected-Scope Spend', money(data.summary.spend), 'within time window', badge(data.summary.currency, 'info')),
    panelStat(document, 'Projected Month-End', money(data.summary.budget?.forecast), `trailing 7-day burn: ${money(data.summary.budget?.dailyBurnRate)}/day`, badge(forecastStatus.toLowerCase(), forecastStatus === 'On track' ? 'ok' : forecastStatus === 'Near limit' ? 'warning' : 'critical')),
    panelStat(document, 'Pricing Integrity', data.summary.unknownCostEvents === 0 ? '100%' : `${number(data.summary.unknownCostEvents)} unpriced`, 'unattributed cost events', badge(data.summary.unknownCostEvents === 0 ? 'attributed' : 'unpriced', data.summary.unknownCostEvents === 0 ? 'ok' : 'warning'))
  );
  summaryLayout.append(kpiGrid);

  const semanticList = make('dl', null, 'panel-family-list definition-list visually-hidden');
  for (const [label, val] of [
    ['Selected-scope spend', money(data.summary.spend)],
    ['Unknown-cost events', number(data.summary.unknownCostEvents)],
    ['Currency', data.summary.currency],
    ['Current-month period', `${data.summary.budget.periodFrom} to ${data.summary.budget.periodTo}`],
    ['Current-month spend', money(data.summary.budget.spend)],
    ['Monthly limit', money(data.summary.budget.monthlyLimit)],
    ['Forecast (trailing-seven-day rule)', money(data.summary.budget.forecast)]
  ]) {
    semanticList.append(make('dt', label), make('dd', val, 'panel-family-val'));
  }
  view.node.append(summaryLayout, semanticList);
  if (data.summary.budget?.periodLabel) view.node.append(make('p', data.summary.budget.periodLabel, 'notice'));

  // 2. Emergency Controls & Cost Optimization Section
  const opsSection = make('div', null, 'cost-intelligence-grid');

  // Emergency Spend Freeze Card
  const pauseCard = make('div', null, 'emergency-pause-card');
  const pauseHead = make('div', null, 'emergency-card-head');
  pauseHead.append(make('strong', 'Emergency Spend Controls', 'emergency-title'), badge('Gateway Protection', 'default'));
  const pauseDesc = make('p', 'Immediately halt all outbound LLM API token spend across all autonomous agents and tasks.', 'emergency-desc');
  const pauseBtn = make('button', '⏸ Pause AI Spend', 'btn-warning emergency-btn');
  const pauseReason = make('div', null, 'emergency-status-text');

  let isPaused = false;
  try {
    const bRes = await fetch('/api/budget/pause');
    const bData = await bRes.json();
    isPaused = !!bData.paused;
    if (isPaused) {
      pauseBtn.textContent = '▶ Resume AI Spend';
      pauseBtn.classList.remove('btn-warning');
      pauseBtn.classList.add('btn-primary');
      pauseReason.textContent = `⚠️ Spend paused: ${bData.reason || 'Manual emergency freeze'}`;
    } else {
      pauseReason.textContent = '✓ Gateway spend is active and unblocked.';
    }
  } catch {}

  pauseBtn.addEventListener('click', async () => {
    pauseBtn.disabled = true;
    try {
      if (isPaused) {
        await fetch('/api/budget/pause', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paused: false })
        });
        isPaused = false;
        pauseBtn.textContent = '⏸ Pause AI Spend';
        pauseBtn.classList.remove('btn-primary');
        pauseBtn.classList.add('btn-warning');
        pauseReason.textContent = '✓ Gateway spend is active and unblocked.';
      } else {
        const reason = prompt('Reason for emergency spend freeze:') || 'Manual pause from dashboard';
        await fetch('/api/budget/pause', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paused: true, reason })
        });
        isPaused = true;
        pauseBtn.textContent = '▶ Resume AI Spend';
        pauseBtn.classList.remove('btn-warning');
        pauseBtn.classList.add('btn-primary');
        pauseReason.textContent = `⚠️ Spend paused: ${reason}`;
      }
    } catch (err) {
      alert(`Emergency toggle failed: ${err.message}`);
    } finally {
      pauseBtn.disabled = false;
    }
  });

  pauseCard.append(pauseHead, pauseDesc, pauseBtn, pauseReason);

  // Cost Optimization Recommendations Card
  const optCard = make('div', null, 'optimization-card');
  const optHead = make('div', null, 'optimization-card-head');
  const optTitle = make('strong', 'Cost Optimization Recommendations', 'optimization-title');
  optHead.append(optTitle);
  const optList = make('div', null, 'optimization-items-list');

  try {
    const optRes = await fetch('/api/analytics/optimization/recommendations?status=active');
    const optData = await optRes.json();
    const recs = optData.recommendations || [];
    const countBadge = badge(`${recs.length} active`, recs.length ? 'ok' : 'default');
    optHead.append(countBadge);

    if (!recs.length) {
      optList.append(notice('No active recommendations. Model router has determined current assignments are optimal (requires 7+ days usage data).'));
    } else {
      for (const rec of recs.slice(0, 4)) {
        const row = make('div', null, 'optimization-item-row');
        const info = make('div', null, 'opt-item-info');
        const headerText = make('div', null, 'opt-item-title');
        headerText.append(make('strong', rec.task_type || 'Task Type'), document.createTextNode(`: ${rec.current_model} → ${rec.recommended_model}`));
        const metrics = make('div', null, 'opt-item-metrics');
        metrics.append(
          make('span', `Save ~$${rec.estimated_weekly_savings}/wk`, 'badge b-ok'),
          make('span', `${Math.round((rec.confidence || 0) * 100)}% confidence`, 'entity-tag')
        );
        info.append(headerText, metrics);

        const actions = make('div', null, 'opt-item-actions');
        const applyBtn = make('button', 'Apply', 'btn-primary');
        const dismissBtn = make('button', 'Dismiss', 'btn-secondary');

        applyBtn.addEventListener('click', async () => {
          applyBtn.disabled = true;
          try {
            await fetch('/api/analytics/optimization/apply', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: rec.id })
            });
            row.remove();
          } catch (err) {
            alert(`Failed: ${err.message}`);
            applyBtn.disabled = false;
          }
        });

        dismissBtn.addEventListener('click', async () => {
          const reason = prompt('Reason for dismissal?') || '';
          dismissBtn.disabled = true;
          try {
            await fetch('/api/analytics/optimization/dismiss', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: rec.id, reason })
            });
            row.remove();
          } catch (err) {
            alert(`Failed: ${err.message}`);
            dismissBtn.disabled = false;
          }
        });

        actions.append(applyBtn, dismissBtn);
        row.append(info, actions);
        optList.append(row);
      }
    }
  } catch {
    optList.append(notice('Optimization recommendations engine is offline or computing initial baseline.'));
  }

  optCard.append(optHead, optList);
  opsSection.append(pauseCard, optCard);
  view.node.append(opsSection);

  // 3. Dimension Switcher Navigation
  const nav = make('nav', null, 'subnav');
  nav.setAttribute('aria-label', 'Cost dimension');
  for (const value of dimensions) {
    const item = link(inheritScope(`/app/observability/cost?dimension=${value}`, context.scope), value[0].toUpperCase() + value.slice(1));
    if (value === dimension) {
      item.classList.add('is-active');
      item.setAttribute('aria-current', 'page');
    }
    nav.append(item);
  }

  // 4. Chart Panel
  const chartPanel = dashboardPanel(document, { title: 'Cost over selected time', kind: 'graph', className: 'panel-full' }, nav);
  const chartTarget = make('div');
  chartPanel.append(chartTarget);
  view.node.append(chartPanel);

  // 5. Breakdown Table with Visual Share Bars
  const ranking = data.breakdowns[dimension] ?? [];
  const tableRows = ranking.map((row) => {
    const shareNum = parseFloat(row.share) || 0;
    const shareCell = make('div', null, 'cost-share-cell');
    const shareBar = make('div', null, 'cost-share-bar');
    const shareFill = make('div', null, 'cost-share-fill');
    shareFill.style.width = `${Math.min(100, Math.max(0, shareNum))}%`;
    shareBar.append(shareFill);
    shareCell.append(document.createTextNode(`${row.share}%`), shareBar);

    const drilldownLink = link(row.drilldown.href, `View records →`, 'drilldown-link');
    drilldownLink.setAttribute('aria-label', `Open ${row.key} usage records`);

    return [
      row.key,
      money(row.cost),
      number(row.tokens),
      number(row.requests),
      shareCell,
      row.unknownCostEvents > 0 ? badge(`${number(row.unknownCostEvents)} unpriced`, 'warning') : badge('none', 'ok'),
      drilldownLink
    ];
  });

  const tablePanel = dashboardPanel(document, { title: `Cost by ${dimension}`, kind: 'table' }, table([dimension, 'Cost (USD)', 'Tokens', 'Requests', 'Share', 'Unknown cost', 'Evidence'], tableRows, `Cost drivers by ${dimension}; totals reconcile to selected-scope spend within currency rounding.`));
  
  // 6. Actions & Freshness
  const actionsRow = make('div', null, 'gateway-chart-actions');
  const exportBtn = link(`/api/operations/export?${new URLSearchParams({ ...Object.fromEntries(context.url.searchParams), view: 'cost' })}`, 'Export scoped cost evidence', 'btn-secondary export-btn');
  const freshness = make('p', `Fresh as of ${instant(data.freshAsOf)}`, 'freshness');
  actionsRow.append(exportBtn, freshness);
  tablePanel.append(actionsRow);
  view.node.append(tablePanel);

  context.root.replaceChildren(view.node);

  const rendered = renderOperationalChart(chartTarget, {
    id: 'cost-series',
    title: 'Cost over selected time',
    unit: 'USD',
    points: data.series.cost.points,
    freshAsOf: data.freshAsOf,
    scopeLabel: scopeText(context.scope),
    summary: `Selected-scope spend is ${money(data.summary.spend)}; ${data.series.cost.aggregation}.`
  });
  context.registerDispose(rendered.destroy);
}
