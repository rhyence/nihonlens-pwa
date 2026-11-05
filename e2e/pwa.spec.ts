import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

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
  await page.getByRole('button', { name: 'Quick converter', exact: true }).click();
  await page.getByLabel('Amount in JPY').fill('1280');
  await expect(page.getByLabel('Amount in pesos')).toHaveText('₱512.00');
  await page.getByRole('button', { name: 'Pesos → Yen', exact: true }).click();
  await page.getByLabel('Amount in PHP').fill('1760');
  await expect(page.getByLabel('Amount in yen')).toHaveText('¥4,400');
  await page.getByRole('button', { name: 'Close converter' }).click();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Exchange rate' }).click();
  await page.getByLabel('PHP per JPY').fill('0.50');
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.menu-sheet')).not.toBeVisible();
  await page.getByRole('button', { name: 'Quick converter', exact: true }).click();
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
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
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
  await page.locator('.overlay').click();
  await page.getByRole('button', { name: 'Open shopping list' }).click();
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱512.00');
  await page.getByLabel('Budget in PHP', { exact: true }).fill('1000');
  await expect(page.getByText('Remaining: ₱488.00', { exact: true })).toBeVisible();
  await page.getByLabel('Item 1 quantity', { exact: true }).fill('2');
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱1,024.00');
  await expect(page.getByText('Over budget: ₱24.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove item 1', exact: true }).click();
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱0.00');
  await expect(page.getByText('Remaining: ₱1,000.00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo removal of Item 1' }).click();
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱1,024.00');
  await page.getByRole('button', { name: 'Close shopping list' }).click();
  await page.getByRole('button', { name: 'US$ USD', exact: true }).click();
  await expect(page.locator('.overlay')).toHaveText('US$8.07');
  await page.getByRole('button', { name: '₱ PHP', exact: true }).click();
  await expect(page.locator('.overlay')).toHaveText('₱512.00');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Exchange rate' }).click();
  await page.getByLabel('PHP per JPY').fill('0.50');
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.menu-sheet')).not.toBeVisible();
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
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText(/Scanner unavailable/);
  expect(attempts).toBe(2);
  expect(await page.evaluate(async () => (await caches.keys()).some(key => key.startsWith('nihonlens-pack-')))).toBe(false);
});

