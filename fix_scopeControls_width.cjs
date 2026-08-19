const fs = require('fs');
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');
css = css.replace('.scope-controls { display: flex; flex-direction: column;', '.scope-controls { width: 100%; display: flex; flex-direction: column;');
fs.writeFileSync('dashboard/static/app-platform.css', css);
