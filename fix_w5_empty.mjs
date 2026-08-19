import fs from 'fs';
let js = fs.readFileSync('dashboard/app/shared/chart-adapter.mjs', 'utf8');

js = js.replace(/\} else if \(\!model\.rows\.length\) visual\.replaceChildren\(text\(documentRef, 'p', \`No \$\{model\.unit\} data in this (.*?)\`\)\);/, 
  "} else if (!model.rows.length) { visual.className = 'chart-visual panel-empty'; visual.replaceChildren(text(documentRef, 'p', `No ${model.unit} data in this $1`)); }");

fs.writeFileSync('dashboard/app/shared/chart-adapter.mjs', js);
