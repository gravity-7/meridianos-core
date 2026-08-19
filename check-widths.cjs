const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
  await page.goto('http://127.0.0.1:4317/app/observability/usage');
  await page.waitForTimeout(2000);
  const widths = await page.evaluate(() => {
    return {
      body: document.body.offsetWidth,
      header: document.querySelector('.app-header')?.offsetWidth,
      main: document.querySelector('main')?.offsetWidth,
      toolbar: document.querySelector('.dashboard-toolbar')?.offsetWidth,
      html: document.documentElement.offsetWidth,
      window: window.innerWidth
    };
  });
  console.log(widths);
  await browser.close();
})();
