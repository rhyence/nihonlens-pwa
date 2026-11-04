import { describe, expect, it, vi } from 'vitest';
import { convert, fill, FrameGate, pesosToYen, Tracker, yen, yenReadings } from './vision';
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

it('extracts explicit prices from a menu line and ignores quantities', () => {
  const box = { x: 0, y: 0, w: 1, h: 0.1 };
  const readings = yenReadings([{ text: '海鮮丼 ¥4,400 8個 お茶 500円', box }, { text: '人気5種・10貫', box }]);
  expect(readings.map(reading => reading.text)).toEqual(['¥4,400', '¥500']);
  expect(readings[0].box.x).toBeLessThan(readings[1].box.x);
  expect(yenReadings([{ text: '価格 12.50円', box }])).toEqual([]);
  expect(pesosToYen('1760', '0.40')).toBe('¥4,400');
  expect(pesosToYen('1.01', '0.40')).toBe('¥3');
  expect(pesosToYen('100', '0')).toBeUndefined();
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

it('smooths detected prices and immediately removes missing overlays', () => {
  const tracker = new Tracker();
  const line = { text: 'こんにちは', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  expect(tracker.update([line], 0)).toEqual([]);
  const [first] = tracker.update([{ ...line, box: { ...line.box, x: 0.12 } }], 800);
  expect(first.box.x).toBeCloseTo(0.107);
  expect(tracker.update([], 801)).toEqual([]);
  expect(tracker.update([line], 802)).toEqual([]);
});

it('removes only the missing price when other prices remain visible', () => {
  const tracker = new Tracker();
  const first = { text: '¥500', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  const second = { text: '¥800', box: { x: 0.1, y: 0.6, w: 0.3, h: 0.1 } };
  const initial = tracker.update([first, second], 0, 1);
  const remaining = tracker.update([second], 1, 1);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].id).toBe(initial[1].id);
  expect(remaining[0].text).toBe('¥800');
});

it('shows a price on the first scan even when recognition takes longer than track expiry', () => {
  const tracker = new Tracker();
  const price = { text: '¥1,280', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  expect(tracker.update([price], 0, 1)).toHaveLength(1);
  expect(tracker.update([price], 15000, 1)).toHaveLength(1);
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

it('repairs grouped yen OCR readings', () => {
  expect(yen('\\4.400。')).toBe(4400n);
  expect(yen('4.400')).toBeUndefined();
});
