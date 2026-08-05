/**
 * settings-workspace — the panel-grid shell for the Settings/Observability workspace (008 — End-
 * User Configurability, US1/FR-012). Initializes Muuri on a grid container, persists each panel's
 * order (drag-to-reorder) and size (CSS-resize) to localStorage, and exposes registerPanel() for
 * settings-panels.mjs / observability-panels.mjs / routing-flow-panel.mjs to mount their content
 * into — this module knows nothing about what a panel renders, only how it's laid out and saved.
 *
 * Muuri lays items out by flow order + each item's own width/height, not free (x,y) coordinates —
 * "drag to reposition" here means "drag to reorder among siblings," which is Muuri's actual model
 * and satisfies FR-012's "positions persist" requirement without inventing a parallel coordinate
 * system. Resize uses the browser's native CSS `resize: both` on each panel body, watched by a
 * ResizeObserver that tells Muuri to reflow (`grid.refreshItems().layout()`) and re-saves the size.
 */

const STORAGE_KEY = 'meridian.settingsWorkspace.layout.v1';

/** @type {Map<string, { title: string, render: (el: HTMLElement) => void }>} */
const registry = new Map();
let grid = null;
let gridEl = null;

/** Read the persisted layout (panel order + per-panel width/height). Never throws — a corrupt or
 *  missing entry just means "use defaults," not a workspace-breaking error. */
function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], sizes: {} };
    const parsed = JSON.parse(raw);
    return { order: Array.isArray(parsed.order) ? parsed.order : [], sizes: parsed.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {} };
  } catch {
    return { order: [], sizes: {} };
  }
}

function saveLayout() {
  if (!grid) return;
  const order = grid.getItems().map((item) => item.getElement().dataset.panelId);
  const sizes = {};
  for (const item of grid.getItems()) {
    const el = item.getElement();
    sizes[el.dataset.panelId] = { width: el.style.width || '', height: el.style.height || '' };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, sizes }));
  } catch {
    // localStorage can throw (quota, private mode) — layout persistence is a nicety, not critical.
  }
}

/**
 * Register a panel to appear in the workspace. Call before init() (or after — init() picks up
 * everything registered so far, and panels registered later can call `mountPanel` directly).
 * @param {string} id - stable identifier, used as the localStorage layout key
 * @param {string} title - panel header text
 * @param {(el: HTMLElement) => void} render - called once with the panel's content container
 */
export function registerPanel(id, title, render) {
  registry.set(id, { title, render });
  if (grid) mountPanel(id);
}

function buildPanelElement(id) {
  const { title, render } = registry.get(id);
  const saved = loadLayout().sizes[id];

  const item = document.createElement('div');
  item.className = 'workspace-panel-item';
  item.dataset.panelId = id;
  if (saved?.width) item.style.width = saved.width;
  if (saved?.height) item.style.height = saved.height;

  const header = document.createElement('div');
  header.className = 'workspace-panel-header';
  header.textContent = title;

  const body = document.createElement('div');
  body.className = 'workspace-panel-body';

  item.append(header, body);
  render(body);
  return item;
}

function mountPanel(id) {
  const el = buildPanelElement(id);
  gridEl.appendChild(el);
  grid.add(el);
  observeResize(el);
}

function observeResize(panelEl) {
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    // Muuri's refreshItems/layout APIs take Item instances, not raw DOM elements — passing the
    // element itself throws ("_refreshDimensions is not a function") deep inside Muuri, which
    // would silently skip saveLayout() below too, since it's the next line in this same callback.
    const item = grid?.getItems().find((it) => it.getElement() === panelEl);
    if (item) grid.refreshItems([item]).layout();
    saveLayout();
  });
  ro.observe(panelEl);
}

/**
 * Initialize the workspace shell inside `container` (an existing DOM element). Mounts every panel
 * registered via registerPanel() so far, in the persisted order if one exists (unknown/new panel
 * ids are appended after the saved ones, so adding a new panel type doesn't lose old layouts).
 */
export function initWorkspace(container) {
  if (grid) return grid; // idempotent — a second call is a no-op, not a re-init

  gridEl = document.createElement('div');
  gridEl.className = 'workspace-grid';
  container.appendChild(gridEl);

  const { order } = loadLayout();
  const ids = [...registry.keys()];
  const orderedIds = [...order.filter((id) => registry.has(id)), ...ids.filter((id) => !order.includes(id))];

  // eslint-disable-next-line no-undef -- Muuri is a vendored global script, not an ES import
  grid = new Muuri(gridEl, {
    items: [],
    dragEnabled: true,
    layoutOnResize: true,
  });

  for (const id of orderedIds) mountPanel(id);

  grid.on('dragEnd', saveLayout);
  grid.on('layoutEnd', saveLayout);

  return grid;
}

/** Test/debug hook — not used by production panels. */
export function _resetForTests() {
  registry.clear();
  grid = null;
  gridEl = null;
}
