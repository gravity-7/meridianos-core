import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');
css = css.replace('.dashboard-toolbar { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;',
  '.dashboard-toolbar { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap;');
fs.writeFileSync('dashboard/static/app-platform.css', css);
