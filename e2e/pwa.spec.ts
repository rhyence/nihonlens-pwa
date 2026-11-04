import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test.use({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
});

test('converts a manual peso amount and saves the rate offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe('standalone');
  await expect(page.getByLabel('PHP per JPY')).toHaveValue('0.40');
  await page.getByLabel('Amount in JPY').fill('1280');
  await expect(page.getByLabel('Amount in pesos')).toHaveText('₱512.00');
  await page.getByRole('button', { name: 'Pesos → Yen', exact: true }).click();
  await page.getByLabel('Amount in PHP').fill('1760');
  await expect(page.getByLabel('Amount in yen')).toHaveText('¥4,400');
  await page.locator('summary').filter({ hasText: 'Exchange rate' }).click();
  await page.getByLabel('PHP per JPY').fill('0.50');
  await expect(page.getByLabel('Amount in yen')).toHaveText('¥3,520');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('PHP per JPY')).toHaveValue('0.50');
});

test('scans live yen prices on the iPhone path after an offline reload', async ({ page, context }) => {
  const fixture = process.env.NIHON_MODEL_DIR;
  test.skip(!fixture && !process.env.NIHON_LIVE_DOWNLOAD, 'Set NIHON_MODEL_DIR or NIHON_LIVE_DOWNLOAD=1.');
  if (fixture) {
    await context.route('https://raw.githubusercontent.com/**/jpn.traineddata', route =>
      route.fulfill({ path: join(fixture, 'jpn.traineddata'), headers: { 'access-control-allow-origin': '*' } }));
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText('Offline scanner ready', { timeout: 90_000 });
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('nihonlens-pack-'))!;
    const cache = await caches.open(name);
    const marker = (await cache.keys()).find(key => key.url.endsWith('complete.json'))!;
    await cache.put(new URL('marian/tokenizer.json', marker.url), new Response('{}'));
  });
  if (fixture) await context.unrouteAll();
  await context.setOffline(true);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = '/camera-ja.png';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const paint = () => {
        const ctx = canvas.getContext('2d')!;
        const difficult = document.documentElement.dataset.testLighting === 'dim-tilted';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        if (difficult) {
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(Math.PI / 12);
          ctx.scale(0.75, 0.75);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }
        ctx.drawImage(image, 0, 0);
        ctx.restore();
        if (difficult) {
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          document.documentElement.dataset.testFrame = 'dim-tilted';
        }
      };
      const stream = canvas.captureStream(8);
      paint();
      const timer = window.setInterval(paint, 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  });
  await page.reload();
  await expect(page.locator('.pack-status')).toHaveText('Offline scanner ready', { timeout: 60_000 });
  const retiredAssets = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('nihonlens-pack-'))!;
    return (await (await caches.open(name)).keys()).some(key => key.url.includes('/marian/'));
  });
  expect(retiredAssets).toBe(false);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(page.getByLabel('Frozen camera frame')).toBeVisible();
  await expect(page.locator('.overlay')).toHaveText('₱512.00', { timeout: 25_000 });
  await expect(page.getByText('Frozen prices ready. You can put your phone down.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Detected prices' })).toContainText('¥1,280 → ₱512.00');
  await page.locator('summary').filter({ hasText: 'Exchange rate' }).click();
  await page.getByLabel('PHP per JPY').fill('0.50');
  await expect(page.locator('.overlay')).toHaveText('₱640.00');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByLabel('Frozen camera frame')).toBeHidden();
  await expect(page.locator('.overlay')).toHaveText('₱640.00', { timeout: 25_000 });
  await page.evaluate(() => { document.documentElement.dataset.testLighting = 'dim-tilted'; });
  await page.waitForFunction(() => document.documentElement.dataset.testFrame === 'dim-tilted');
  await page.evaluate(() => new Promise<void>(resolve => {
    const video = document.querySelector('video')!;
    video.requestVideoFrameCallback(() => video.requestVideoFrameCallback(() => resolve()));
  }));
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(page.locator('.overlay')).toHaveText('₱640.00', { timeout: 60_000 });
  await expect(page.getByText('Frozen prices ready. You can put your phone down.')).toBeVisible();
  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.locator('.overlay')).toHaveCount(0);
});

test('retries transient failures and rejects incomplete scanner files', async ({ page, context }) => {
  let attempts = 0;
  await context.route('https://raw.githubusercontent.com/**/jpn.traineddata', route => route.fulfill({
    status: ++attempts === 1 ? 503 : 200,
    body: 'truncated data',
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText(/Scanner unavailable/);
  expect(attempts).toBe(2);
  expect(await page.evaluate(async () => (await caches.keys()).some(key => key.startsWith('nihonlens-pack-')))).toBe(false);
});
