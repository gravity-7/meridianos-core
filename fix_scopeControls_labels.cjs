const fs = require('fs');
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');
css = css.replace('.scope-row-filters label { display: flex;', '.scope-row-filters label { flex: 1; min-width: 140px; display: flex;');
fs.writeFileSync('dashboard/static/app-platform.css', css);
