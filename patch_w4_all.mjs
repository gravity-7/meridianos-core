import fs from 'fs';

function updateGateway() {
  let js = fs.readFileSync('dashboard/app/routes/observability/gateway.mjs', 'utf8');
  if (!js.includes('dashboardPanel')) {
    js = js.replace(/import \{ inheritScope \} from '\.\.\/\.\.\/shared\/operational-scope\.mjs';/, "import { inheritScope } from '../../shared/operational-scope.mjs';\nimport { dashboardPanel } from '../../shared/dashboard-panels.mjs';");
  }
  
  js = js.replace(/view\.node\.append\(definitionList\(\[([\s\S]*?)\]\)\);/,
    "view.node.append(dashboardPanel(document, { title: 'Summary', kind: 'list' }, definitionList([$1])));");
    
  js = js.replace(/const nav = make\('nav', null, 'subnav'\);[\s\S]*?view\.node\.append\(nav\);\n  const host = make\('div'\); view\.node\.append\(host, (.*?)\);/g,
    "const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Gateway metric'); for (const [key,[label]] of Object.entries(metrics)) nav.append(link(inheritScope(`/app/observability/gateway?metric=${key}`, context.scope), label)); \n  const chartPanel = dashboardPanel(document, { title: metrics[selected][0], kind: 'graph' }, nav); const host = make('div'); chartPanel.append(host, $1); view.node.append(chartPanel);");

  fs.writeFileSync('dashboard/app/routes/observability/gateway.mjs', js);
}

function updateRoute(path, isCost) {
  let js = fs.readFileSync(path, 'utf8');
  if (!js.includes('dashboardPanel')) {
    js = js.replace(/import \{ inheritScope \} from '\.\.\/\.\.\/shared\/operational-scope\.mjs';/, "import { inheritScope } from '../../shared/operational-scope.mjs';\nimport { dashboardPanel } from '../../shared/dashboard-panels.mjs';");
  }
  
  if (isCost) {
    js = js.replace(/view\.node\.append\(definitionList\(\[([\s\S]*?)\]\), make\('p', data\.summary\.budget\.periodLabel, 'notice'\)\);/, 
      "view.node.append(dashboardPanel(document, { title: 'Summary', kind: 'list' }, definitionList([$1]), make('p', data.summary.budget.periodLabel, 'notice')));");
      
    js = js.replace(/const nav = make\('nav', null, 'subnav'\);[\s\S]*?view\.node\.append\(nav\);\n  const chart = make\('div'\); view\.node\.append\(chart\);\n  const ranking = data\.breakdowns\[dimension\]; view\.node\.append\(make\('h2', \`Cost by \$\{dimension\}\`\), table\(([\s\S]*?)\)\);/g, 
      "const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Cost dimension'); for (const value of dimensions) nav.append(link(inheritScope(`/app/observability/cost?dimension=${value}`, context.scope), value[0].toUpperCase() + value.slice(1))); \n  const chartPanel = dashboardPanel(document, { title: 'Cost over selected time', kind: 'graph' }); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);\n  const ranking = data.breakdowns[dimension]; const tablePanel = dashboardPanel(document, { title: `Cost by ${dimension}`, kind: 'table' }, nav, table($1)); view.node.append(tablePanel);");
      
    js = js.replace(/const rendered = renderOperationalChart\(chart, \{ id: 'cost-series', title: 'Cost over selected time',/g,
      "const rendered = renderOperationalChart(chartTarget, { id: 'cost-series', title: 'Cost over selected time',");
  } else {
    // Usage
    js = js.replace(/view\.node\.append\(definitionList\(\[([\s\S]*?)\]\)\);/, 
      "view.node.append(dashboardPanel(document, { title: 'Summary', kind: 'list' }, definitionList([$1])));");
      
    js = js.replace(/const nav = make\('nav', null, 'subnav'\);[\s\S]*?view\.node\.append\(nav\);\n  const host = make\('div'\); view\.node\.append\(host, link/g, 
      "const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Usage dimension'); for (const value of dimensions) nav.append(link(inheritScope(`/app/observability/usage?dimension=${value}`, context.scope), value[0].toUpperCase() + value.slice(1))); \n  const chartPanel = dashboardPanel(document, { title: 'Trend', kind: 'graph' }); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);\n  const ranking = data.breakdowns[dimension]; const tablePanel = dashboardPanel(document, { title: `Usage by ${dimension}`, kind: 'table' }, nav, link");
      
    js = js.replace(/const rendered = renderOperationalChart\(host, /g,
      "const rendered = renderOperationalChart(chartTarget, ");
  }
  
  fs.writeFileSync(path, js);
}

updateGateway();
updateRoute('dashboard/app/routes/observability/cost.mjs', true);
updateRoute('dashboard/app/routes/observability/usage.mjs', false);
