import fs from 'fs';
let js = fs.readFileSync('dashboard/app/routes/observability/cost.mjs', 'utf8');

js = js.replace(/const nav = make\('nav', null, 'subnav'\);[\s\S]*?view\.node\.append\(nav\);[\s\S]*?const chart = make\('div'\); view\.node\.append\(chart\);[\s\S]*?const ranking = data\.breakdowns\[dimension\]; view\.node\.append\(make\('h2', \`Cost by \$\{dimension\}\`\), (table\([\s\S]*?\))\);/,
  `const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Cost dimension'); for (const value of dimensions) nav.append(link(inheritScope(\`/app/observability/cost?dimension=\${value}\`, context.scope), value[0].toUpperCase() + value.slice(1))); 
  const chartPanel = dashboardPanel(document, { title: 'Cost over selected time', kind: 'graph' }, nav); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);
  const ranking = data.breakdowns[dimension]; const tablePanel = dashboardPanel(document, { title: \`Cost by \${dimension}\`, kind: 'table' }, $1); view.node.append(tablePanel);`);

js = js.replace(/renderOperationalChart\(chartTarget/g, 'renderOperationalChart(chartTarget');

fs.writeFileSync('dashboard/app/routes/observability/cost.mjs', js);
