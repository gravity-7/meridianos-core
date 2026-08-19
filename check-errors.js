import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.type(), msg.text()));
  page.on('pageerror', error => console.log('ERROR:', error.message));
  await page.goto('http://127.0.0.1:4317/app/observability/cost');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await browser.close();
})();
