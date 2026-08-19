import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace(/min-width: 12rem;/, "width: 100%; max-width: 14rem; flex: 1; padding: 0.25rem 0.75rem; border-radius: 4px;");

fs.writeFileSync('dashboard/static/app-platform.css', css);
