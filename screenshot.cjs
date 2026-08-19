const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:4317/app/observability/usage');
  await page.waitForTimeout(2000);
  const size = await page.evaluate(() => {
    const sc = document.querySelector('.scope-controls');
    return sc ? { w: sc.offsetWidth, h: sc.offsetHeight } : null;
  });
  await page.screenshot({ path: 'test.png' }); console.log('saved');
  await browser.close();
})();
