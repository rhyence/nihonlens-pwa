import type { Box } from './vision';

// First try the untouched image. Only unsuccessful scans use these fallbacks.
export const scanAngles = [0, 0, 0, -15, 15, -30, 30, 0, 0];

export function restoreBox(box: Box, width: number, height: number, rotatedWidth: number, rotatedHeight: number, angle: number): Box {
  const radians = angle * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
  const points = corners.map(([x, y]) => {
    const dx = x * rotatedWidth - rotatedWidth / 2;
    const dy = y * rotatedHeight - rotatedHeight / 2;
    return { x: Math.max(0, Math.min(1, (c * dx + s * dy + width / 2) / width)),
      y: Math.max(0, Math.min(1, (-s * dx + c * dy + height / 2) / height)) };
  });
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y };
}

// Local brightness keeps colored ink visible under shadows and glossy reflections.
export function localInk(pixels: Uint8ClampedArray, width: number, height: number) {
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      ink[i] = Math.min(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
      row += ink[i];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) * 0.028));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    const sum = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
    const i = y * width + x;
    const value = ink[i] < sum / ((x1 - x0) * (y1 - y0)) - 12 ? 0 : 255;
    pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = value;
  }
}

export function enhance(source: HTMLCanvasElement, attempt: number) {
  // Live attempt 1 preserves the higher-resolution image before enhancement.
  if (attempt < 2) return { canvas: source, map: (box: Box) => box };
  const { width, height } = source;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height);
  if (attempt === 8) {
    localInk(pixels.data, width, height);
    ctx.putImageData(pixels, 0, 0);
    return { canvas, map: (box: Box) => box };
  }
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(pixels.data[i * 4] * 0.299 + pixels.data[i * 4 + 1] * 0.587 + pixels.data[i * 4 + 2] * 0.114);
    histogram[gray[i]]++;
  }
  let low = 0, high = 255, count = 0;
  const tail = gray.length * 0.01;
  while (low < 254 && count + histogram[low] < tail) count += histogram[low++];
  count = 0;
  while (high > low + 1 && count + histogram[high] < tail) count += histogram[high--];
  // Stretch the useful brightness range without inventing detail in clipped glare.
  for (let i = 0; i < gray.length; i++) {
    const value = Math.max(0, Math.min(255, Math.round((gray[i] - low) * 255 / Math.max(24, high - low))));
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
  const angle = scanAngles[attempt] ?? 0;
  if (!angle) return { canvas, map: (box: Box) => box };
  const radians = angle * Math.PI / 180;
  const rotated = document.createElement('canvas');
  rotated.width = Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)));
  rotated.height = Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)));
  const rotation = rotated.getContext('2d')!;
  rotation.fillStyle = '#fff';
  rotation.fillRect(0, 0, rotated.width, rotated.height);
  rotation.translate(rotated.width / 2, rotated.height / 2);
  rotation.rotate(radians);
  rotation.drawImage(canvas, -width / 2, -height / 2);
  return { canvas: rotated, map: (box: Box) => restoreBox(box, width, height, rotated.width, rotated.height, angle) };
}
