import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace(/width: 100%; max-width: 14rem; flex: 1; padding: 0\.25rem 0\.75rem;/, 
  "width: auto; max-width: 14rem; flex: 1 1 0%; min-width: 0; padding: 0.25rem 0.75rem;");

fs.writeFileSync('dashboard/static/app-platform.css', css);
