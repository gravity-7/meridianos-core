import fs from 'fs';
let css = fs.readFileSync('dashboard/static/app-platform.css', 'utf8');

css = css.replace('.uplot { max-width: 100%; }', 
  ".uplot { max-width: 1600px; margin: 0 auto; width: 100%; } .uplot canvas { width: 100% !important; max-width: 1600px; }");

fs.writeFileSync('dashboard/static/app-platform.css', css);
