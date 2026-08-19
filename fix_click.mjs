import fs from 'fs';
let js = fs.readFileSync('dashboard/static/app-platform.mjs', 'utf8');

js = js.replace(/document\.addEventListener\('click', \(event\) => \{\r?\n\s*const link = event\.target\.closest\('a\[href\^="\/app"\]'\); if \(\!link \|\| event\.defaultPrevented \|\| event\.button \!== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;\r?\n\s*event\.preventDefault\(\); navigate\(link\.href\);\r?\n\}\);/,
`document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.origin !== location.origin || link.hasAttribute('download') || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.pathname.startsWith('/legacy') || link.pathname.startsWith('/app/setup')) return;
    event.preventDefault(); navigate(link.href);
});`);

fs.writeFileSync('dashboard/static/app-platform.mjs', js);
