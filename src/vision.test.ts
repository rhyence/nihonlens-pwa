import { describe, expect, it, vi } from 'vitest';
import { confusedYenCandidates, possiblePriceCandidates, convert, fill, FrameGate, pesosToYen, Tracker, placeLabel, withoutConflicts, mergePriceRows, yen, yenReadings } from './vision';
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

it('smooths detected prices and tolerates one brief missed scan', () => {
  const tracker = new Tracker();
  const line = { text: 'こんにちは', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  expect(tracker.update([line], 0)).toEqual([]);
  const [first] = tracker.update([{ ...line, box: { ...line.box, x: 0.12 } }], 800);
  expect(first.box.x).toBeCloseTo(0.104);
  expect(tracker.update([], 801)[0].id).toBe(first.id);
  expect(tracker.update([], 802)).toEqual([]);
  expect(tracker.update([line], 802)).toEqual([]);
});

it('removes only the missing price after a second missed scan', () => {
  const tracker = new Tracker();
  const first = { text: '¥500', box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } };
  const second = { text: '¥800', box: { x: 0.1, y: 0.6, w: 0.3, h: 0.1 } };
  const initial = tracker.update([first, second], 0, 1);
  expect(tracker.update([second], 1, 1)).toHaveLength(2);
  const remaining = tracker.update([second], 2, 1);
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
  expect(yen('税込 1.280円')).toBe(1280n);
  expect(yen('12.50円')).toBeUndefined();
  expect(yenReadings([{ text: '価格 1.280円', box: { x: 0, y: 0, w: 1, h: 1 } }])[0].text).toBe('¥1,280');
});

it('offers ambiguous yen glyphs for confirmation only in a confident aligned price column', () => {
  const rows = ['き480ロ', '580ロ', '380ロg'].map((text, i) => ({ text, confidence: 74, box: { x: 0.1, y: 0.2 + i * 0.08, w: 0.17, h: 0.06 } }));
  expect(confusedYenCandidates(rows).map(row => row.text)).toEqual(['¥480', '¥580', '¥380']);
  expect(confusedYenCandidates(rows.slice(0, 1))).toEqual([]);
  expect(confusedYenCandidates(rows.map(row => ({ ...row, confidence: 30 })))).toEqual([]);
  expect(confusedYenCandidates(rows.map(row => ({ ...row, text: '480g' })))).toEqual([]);
  expect(confusedYenCandidates(rows.map(row => ({ ...row, text: '480' })))).toEqual([]);
  expect(confusedYenCandidates(rows.map((row, i) => ({ ...row, box: { ...row.box, x: i * 0.4 } })))).toEqual([]);
});

it('marks aligned unit-like suffixes for review without accepting outliers or bare numbers', () => {
  const rows = ['280m', '380m', '440m', '5480g', '40m', '580'].map((text, i) => ({ text, box: { x: 0.1, y: 0.1 + i * 0.03, w: 0.08, h: 0.025 } }));
  const candidates = possiblePriceCandidates(rows);
  expect(candidates.map(row => row.text)).toEqual(['¥280', '¥380', '¥440']);
  expect(candidates.every(row => row.uncertain)).toBe(true);
  expect(possiblePriceCandidates(rows.slice(0, 1))).toEqual([]);
});

it('recovers varied suffixes and attached size-label noise only as reviewed column candidates', () => {
  const rows = ['き480m', 'ss380p'].map((text, i) => ({ text, confidence: 30, box: { x: 0.2, y: 0.4 + i * 0.1, w: 0.22, h: 0.08 } }));
  expect(possiblePriceCandidates(rows).map(row => [row.text, row.uncertain])).toEqual([['¥480', true], ['¥380', true]]);
  expect(possiblePriceCandidates(rows.map(row => ({ ...row, text: row.text.replace('380p', '380pg') }))).map(row => row.text)).toEqual(['¥480', '¥380']);
  expect(possiblePriceCandidates(rows.slice(0, 1))).toEqual([]);
});

it('expires a missed price after the hold window and resets on a successful read', () => {
  const tracker = new Tracker();
  const price = { text: '¥240', box: { x: .1, y: .2, w: .3, h: .1 } };
  const [first] = tracker.update([price], 0, 1);
  expect(tracker.update([], 200, 1)[0].id).toBe(first.id);
  expect(tracker.update([price], 400, 1)[0].id).toBe(first.id);
  expect(tracker.update([], 500, 1)).toHaveLength(1);
  expect(tracker.update([], 3000, 1)).toHaveLength(0);
});
it('separates stacked labels while keeping them within the camera', () => {
  const first = { x: 20, y: 50, w: 90, h: 34 };
  const second = placeLabel({ ...first, y: 70 }, [first], 200)!;
  expect(second.y).toBeGreaterThanOrEqual(88);
  const third = placeLabel({ ...first, y: 90 }, [first, second], 200)!;
  expect(third.y + third.h).toBeLessThanOrEqual(196);
  expect(third.y + third.h <= first.y || third.y >= second.y + second.h).toBe(true);
});

it('matches identical stacked prices to the closest region instead of swapping rows', () => {
  const tracker = new Tracker();
  const first = { text: '¥500', box: { x: .1, y: .2, w: .3, h: .1 } };
  const second = { ...first, box: { ...first.box, y: .28 } };
  const initial = tracker.update([first, second], 0, 1);
  const moved = tracker.update([{ ...second, box: { ...second.box, y: .25 } }, first], 500, 1);
  expect(moved[0].id).toBe(initial[1].id);
  expect(moved[1].id).toBe(initial[0].id);
});

it('keeps an established row through one conflicting amount and switches only after agreement', () => {
  const tracker = new Tracker();
  const correct = { text: '¥480', box: { x: .1, y: .2, w: .3, h: .1 } };
  const wrong = { ...correct, text: '¥4800' };
  const [initial] = tracker.update([correct], 0, 1);
  expect(tracker.update([wrong], 200, 1)[0]).toMatchObject({ id: initial.id, text: '¥480', uncertain: true });
  expect(tracker.update([correct], 400, 1)[0].text).toBe('¥480');
  expect(tracker.update([wrong], 600, 1)[0].text).toBe('¥480');
  expect(tracker.update([wrong], 800, 1)[0]).toMatchObject({ id: initial.id, text: '¥4800' });
});

it('rejects conflicting crop amounts at the same row without merging adjacent prices', () => {
  const first = { text: '¥540', box: { x: .2, y: .2, w: .2, h: .05 } };
  const wrong = { ...first, text: '¥8540' };
  const next = { ...first, text: '¥640', box: { ...first.box, y: .27 } };
  expect(withoutConflicts([first, wrong, next])).toEqual([next]);
});

it('adds missing frozen rows without duplicates and withholds conflicting amounts', () => {
  const a = { text: '¥480', box: { x: .1, y: .2, w: .3, h: .1 } };
  const b = { text: '¥380', box: { ...a.box, y: .4 } };
  expect(mergePriceRows([a], [a, b])).toEqual([a, b]);
  expect(mergePriceRows([a], [{ ...a, text: '¥4800' }, b])).toEqual([b]);
});
