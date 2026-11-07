import { expect, it } from 'vitest';
import { restoreBox, localInk } from './image';

it('keeps unrotated coordinates unchanged', () => {
  const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 };
  const result = restoreBox(box, 640, 480, 640, 480, 0);
  for (const key of ['x', 'y', 'w', 'h'] as const) expect(result[key]).toBeCloseTo(box[key]);
});

it.each([-30, -15, 15, 30])('maps a rotated point back to its original position at %i degrees', angle => {
  const width = 960, height = 540;
  const radians = angle * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const rw = Math.ceil(Math.abs(width * c) + Math.abs(height * s));
  const rh = Math.ceil(Math.abs(width * s) + Math.abs(height * c));
  const dx = width * 0.2, dy = height * -0.1;
  const result = restoreBox({ x: (c * dx - s * dy + rw / 2) / rw, y: (s * dx + c * dy + rh / 2) / rh, w: 0, h: 0 }, width, height, rw, rh, angle);
  expect(result.x).toBeCloseTo(0.7);
  expect(result.y).toBeCloseTo(0.4);
});

it('reveals red ink under uneven lighting without turning plain paper into text', () => {
  const width = 80, height = 40;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const paper = 140 + x;
    pixels.set([paper, paper, paper, 255], i);
    if (x >= 39 && x <= 41 && y >= 10 && y <= 30) pixels.set([160, 45, 40, 255], i);
  }
  localInk(pixels, width, height);
  expect(pixels[(20 * width + 40) * 4]).toBe(0);
  expect(pixels[(20 * width + 20) * 4]).toBe(255);
  expect(pixels[(20 * width + 60) * 4]).toBe(255);
  expect(pixels[(20 * width + 40) * 4 + 3]).toBe(255);
});
it('keeps uniformly dark and bright surfaces blank in local contrast mode', () => {
  for (const level of [25, 200]) {
    const pixels = new Uint8ClampedArray(20 * 20 * 4).fill(level);
    localInk(pixels, 20, 20);
    expect(Array.from(pixels).filter((_, i) => i % 4 !== 3).every(value => value === 255)).toBe(true);
  }
});
