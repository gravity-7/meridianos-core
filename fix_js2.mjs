import fs from 'fs';
let mjs = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');
mjs = mjs.replace(/} } }/, "} }");
fs.writeFileSync('dashboard/static/app-platform.mjs', mjs);
