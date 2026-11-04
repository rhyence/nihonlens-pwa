import { test, expect } from '@playwright/test';
import { join, basename } from 'node:path';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

test.use({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
});

test('installs the shell, preserves settings, and starts and freezes a camera preview offline', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const info = await manifest.json();
  expect(info.display).toBe('standalone');
  for (const icon of info.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await page.getByLabel('PHP per JPY').fill('0.39');
  await page.getByLabel('English translation').uncheck();
  await context.setOffline(true);
  await page.goto('/offline-check');
  await expect(page.getByRole('heading', { name: 'NihonLens' })).toBeVisible();
  await expect(page.getByLabel('PHP per JPY')).toHaveValue('0.39');
  await expect(page.getByLabel('English translation')).not.toBeChecked();
  await expect(page.getByRole('status')).toHaveText(/needs a download/);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible();
  await page.getByRole('button', { name: 'Freeze & scan' }).click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
});

test('runs actual Japanese OCR and translation after offline reload and detects eviction', async ({ page, context }) => {
  test.skip(!process.env.NIHON_MODEL_DIR && !process.env.NIHON_LIVE_DOWNLOAD,
    'Set NIHON_MODEL_DIR to verified local model artifacts, or NIHON_LIVE_DOWNLOAD=1 to exercise public downloads.');
  const fixtureDir = process.env.NIHON_MODEL_DIR;
  const fixtureServer = fixtureDir ? createServer((request, response) => {
    const file = join(fixtureDir, basename(request.url ?? ''));
    try {
      const { size } = statSync(file);
      response.writeHead(200, { 'access-control-allow-origin': '*', 'content-length': size });
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404).end(); }
  }) : undefined;
  if (fixtureServer) {
    await new Promise<void>(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
    const { port } = fixtureServer.address() as AddressInfo;
    await context.route(/https:\/\/(huggingface\.co|raw\.githubusercontent\.com)\//, route =>
      route.fulfill({ status: 302, headers: { 'access-control-allow-origin': '*',
        location: 'http://127.0.0.1:' + port + '/' + basename(new URL(route.request().url()).pathname) } }));
  }
  try {
    page.on('console', message => { if (process.env.NIHON_TRACE || message.type() === 'error' || message.type() === 'warning') console.log(message.text()); });
    if (process.env.NIHON_TRACE) context.on('response', response => console.log(response.status(), response.url().split('?')[0], response.fromServiceWorker()));
    page.on('requestfailed', request => console.log(request.url(), request.failure()?.errorText));
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveText(/needs a download/);
    await page.getByRole('button', { name: 'Download / retry pack' }).click();
    await expect(page.getByRole('status')).toHaveText(/Offline Ready|Pack unavailable/, { timeout: 390_000 });
    await expect(page.getByRole('status')).toHaveText('Offline Ready');
    if (fixtureDir) await context.unrouteAll();
    await context.setOffline(true);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image();
        image.src = '/camera-ja.png';
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const surface = canvas.getContext('2d')!;
        const stream = canvas.captureStream(8);
        const paint = () => surface.drawImage(image, 0, 0);
        paint();
        const timer = window.setInterval(paint, 100);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
        return stream;
      };
    });
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Offline Ready', { timeout: 90_000 });
    await page.getByLabel('PHP per JPY').fill('0.40');
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Freeze & scan' }).click();
    await expect(page.locator('.overlay').filter({ hasText: /hello/i })).toBeVisible({ timeout: 80_000 });
    await expect(page.locator('.overlay').filter({ hasText: 'PHP 512.00' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'PHP 512.00' }).click();
    await expect(page.getByText('Original Japanese')).toBeVisible();
    await expect(page.locator('[lang=ja]')).toHaveText(/1,280\s*円/);
    await page.getByLabel('English translation').uncheck();
    await expect(page.locator('.overlay').filter({ hasText: /hello/i })).toHaveCount(0);
    await page.getByLabel('PHP per JPY').fill('0.50');
    await expect(page.getByRole('button', { name: 'PHP 640.00' })).toBeVisible();
    await page.getByLabel('Yen conversion').uncheck();
    await expect(page.locator('.overlay')).toHaveCount(0);
    await page.evaluate(async () => {
      const name = (await caches.keys()).find(key => key.startsWith('nihonlens-pack-'))!;
      const cache = await caches.open(name);
      const asset = (await cache.keys()).find(key => key.url.endsWith('tokenizer.json'))!;
      await cache.put(asset, new Response('broken', { headers: { 'content-length': '6' } }));
    });
    await page.reload();
    await expect(page.getByRole('status')).toHaveText(/needs a download/);
    await page.getByRole('button', { name: 'Delete pack' }).click();
    await expect(page.getByRole('status')).toHaveText(/deleted/);
  } finally { fixtureServer?.close(); }
});

test('retries a transient failure and rejects an invalid pack download', async ({ page, context }) => {
  let attempts = 0;
  await context.route(/huggingface\.co\/.*\/config\.json\?/, route => route.fulfill({
    status: ++attempts === 1 ? 503 : 200,
    body: 'truncated model configuration',
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(/needs a download/);
  await page.getByRole('button', { name: 'Download / retry pack' }).click();
  await expect(page.getByRole('status')).toHaveText(/Could not save or verify marian\/config\.json/);
  expect(attempts).toBe(2);
  expect(await page.evaluate(async () => (await caches.keys()).some(key => key.startsWith('nihonlens-pack-')))).toBe(false);
});
