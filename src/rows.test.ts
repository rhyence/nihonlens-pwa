import { expect, it } from 'vitest';
import { priceRows } from './rows';
const word = (text: string, x0: number, x1: number, y0 = 20) => ({ text, confidence: 80, bbox: { x0, x1, y0, y1: y0 + 20 } });
it('splits side-by-side amounts at word boundaries and keeps their currency glyphs', () => {
  const words = [word('240', 10, 50), word('円', 50, 60), word('340', 90, 130), word('円', 130, 140)];
  const rows = priceRows([{ ...word('240円 340円', 10, 140), words }]);
  expect(rows.map(row => row.text)).toEqual(['240円', '340円']);
  expect(rows.map(row => [row.bbox.x0, row.bbox.x1])).toEqual([[10, 60], [90, 140]]);
});
it('keeps stacked rows separate and preserves distinct equal prices', () => {
  const lines = [20, 50, 80].map(y => ({ ...word('480円', 10, 60, y), words: [word('480円', 10, 60, y)] }));
  expect(priceRows(lines).map(row => row.bbox.y0)).toEqual([20, 50, 80]);
});
