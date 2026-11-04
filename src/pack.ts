import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { packAssets, packBytes, packCache, packPath } from './pack-info';

const marker = packPath + 'complete.json';

export async function controlled() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('Offline storage requires a supported browser and HTTPS.');
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', done);
      resolve();
    };
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', done);
      reject(new Error('Offline support is still starting. Reload this page and retry.'));
    }, 8000);
    navigator.serviceWorker.addEventListener('controllerchange', done);
    if (navigator.serviceWorker.controller) done();
  });
}

export async function installed(cache: Pick<Cache, 'match'>) {
  if (!(await cache.match(marker))) return false;
  for (const asset of packAssets) {
    const response = await cache.match(packPath + asset.path);
    if (!response || response.headers.get('content-length') !== String(asset.bytes) ||
        response.headers.get('content-type') !== asset.type) return false;
  }
  return true;
}

export async function verifyInstalled(signal: AbortSignal) {
  if (!(await caches.has(packCache))) return false;
  const cache = await caches.open(packCache);
  if (!(await installed(cache))) return false;
  for (const asset of packAssets) {
    const response = await cache.match(packPath + asset.path);
    if (!response?.body) return false;
    const hash = sha256.create();
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        hash.update(value);
      }
    } finally { await reader.cancel(); }
    if (bytes !== asset.bytes || bytesToHex(hash.digest()) !== asset.sha256) return false;
  }
  return true;
}

async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return operation();
  return navigator.locks.request('nihonlens-language-pack', { ifAvailable: true }, lock => {
    if (!lock) throw new Error('A language pack operation is running in another tab.');
    return operation();
  });
}

export async function downloadPack(progress: (message: string) => void, signal: AbortSignal) {
  await controlled();
  await exclusive(async () => {
    await clearPacks();
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < packBytes + 10_000_000)
      throw new Error('Free at least ' + Math.ceil((packBytes + 10_000_000) / 1e6) + ' MB of browser storage and retry.');
    const cache = await caches.open(packCache);
    let saved = 0;
    try {
      for (const [index, asset] of packAssets.entries()) {
        const report = (bytes: number) => progress('Downloading file ' + (index + 1) + '/' + packAssets.length +
          ' · ' + ((saved + bytes) / 1e6).toFixed(1) + '/' + (packBytes / 1e6).toFixed(1) + ' MB');
        report(0);
        const response = await fetch(asset.url, { signal, cache: 'no-store', credentials: 'omit' });
        if (!response.ok || !response.body) throw new Error('Could not download ' + asset.path + ' (HTTP ' + response.status + ').');
        let bytes = 0;
        const hash = sha256.create();
        const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const previous = bytes;
            bytes += chunk.byteLength;
            if (bytes > asset.bytes) throw new Error('Incorrect size: ' + asset.path);
            hash.update(chunk);
            if (Math.floor(previous / 1e6) !== Math.floor(bytes / 1e6)) report(bytes);
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== asset.bytes || bytesToHex(hash.digest()) !== asset.sha256)
              throw new Error('Integrity check failed: ' + asset.path);
          },
        }));
        try {
          await cache.put(packPath + asset.path, new Response(stream, { headers: {
            'content-type': asset.type, 'content-length': String(asset.bytes),
          } }));
        } catch (error) {
          if (signal.aborted) throw error;
          throw new Error('Could not save or verify ' + asset.path + '. Check your connection and available browser storage.', { cause: error });
        }
        saved += bytes;
      }
      signal.throwIfAborted();
      await cache.put(marker, new Response('{}'));
    } catch (error) {
      await caches.delete(packCache);
      throw error;
    }
  });
}

async function clearPacks() {
  for (const name of await caches.keys()) {
    if (name.startsWith('nihonlens-pack-')) await caches.delete(name);
  }
}

export async function removePack() {
  await exclusive(clearPacks);
}
