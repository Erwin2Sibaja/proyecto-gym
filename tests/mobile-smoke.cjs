// Requires Playwright in the Node module path and Google Chrome. Run: node tests/mobile-smoke.cjs
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#step-preferences.activo').waitFor();
    assert.equal(await page.locator('input[name=language]:checked').inputValue(), 'en');
    await page.locator('input[name="destination"][value="cancun"]').check();
    await page.click('#savePreferences');
    await page.locator('#step-disclaimer.activo').waitFor();
    await page.click('#noticeBack');
    await page.click('#savePreferences');
    await page.click('#acceptDisclaimer');
    await page.evaluate(async () => {
      for (let frame = 0; frame < 35; frame++) {
        await new Promise(requestAnimationFrame);
        const menu = document.querySelector('.menu-inferior').getBoundingClientRect();
        if (Math.abs(menu.left) > 1 || Math.abs(menu.right - innerWidth) > 1 || Math.abs(menu.bottom - innerHeight) > 1) {
          throw new Error('Bottom menu exceeds viewport during app entry');
        }
      }
    });
    await page.locator('#pecho.activo .gallery-controls').first().waitFor();
    assert.equal(await page.locator('#piernas img[src]').count(), 0);
    assert.ok(await page.locator('#pecho img[src]').count() > 0);
    const gallery = page.locator('#pecho .imagenes-ejercicio').first();
    await gallery.locator('.gallery-controls button').last().click();
    await page.waitForFunction(() => document.querySelector('#pecho .track').scrollLeft > 10);
    assert.equal(await gallery.locator('.gallery-controls button').last().evaluate(el => el.getBoundingClientRect().height), 48);
    await page.reload();
    await page.locator('#pecho.activo .gallery-controls').first().waitFor();
    assert.equal(await page.locator('#onboarding').isVisible(), false);
    await page.click('[data-seccion="full-body"]');
    await page.click('[data-sub="cardio"]');
    await page.click('#preferencesBtn');
    await page.locator('input[name="language"][value="es"]').check();
    await page.locator('input[name="destination"][value="cabos"]').check();
    await page.click('#savePreferences');
    await page.locator('#sub-cardio.activo .gallery-controls').first().waitFor();
    assert.match(await page.locator('#preferencesBtn').textContent(), /Los Cabos · ES/);
    await page.click('#preferencesBtn');
    await page.locator('input[name="destination"][value="cancun"]').check();
    await page.click('#cancelPreferences');
    assert.match(await page.locator('#preferencesBtn').textContent(), /Los Cabos/);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 740 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}`);
      for (const top of [0, 600]) {
        await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const bounds = await page.locator('.menu-inferior').evaluate(menu => {
          const rect = menu.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, fits: menu.scrollWidth <= menu.clientWidth };
        });
        assert.ok(Math.abs(bounds.left) <= 1 && Math.abs(bounds.right - bounds.width) <= 1 && Math.abs(bounds.bottom - bounds.height) <= 1 && bounds.fits, `Menu outside viewport at ${width}, scroll ${top}`);
      }
    }
    await page.waitForTimeout(600);
    await context.close();
    const failure = await browser.newContext({ viewport: { width: 320, height: 568 }, locale: 'es' });
    await failure.addInitScript(() => {
      localStorage.setItem('uiLang', 'es'); localStorage.setItem('uiDestino', 'cancun'); localStorage.setItem('gymNoticeVersion', '1');
    });
    const retryPage = await failure.newPage();
    await retryPage.route('**/assets/i18n/*', route => route.abort());
    await retryPage.goto(`http://127.0.0.1:${server.address().port}`);
    await retryPage.locator('#retryLoad').waitFor();
    await retryPage.unroute('**/assets/i18n/*');
    await retryPage.click('#retryLoad');
    await retryPage.locator('#pecho.activo .gallery-controls').first().waitFor();
    const blocked = await browser.newContext({ viewport: { width: 320, height: 480 }, locale: 'es' });
    await blocked.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('Storage unavailable'); } });
      Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Storage unavailable'); } });
    });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`http://127.0.0.1:${server.address().port}`);
    await blockedPage.locator('input[name="destination"][value="cancun"]').check();
    await blockedPage.click('#savePreferences');
    await blockedPage.click('#acceptDisclaimer');
    await blockedPage.locator('#pecho.activo .gallery-controls').first().waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: first visit, browser language, notice back, saved entry, destination/language changes, cancel, subsection retention, deferred hidden images, 320/390/430px overflow, catalog error/retry, no JS exceptions.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
