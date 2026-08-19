import fs from 'fs';
let js = fs.readFileSync('dashboard/app/shared/chart-adapter.mjs', 'utf8');

js = js.replace('axes: [{}, {}]', 'axes: [{}, { label: model.unit }]');

fs.writeFileSync('dashboard/app/shared/chart-adapter.mjs', js);
