import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');
css = css.replace(/\\n/g, "\n");
fs.writeFileSync('dashboard/static/app-platform.css', css);
