import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

const additions = `
.scope-controls { display: flex; flex-direction: column; gap: 0.75rem; background: var(--surface); padding: 1rem; border: 1px solid var(--border); border-radius: var(--panel-radius); margin-bottom: 1rem; }
.scope-row-filters { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
.scope-row-filters label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; font-weight: 500; color: var(--muted); }
.scope-row-filters input, .scope-row-filters select { padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 0.25rem; font-size: 0.9rem; background: var(--bg); color: var(--text); }
.scope-row-actions { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; padding-top: 0.5rem; border-top: 1px solid var(--border); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-strong); color: #fff; }
.realtime-label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: var(--muted); cursor: pointer; }
.realtime-label input[type="checkbox"] { margin: 0; min-height: auto; }
#realtime-state { font-size: 0.85rem; color: var(--muted); margin-left: auto; }
@media (max-width: 760px) {
  .scope-row-filters { flex-direction: column; align-items: stretch; }
  .scope-row-actions { flex-direction: column; align-items: stretch; }
  #realtime-state { margin-left: 0; }
}
`;

css += additions;
// Remove old .refresh-controls css rules
css = css.replace('.scope-controls, .overview-grid { grid-template-columns: 1fr; }', '.overview-grid { grid-template-columns: 1fr; }');
css = css.replace('.refresh-controls { grid-column: 1; }', '');

fs.writeFileSync('dashboard/static/app-platform.css', css);
