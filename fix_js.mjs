import fs from 'fs';
let mjs = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');
mjs = mjs.replace(/let restoreRouteFocus = false;\\nif \(matchMedia/g, "let restoreRouteFocus = false;\nif (matchMedia");
fs.writeFileSync('dashboard/static/app-platform.mjs', mjs);
