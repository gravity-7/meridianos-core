import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

let replacement = '@media (max-width: 1024px) {\\n' +
'  :root { --rail-width: 4.25rem; }\\n' +
'  .app-sidebar .sidebar-heading span:last-child, .app-sidebar .sidebar-link span:last-child, .app-sidebar summary span:last-child { display: none; }\\n' +
'}\\n' +
'@media (max-width: 760px)';

css = css.replace('@media (max-width: 760px)', replacement);
fs.writeFileSync('dashboard/static/app-platform.css', css);
