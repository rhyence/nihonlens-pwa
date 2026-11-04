import { describe, expect, it, vi } from 'vitest';
import { convert, fill, FrameGate, menuTranslation, Tracker, TranslationCache, yen } from './vision';
import { installed } from './pack';
import { packAssets, packPath } from './pack-info';

describe('yen', () => {
  it.each([['¥500', 500n], ['￥５００', 500n], ['500円', 500n], ['1,280円', 1280n],
    ['¥1,280', 1280n], ['税込 1,280円', 1280n], ['税抜 980円', 980n]])('recognizes %s', (text, value) => {
    expect(yen(text)).toBe(value);
  });
  it.each(['2026年11月4日', '12:30', '20個', '50%', 'RX-980', '¥1,2', 'JPY 5', 'abc500円'])('rejects %s', text => {
    expect(yen(text)).toBeUndefined();
  });
  it('rounds half a cent exactly and keeps large integer precision', () => {
    expect(convert(3n, '0.005', 'USD')).toBe('USD 0.02');
    expect(convert(9007199254740993n, '0.01', 'PHP')).toBe('PHP 90,071,992,547,409.93');
    expect(convert(10n, '-1', 'PHP')).toBeUndefined();
  });
});

it('bounds and normalizes translation cache keys', async () => {
  const cache = new TranslationCache(1);
  const translate = vi.fn(async () => 'Hello');
  await cache.get(' こんにちは ', translate);
  await cache.get('こんにちは', translate);
  await cache.get('500円', translate);
  expect(translate).toHaveBeenCalledTimes(1);
  await cache.get('ありがとう', translate);
  await cache.get('こんにちは', translate);
  expect(translate).toHaveBeenCalledTimes(3);
});

it('drops overlapping work and rejects stale frames', async () => {
  const gate = new FrameGate();
  const publish = vi.fn();
  let release!: (value: string) => void;
  const pending = gate.run(() => new Promise(resolve => { release = resolve; }), publish);
  const dropped = vi.fn(async () => 'dropped');
  await gate.run(dropped, publish);
  gate.invalidate();
  release('stale');
  await pending;
  await gate.run(async () => 'fresh', publish);
  expect(dropped).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledExactlyOnceWith('fresh');
});

it('smooths, retains briefly and expires a stable overlay', () => {
  const tracker = new Tracker();
  const line = { text: 'こんにちは', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  expect(tracker.update([line], 0)).toEqual([]);
  const [first] = tracker.update([{ ...line, box: { ...line.box, x: 0.12 } }], 800);
  expect(first.box.x).toBeCloseTo(0.107);
  expect(tracker.update([], 1200)[0].id).toBe(first.id);
  expect(tracker.update([], 4100)).toEqual([]);
});

it('maps the center through aspect-fill cropping', () => {
  expect(fill({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 1920, 1080, 360, 640))
    .toMatchObject({ x: 180, y: 320, h: 64 });
});

it('requires all versioned pack assets and rejects a truncated entry', async () => {
  const items = new Map<string, Response>();
  const cache = { match: async (key: RequestInfo | URL) => items.get(String(key)) };
  expect(await installed(cache)).toBe(false);
  items.set(packPath + 'complete.json', new Response('{}'));
  expect(await installed(cache)).toBe(false);
  for (const file of packAssets) items.set(packPath + file.path,
    new Response(null, { headers: { 'content-type': file.type, 'content-length': String(file.bytes) } }));
  expect(await installed(cache)).toBe(true);
  items.set(packPath + packAssets[0].path, new Response('bad', { headers: { 'content-length': '3' } }));
  expect(await installed(cache)).toBe(false);
});

it('uses exact dish names and repairs grouped yen OCR readings', () => {
  expect(menuTranslation('海 鮮 丼')).toBe('Seafood rice bowl');
  expect(menuTranslation('うに丼')).toBe('Sea urchin rice bowl');
  expect(menuTranslation('レボ 6 記 王')).toBeUndefined();
  expect(yen('\\4.400。')).toBe(4400n);
  expect(yen('4.400')).toBeUndefined();
});
