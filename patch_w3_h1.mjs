import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace('.route-page > h1 { font-size: clamp(1.4rem, 2vw, 2rem); letter-spacing: -.02em; margin: .25rem 0 .35rem; }',
  '.route-page > h1 { font-size: clamp(1.4rem, 2vw, 2rem); letter-spacing: -.02em; margin: 1rem 0 1rem; }\\n.lede { color: var(--muted); margin-top: -0.5rem; margin-bottom: 1.5rem; }');
  
fs.writeFileSync('dashboard/static/app-platform.css', css);
