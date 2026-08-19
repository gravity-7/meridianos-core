import fs from 'fs';
let js = fs.readFileSync('dashboard/app/shared/view-helpers.mjs', 'utf8');

const regex = /export function scopeText\(scope\) \{[\s\S]*?\}\`; \}/;
if (regex.test(js)) {
  js = js.replace(regex, `export function scopeText(scope) {
  try {
    const f = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const fromStr = f.format(new Date(scope.from));
    const toStr = f.format(new Date(scope.to));
    return \`\${fromStr} - \${toStr} (UTC)\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  } catch {
    return \`\${scope.from} inclusive to \${scope.to} exclusive • UTC\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  }
}`);
} else {
  // Try cleaning up the mess
  const start = js.indexOf('export function scopeText(scope) {');
  if (start !== -1) {
    js = js.substring(0, start) + `export function scopeText(scope) {
  try {
    const f = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const fromStr = f.format(new Date(scope.from));
    const toStr = f.format(new Date(scope.to));
    return \`\${fromStr} - \${toStr} (UTC)\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  } catch {
    return \`\${scope.from} inclusive to \${scope.to} exclusive • UTC\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  }
}
`;
  }
}

fs.writeFileSync('dashboard/app/shared/view-helpers.mjs', js);
