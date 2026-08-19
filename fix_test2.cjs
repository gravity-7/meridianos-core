const fs = require('fs');
let file = fs.readFileSync('browser-tests/client-demo-package.spec.mjs', 'utf8');
file = file.replace(
  "await expect(page.locator('#realtime-state')).toContainText('Showing last 24 hours.');",
  "await expect(page.locator('#realtime-state')).toContainText('Scope applied.');"
);
fs.writeFileSync('browser-tests/client-demo-package.spec.mjs', file);
