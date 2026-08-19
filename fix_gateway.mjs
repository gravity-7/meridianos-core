import fs from 'fs';
let js = fs.readFileSync('dashboard/app/routes/observability/gateway.mjs', 'utf8');

js = js.replace(/const nav = make\('nav', null, 'subnav'\);[\s\S]*?view\.node\.append\(nav\);\s*const host = make\('div'\); view\.node\.append\(host, ([\s\S]*?)\);/,
  "const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Gateway metric'); for (const [key,[label]] of Object.entries(metrics)) nav.append(link(inheritScope(`/app/observability/gateway?metric=${key}`, context.scope), label)); \n  const chartPanel = dashboardPanel(document, { title: metrics[selected][0], kind: 'graph' }, nav); const host = make('div'); chartPanel.append(host, $1); view.node.append(chartPanel);");

fs.writeFileSync('dashboard/app/routes/observability/gateway.mjs', js);
