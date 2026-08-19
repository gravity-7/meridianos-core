import fs from 'fs';
let js = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');

js = js.replace(/function updateNav\(\) \{ [^}]* \}/, 
"function updateNav() { for (const link of document.querySelectorAll('.app-header a, .app-sidebar a')) if (!link.pathname.startsWith('/app/setup') && !link.pathname.startsWith('/legacy')) { link.href = scopedDestination(link.pathname === '/app' ? '/' : link.pathname); const isActive = link.pathname === '/' ? location.pathname === '/' : location.pathname.startsWith(link.pathname); link.classList.toggle('is-active', isActive); link.setAttribute('aria-current', isActive ? 'page' : 'false'); } }");

fs.writeFileSync('dashboard/static/app-platform.mjs', js);
