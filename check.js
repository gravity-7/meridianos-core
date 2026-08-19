const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  await page.goto('http://127.0.0.1:4317/app/observability/cost');
  await page.waitForTimeout(2000);
  console.log('Title visible?', await page.locator('h1').isVisible());
  console.log('HTML:', await page.content());
  await browser.close();
})();
