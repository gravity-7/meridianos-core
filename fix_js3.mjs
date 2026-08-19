import fs from 'fs';
let mjs = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');
mjs = mjs.replace(/if \(matchMedia\('\(max-width: 760px\)'\)\.matches\) const open = !expanded; sidebar\?\.classList\.toggle\('is-open', open\); sidebarScrim\.classList\.toggle\('is-active', open\); else sidebar\?\.classList\.toggle\('is-collapsed', expanded\);/g, 
  "if (matchMedia('(max-width: 760px)').matches) { const open = !expanded; sidebar?.classList.toggle('is-open', open); sidebarScrim.classList.toggle('is-active', open); } else { sidebar?.classList.toggle('is-collapsed', expanded); }");
fs.writeFileSync('dashboard/static/app-platform.mjs', mjs);
