import fs from 'fs';
let js = fs.readFileSync('dashboard/app/routes/observability/usage.mjs', 'utf8');

js = js.replace(/const nav = make\('nav', null, 'subnav'\); nav\.setAttribute\('aria-label', 'Usage dimension'\);\s*for \(const item of dimensions\) nav\.append\(link\(inheritScope\(`\/app\/observability\/usage\?dimension=\$\{item\}`\, context\.scope\), item\[0\]\.toUpperCase\(\) \+ item\.slice\(1\)\)\); view\.node\.append\(nav\);\s*const ranking = usage\.breakdowns\[selectedDimension\] \?\? \[\]; view\.node\.append\(make\('h2', \`Usage by \$\{selectedDimension\}\`\), (ranking\.length \? table\([\s\S]*?\) : make\('p', \`No \$\{selectedDimension\} usage drivers are available in this scope\.\`\))\);\s*(if \(dimension && value\) view\.node\.append\(make\('p', \`Supporting records are filtered to \$\{dimension\}: \$\{value\}\.\`, 'notice'\)\);\s*)const chart = make\('div'\); view\.node\.append\(chart, make\('h2', 'Supporting gateway records'\)\);\s*view\.node\.append\((table\(\['Time', 'Outcome'[\s\S]*?\))\);/,
  `const nav = make('nav', null, 'subnav'); nav.setAttribute('aria-label', 'Usage dimension'); for (const item of dimensions) nav.append(link(inheritScope(\`/app/observability/usage?dimension=\${item}\`, context.scope), item[0].toUpperCase() + item.slice(1))); 
  const chartPanel = dashboardPanel(document, { title: 'Trend', kind: 'graph' }, nav); const chartTarget = make('div'); chartPanel.append(chartTarget); view.node.append(chartPanel);
  const ranking = usage.breakdowns[selectedDimension] ?? []; const tablePanel = dashboardPanel(document, { title: \`Usage by \${selectedDimension}\`, kind: 'table' }, $1); view.node.append(tablePanel);
  $2const recordsPanel = dashboardPanel(document, { title: 'Supporting gateway records', kind: 'table' }, $3); view.node.append(recordsPanel);`);

js = js.replace(/renderOperationalChart\(chart,/g, 'renderOperationalChart(chartTarget,');

fs.writeFileSync('dashboard/app/routes/observability/usage.mjs', js);
