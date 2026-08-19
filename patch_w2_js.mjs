import fs from 'fs';
let js = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');

js = js.replace("let restoreRouteFocus = false;", "let restoreRouteFocus = false;\\nif (matchMedia('(max-width: 1024px) and (min-width: 761px)').matches) { sidebar?.classList.add('is-collapsed'); }");

// And for the mobile drawer scrim:
js = js.replace("const sidebarToggle = document.querySelector('#sidebar-toggle');", 
  "const sidebarToggle = document.querySelector('#sidebar-toggle'); const sidebarScrim = document.createElement('div'); sidebarScrim.className = 'sidebar-scrim'; sidebarScrim.setAttribute('aria-hidden', 'true'); document.querySelector('.app-layout').prepend(sidebarScrim); sidebarScrim.addEventListener('click', () => { sidebar?.classList.remove('is-open'); sidebarScrim.classList.remove('is-active'); sidebarToggle?.setAttribute('aria-expanded', 'false'); });");

js = js.replace("sidebar?.classList.toggle('is-open', !expanded);", 
  "const open = !expanded; sidebar?.classList.toggle('is-open', open); sidebarScrim.classList.toggle('is-active', open);");
  
js = js.replace("sidebar?.classList.remove('is-open');", 
  "sidebar?.classList.remove('is-open'); sidebarScrim.classList.remove('is-active');");
  
js = js.replace("sidebar.classList.remove('is-open');", 
  "sidebar.classList.remove('is-open'); sidebarScrim.classList.remove('is-active');");

fs.writeFileSync('dashboard/static/app-platform.mjs', js);
