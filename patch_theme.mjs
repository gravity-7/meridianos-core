import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace(/--sidebar: #17202b;\s*--sidebar-surface: #202b38;\s*--sidebar-text: #d5dce6;\s*--sidebar-muted: #8b98aa;/, 
  '--sidebar: var(--surface-2);\n  --sidebar-surface: var(--border);\n  --sidebar-text: var(--text);\n  --sidebar-muted: var(--muted);');

css = css.replace(/--sidebar: #0c1015;\s*--sidebar-surface: #171d24;\s*--sidebar-text: #e7edf5;\s*--sidebar-muted: #8d9aaa;/,
  '--sidebar: var(--surface-2);\n  --sidebar-surface: var(--border);\n  --sidebar-text: var(--text);\n  --sidebar-muted: var(--muted);');

css = css.replace(/--sidebar: #202a35; --sidebar-surface: #2a3643; --sidebar-text: #f5f7fb; --sidebar-muted: #b5c0cd;/g,
  '--sidebar: var(--surface-2); --sidebar-surface: var(--border); --sidebar-text: var(--text); --sidebar-muted: var(--muted);');

css = css.replace('body { background: var(--bg); color: var(--text); }',
  'body { background: var(--bg); color: var(--text); }\n' +
  'a { color: var(--accent); text-decoration: none; }\n' +
  'a:hover { text-decoration: underline; }\n' +
  '.app-header a, .app-sidebar a, .dashboard-panel a { color: inherit; text-decoration: none; }\n' +
  '.app-header a:hover, .app-sidebar a:hover, .dashboard-panel a:hover { text-decoration: none; }\n' +
  '*:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }');

fs.writeFileSync('dashboard/static/app-platform.css', css);
