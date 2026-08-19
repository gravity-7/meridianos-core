const fs = require('fs');
let file = fs.readFileSync('browser-tests/client-demo-package.spec.mjs', 'utf8');
file = file.replace(
  "await page.getByLabel('Time preset').selectOption('24h');\r\n    await expect(page).toHaveURL(/preset=24h/);",
  "await page.getByLabel('Time preset').selectOption('24h');\r\n    await page.getByRole('button', { name: 'Apply scope' }).click();\r\n    await expect(page).toHaveURL(/preset=24h/);"
);
file = file.replace(
  "await page.getByLabel('Time preset').selectOption('24h');\n    await expect(page).toHaveURL(/preset=24h/);",
  "await page.getByLabel('Time preset').selectOption('24h');\n    await page.getByRole('button', { name: 'Apply scope' }).click();\n    await expect(page).toHaveURL(/preset=24h/);"
);
fs.writeFileSync('browser-tests/client-demo-package.spec.mjs', file);
