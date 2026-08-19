import fs from 'fs';
let js = fs.readFileSync('dashboard/app/shared/view-helpers.mjs', 'utf8');

const newScopeText = `export function scopeText(scope) {
  try {
    const f = new Intl.DateTimeFormat(navigator.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const fromStr = f.format(new Date(scope.from));
    const toStr = f.format(new Date(scope.to));
    return \`\${fromStr} - \${toStr} (UTC)\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  } catch {
    return \`\${scope.from} inclusive to \${scope.to} exclusive • UTC\${scope.project ? \` • project \${scope.project}\` : ''}\${scope.provider ? \` • provider \${scope.provider}\` : ''}\`;
  }
}`;

js = js.replace(/export function scopeText\(scope\) \{[\s\S]*?\}/, newScopeText);

fs.writeFileSync('dashboard/app/shared/view-helpers.mjs', js);
