import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

// Table headers (MER-UI-014)
css = css.replace('.dashboard-panel .data-table { margin: .25rem 0 0; font-size: .78rem; }',
  '.dashboard-panel .data-table { margin: .25rem 0 0; font-size: .78rem; border-collapse: collapse; }\\n' +
  '.dashboard-panel .data-table th, .dashboard-panel .data-table td { border-bottom: 1px solid var(--grid-line); padding: .5rem .6rem; }\\n' +
  '.dashboard-panel .data-table th { background: transparent; color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: .72rem; }');
css = css.replace('.dashboard-panel th { background: var(--surface-2); }', '');

// Header buttons (MER-UI-004)
css = css.replace('.app-header > button { flex: 0 0 auto; }',
  '.app-header > button { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-height: 2.2rem; padding: 0 .75rem; border-radius: .4rem; font-size: .85rem; font-weight: 500; }\\n' +
  '.sidebar-toggle { display: inline-flex; align-items: center; justify-content: center; min-height: 2.2rem; padding: 0 .6rem; border-radius: .4rem; font-size: .85rem; font-weight: 500; color: var(--text); background: transparent; border: 1px solid transparent; }');
css = css.replace('.sidebar-toggle { display: inline-flex; align-items: center; gap: .35rem; min-width: auto; padding: .45rem .6rem; color: var(--text); background: transparent; border-color: transparent; }', '');

fs.writeFileSync('dashboard/static/app-platform.css', css);
