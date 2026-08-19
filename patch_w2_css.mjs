import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace('@media (max-width: 760px) {',
  '.sidebar-scrim { display: none; position: fixed; inset: 0; background: #0008; z-index: 15; opacity: 0; transition: opacity var(--motion, 0.2s); }\\n.sidebar-scrim.is-active { display: block; opacity: 1; }\\n@media (max-width: 760px) {');

// Fix the 1024px overriding I did earlier, which is wrong because JS now handles it!
// Let's remove the @media (max-width: 1024px) that I added earlier in patch_w2_1.mjs
let replacementToRemove = '@media (max-width: 1024px) {\\n  :root { --rail-width: 4.25rem; }\\n  .app-sidebar .sidebar-heading span:last-child, .app-sidebar .sidebar-link span:last-child, .app-sidebar summary span:last-child { display: none; }\\n}\\n@media (max-width: 760px)';
if (css.includes(replacementToRemove)) {
  css = css.replace(replacementToRemove, '@media (max-width: 760px)');
}

// Active navigation (MER-UI-020)
// Currently JS does: link.pathname === location.pathname
// We want to match sub-paths too, but overview is only /.
css = css.replace('.app-header #search-trigger { font-size: 0; }', '.app-header #search-trigger { font-size: 0; }');

// Search trigger (MER-UI-022)
// Currently: button#search-trigger
// The issue says: "Make the Ctrl/K search trigger look intentional and interactive."
// It's in .app-header
let searchTriggerCss = '#search-trigger { display: flex; align-items: center; justify-content: space-between; min-width: 12rem; color: var(--muted); background: var(--surface-2); border-color: transparent; } #search-trigger:hover { background: var(--border); color: var(--text); }';
css = css.replace('.app-header kbd {', searchTriggerCss + '\\n.app-header kbd {');

fs.writeFileSync('dashboard/static/app-platform.css', css);
