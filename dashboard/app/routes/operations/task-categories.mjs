import { make, notice, page, link, badge, iconLabel } from '../../shared/view-helpers.mjs';

const CONSTITUTIONAL_CATEGORIES = {
  design:  { label: 'Design',  desc: 'UI components in packages/ui + apps/*/src/components', icon: '🎨', tier: 'T1' },
  copy:    { label: 'Copy',    desc: 'EN copy strings — labels, errors, placeholders, templates', icon: '✏️', tier: 'T2' },
  docs:    { label: 'Docs',    desc: 'Markdown docs for UI components in packages/ui/docs/', icon: '📄', tier: 'T2' },
  a11y:    { label: 'A11y',    desc: 'ARIA roles, keyboard nav, focus management in UI files', icon: '♿', tier: 'T1' },
  tokens:  { label: 'Tokens',  desc: 'Design token proposals in index.css or design-tokens.json', icon: '🎛️', tier: 'T1' },
};

export async function renderRoute(context) {
  const view = page('Task Categories', 'Live task counts and distribution organized by constitutional category (Constitution §11).');

  const feedback = make('div', null, 'management-feedback');
  feedback.setAttribute('role', 'status');

  let rawCategories = {};
  try {
    const res = await fetch('/api/status');
    const statusData = await res.json();
    rawCategories = statusData.taskCategories || {};
  } catch (err) {
    try {
      const fallbackRes = await fetch('/api/state');
      const stateData = await fallbackRes.json();
      rawCategories = stateData.taskCategories || {};
    } catch {}
  }

  // Merge with constitutional defaults so cards always render
  const mergedCategories = {};
  for (const [key, meta] of Object.entries(CONSTITUTIONAL_CATEGORIES)) {
    const remote = rawCategories[key] || {};
    mergedCategories[key] = {
      ...meta,
      ...remote,
      total: remote.total ?? 0,
      byStatus: remote.byStatus || {},
      byOwner: remote.byOwner || {}
    };
  }

  // Add any extra dynamic domain categories
  for (const [key, val] of Object.entries(rawCategories)) {
    if (key !== '_uncategorized' && !mergedCategories[key]) {
      mergedCategories[key] = {
        label: val.label || key,
        desc: val.desc || 'Domain category',
        icon: val.icon || '🏷',
        tier: val.tier || 'T2',
        total: val.total ?? 0,
        byStatus: val.byStatus || {},
        byOwner: val.byOwner || {}
      };
    }
  }

  const uncat = rawCategories._uncategorized || {
    label: 'Uncategorized',
    desc: 'Tasks without an explicit constitutional task_type',
    icon: '📦',
    total: 0
  };

  const grid = make('div', null, 'task-categories-grid');

  for (const [type, cat] of Object.entries(mergedCategories)) {
    const card = make('div', null, 'task-cat-card');
    
    const header = make('div', null, 'task-cat-header');
    const icon = make('span', cat.icon || '🏷', 'task-cat-icon');
    const labelWrap = make('div', null, 'task-cat-title-wrap');
    const name = make('strong', cat.label || type, 'task-cat-name');
    const tierBadge = badge(cat.tier || 'T1', 'info');
    labelWrap.append(name, tierBadge);
    header.append(icon, labelWrap);

    const desc = make('p', cat.desc || '', 'task-cat-desc');

    const countWrap = make('div', null, 'task-cat-count-wrap');
    const count = make('div', String(cat.total ?? 0), 'task-cat-count');
    const countLabel = make('span', 'Active Tasks', 'task-cat-count-label');
    countWrap.append(count, countLabel);

    const action = link(`/app/operations/tasks?category=${encodeURIComponent(type)}`, 'Filter tasks in scope →', 'drilldown-link');
    
    card.append(header, desc, countWrap, action);
    grid.append(card);
  }

  // Uncategorized Card
  const uncatCard = make('div', null, 'task-cat-card is-uncategorized');
  const uncatHeader = make('div', null, 'task-cat-header');
  const uncatIcon = make('span', uncat.icon || '📦', 'task-cat-icon');
  const uncatLabelWrap = make('div', null, 'task-cat-title-wrap');
  const uncatName = make('strong', uncat.label || 'Uncategorized', 'task-cat-name');
  const uncatBadge = badge('Fallback', 'default');
  uncatLabelWrap.append(uncatName, uncatBadge);
  uncatHeader.append(uncatIcon, uncatLabelWrap);

  const uncatDesc = make('p', uncat.desc || 'Tasks without an explicit constitutional task_type', 'task-cat-desc');
  const uncatCountWrap = make('div', null, 'task-cat-count-wrap');
  const uncatCount = make('div', String(uncat.total ?? 0), 'task-cat-count');
  const uncatCountLabel = make('span', 'Uncategorized', 'task-cat-count-label');
  uncatCountWrap.append(uncatCount, uncatCountLabel);

  const uncatAction = link('/app/operations/tasks?category=uncategorized', 'Filter uncategorized tasks →', 'drilldown-link');
  uncatCard.append(uncatHeader, uncatDesc, uncatCountWrap, uncatAction);
  grid.append(uncatCard);

  view.node.append(grid, feedback);
  context.root.replaceChildren(view.node);
}
