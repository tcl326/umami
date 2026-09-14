import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.UMAMI_REVIEW_URL || 'http://127.0.0.1:3311/analytics';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const versions = [{ name: '3.3.1' }];
if (process.argv[2]) {
  const response = await fetch(process.argv[2], { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200);
  versions.push({ name: 'cached-production', script: await response.text() });
}

const browser = await chromium.launch();
try {
  for (const version of versions) {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    const pending = [];
    page.on('response', response => {
      if (response.url().endsWith('/api/send')) {
        pending.push(
          response.json().then(body => ({
            status: response.status(),
            body,
            request: response.request().postDataJSON(),
          })),
        );
      }
    });
    await page.route(`${baseUrl}/upgrade-check`, route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Upgrade verification</title></head><body></body></html>',
      }),
    );
    if (version.script) {
      await page.route(`${baseUrl}/script.js`, route =>
        route.fulfill({
          contentType: 'application/javascript',
          body: version.script,
        }),
      );
    }
    await page.goto(`${baseUrl}/upgrade-check`);
    await page.evaluate(async baseUrl => {
      window.suppressReset = false;
      window.beforeSend = (type, payload) =>
        window.suppressReset && type === 'identify' ? null : payload;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${baseUrl}/script.js`;
        script.dataset.websiteId = '33100000-0000-4000-8000-000000000001';
        script.dataset.autoTrack = 'false';
        script.dataset.beforeSend = 'beforeSend';
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
      await window.umami.identify('review-user-a', { role: 'sales' });
      await window.umami.track();
      // Mirror LCL's identity reset callback on logout/account switch.
      window.suppressReset = true;
      await window.umami.identify('');
      window.suppressReset = false;
      await window.umami.identify('review-user-b', { role: 'manager' });
      await window.umami.track();
    }, baseUrl);
    const responses = await Promise.all(pending);
    assert.equal(responses.length, 4);
    assert.ok(
      responses.every(r => r.status === 200 && r.body.sessionId),
      JSON.stringify(responses),
    );
    assert.deepEqual(
      responses.map(r => r.request.payload.id),
      ['review-user-a', 'review-user-a', 'review-user-b', 'review-user-b'],
    );
    console.log(
      `PASS: ${version.name} tracker identifies, tracks, and switches accounts; all four requests returned 200.`,
    );
    await context.close();
  }

  await mkdir('test-results/upgrade-3.3.1', { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}/login`);
    await page.locator('input[name=username]').fill('admin');
    await page.locator('input[name=password]').fill('umami');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.waitForURL(`${baseUrl}/websites`);
    await page.getByText('Upgrade review', { exact: true }).waitFor();
    await page.screenshot({ path: `test-results/upgrade-3.3.1/websites-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    console.log(
      `PASS: existing login and website visible at ${viewport.width}px without JavaScript errors.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