test('recognizes three menu prices in a real photo and adds the chosen price', async ({ page, context }) => {
  const photo = process.env.NIHON_MENU_IMAGE;
  const fixture = process.env.NIHON_MODEL_DIR;
  test.skip(!photo || !fixture, 'Set NIHON_MENU_IMAGE and NIHON_MODEL_DIR for the private photo regression.');
  await context.route('https://raw.githubusercontent.com/**/jpn.traineddata', route => route.fulfill({ path: join(fixture!, 'jpn.traineddata'), headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/menu-regression.jpg', route => route.fulfill({ path: photo!, contentType: 'image/jpeg' }));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image(); image.src = '/menu-regression.jpg'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const paint = () => canvas.getContext('2d')!.drawImage(image, 0, 0);
      const stream = canvas.captureStream(8); paint();
      const timer = window.setInterval(paint, 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText('Offline scanner ready', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.menu-sheet')).not.toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('.overlay')).toHaveText(['₱192.00', '₱232.00', '₱152.00'], { timeout: 30_000 });
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(page.locator('.overlay')).toHaveText(['₱192.00', '₱232.00', '₱152.00'], { timeout: 30_000 });
  await page.getByRole('button', { name: 'Add ¥580 to shopping list', exact: true }).click();
  await page.getByRole('button', { name: 'Open shopping list', exact: true }).click();
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱232.00');
  await expect(page.getByLabel('Item 1 yen price', { exact: true })).toHaveValue('580');
});

test('reads a full menu and requires review before adding uncertain prices', async ({ page, context }) => {
  const photo = process.env.NIHON_FULL_MENU_IMAGE;
  const fixture = process.env.NIHON_MODEL_DIR;
  test.skip(!photo || !fixture, 'Set NIHON_MENU_IMAGE and NIHON_MODEL_DIR for the private photo regression.');
  await context.route('https://raw.githubusercontent.com/**/jpn.traineddata', route => route.fulfill({ path: join(fixture!, 'jpn.traineddata'), headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/menu-regression.jpg', route => route.fulfill({ path: photo!, contentType: 'image/jpeg' }));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image(); image.src = '/menu-regression.jpg'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const paint = () => {
        const ctx = canvas.getContext('2d')!;
        const zoom = document.documentElement.dataset.menuZoom;
        if (zoom === 'beef') ctx.drawImage(image, 15, 115, 100, 124, 0, 0, canvas.width, canvas.height);
        else if (zoom === 'karubi') ctx.drawImage(image, 335, 315, 90, 112, 0, 0, canvas.width, canvas.height);
        else ctx.drawImage(image, 0, 0);
      };
      const stream = canvas.captureStream(8); paint();
      const timer = window.setInterval(paint, 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText('Offline scanner ready', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.menu-sheet')).not.toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('.detected-button')).toBeVisible({ timeout: 30_000 });
  await page.locator('.detected-button').click();
  console.log('Live full-menu candidates:', await page.locator('.detected-list button').allTextContents());
  expect(await page.locator('.detected-list button').count()).toBeGreaterThanOrEqual(6);
  await page.getByRole('button', { name: 'Close detected prices' }).click();
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(page.locator('.detected-button')).toBeVisible({ timeout: 30_000 });
  await page.locator('.detected-button').click();
  await expect(page.getByRole('button', { name: 'Review possible ¥280 price', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Review possible ¥640 price', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review possible ¥580 price', exact: true })).toBeVisible();
  console.log('Full-menu prices:', await page.locator('.detected-list button').allTextContents());
  await page.getByRole('dialog', { name: 'Detected prices', exact: true }).evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: 'test-results/full-menu-overlays.png' });
  await page.getByRole('button', { name: 'Review possible ¥280 price', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Check this price' })).toBeVisible();
  await expect(page.locator('.cart-dock')).toContainText('0 items');
  await page.getByLabel('Price in yen', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Confirm and add' }).click();
  await page.getByRole('button', { name: 'Open shopping list', exact: true }).click();
  await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱120.00');
  await page.getByRole('button', { name: 'Close shopping list' }).click();
  for (const zoom of ['beef', 'karubi']) {
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.evaluate(async zoom => {
      document.documentElement.dataset.menuZoom = zoom;
      const video = document.querySelector('video')!;
      await new Promise<void>(resolve => video.requestVideoFrameCallback(() => video.requestVideoFrameCallback(() => resolve())));
    }, zoom);
    await page.getByRole('button', { name: 'Freeze', exact: true }).click();
    await expect(page.locator('.detected-button')).toBeVisible({ timeout: 30_000 });
    await page.locator('.detected-button').click();
    console.log(zoom + ' zoom results:', await page.locator('.detected-list button').allTextContents());
    const expected = zoom === 'beef' ? ['280', '380', '440', '540'] : ['480', '580', '380'];
    for (const amount of expected) await expect(page.locator('.detected-list')).toContainText('¥' + amount + ' →');
    await page.getByRole('button', { name: 'Close detected prices' }).click();
  }
});

for (const frameWidth of [541, 1082]) test(`recognizes prices from the failing phone capture at ${frameWidth}px`, async ({ page, context }) => {
  const photo = process.env.NIHON_PHONE_IMAGE;
  const fixture = process.env.NIHON_MODEL_DIR;
  test.skip(!photo || !fixture, 'Requires the private phone capture and OCR model.');
  await context.route('https://raw.githubusercontent.com/**/jpn.traineddata', route => route.fulfill({ path: join(fixture!, 'jpn.traineddata'), headers: { 'access-control-allow-origin': '*' } }));
  await context.route('**/phone-regression.jpg', route => route.fulfill({ path: photo!, contentType: 'image/jpeg' }));
  await page.addInitScript(frameWidth => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image(); image.src = '/phone-regression.jpg'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = frameWidth; canvas.height = Math.round(frameWidth * 410 / 541);
      const paint = () => canvas.getContext('2d')!.drawImage(image, 25, 330, 541, 410, 0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(8); paint();
      const timer = window.setInterval(paint, 100);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  }, frameWidth);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Download scanner' }).click();
  await expect(page.locator('.pack-status')).toHaveText('Offline scanner ready', { timeout: 90_000 });
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.menu-sheet')).not.toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.locator('.detected-button')).toBeVisible({ timeout: 30_000 });
  await page.locator('.detected-button').click();
  for (const amount of ['480', '380']) await expect(page.locator('.detected-list')).toContainText('¥' + amount + ' →');
  await page.getByRole('button', { name: 'Close detected prices' }).click();
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await expect(page.locator('.detected-button')).toBeVisible({ timeout: 30_000 });
  await page.locator('.detected-button').click();
  console.log('Phone capture:', await page.locator('.detected-list').textContent());
  for (const amount of ['480', '380']) await expect(page.locator('.detected-list')).toContainText('¥' + amount + ' →');
});

test('activates an update and keeps the shopping list through reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await page.getByRole('button', { name: 'Open shopping list', exact: true }).click();
  await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  await page.getByLabel('Item 1 yen price', { exact: true }).fill('480');
  await page.getByRole('button', { name: 'Close shopping list', exact: true }).click();
  const workerPath = join(process.cwd(), 'dist', 'sw.js');
  const original = await readFile(workerPath, 'utf8');
  try {
    await writeFile(workerPath, original + '\n// update lifecycle regression\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.getByRole('button', { name: 'Update now', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Update now', exact: true }).click();
    await expect(page.locator('.cart-dock')).toContainText('1 item');
    await page.getByRole('button', { name: 'Open shopping list', exact: true }).click();
    await expect(page.getByLabel('Item 1 yen price', { exact: true })).toHaveValue('480');
    await expect(page.getByLabel('Shopping total', { exact: true })).toHaveText('₱192.00');
  } finally { await writeFile(workerPath, original); }
});
