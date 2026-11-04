export type Box = { x: number; y: number; w: number; h: number };
export type Reading = { text: string; box: Box; confidence?: number };
export type Track = Reading & { id: number; seen: number; hits: number };
export function normalize(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function yen(text: string): bigint | undefined {
  const normalized = normalize(text).replace(/^[\\¥]\s*(\d{1,3}(?:[.,]\d{3})+)\s*[。」「』,]*$/u,
    (_, amount: string) => '¥' + amount.replaceAll('.', ','));
  const match = normalized.match(/^(?:(?:税込|税抜)\s*[:：]?\s*)?(?:(¥)\s*)?((?:\d{1,3}(?:,\d{3})+|\d+))\s*(円)?(?:\s*[(（]?(?:税込|税抜)[)）]?)?$/u);
  if (!match || (!match[1] && !match[3])) return;
  return BigInt(match[2].replaceAll(',', ''));
}

export function convert(amount: bigint, rate: string, code: string) {
  if (!/^\d{0,8}(?:\.\d{1,10})?$/.test(rate) || !rate) return;
  const [whole, fraction = ''] = rate.split('.');
  const divisor = 10n ** BigInt(fraction.length);
  const cents = (amount * BigInt(whole + fraction) * 100n + divisor / 2n) / divisor;
  return code + ' ' + (cents / 100n).toLocaleString('en-US') + '.' + String(cents % 100n).padStart(2, '0');
}

export function yenReadings(readings: Reading[]): Reading[] {
  return readings.flatMap(reading => {
    const exact = yen(reading.text);
    if (exact !== undefined) return [{ ...reading, text: '¥' + exact.toLocaleString('en-US') }];
    const text = normalize(reading.text);
    const pattern = /[¥]\s*(?:\d{1,3}(?:[,.]\d{3})+|\d+)(?![\d.,])|\\\s*\d{1,3}(?:[,.]\d{3})+|(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)\s*円/gu;
    return [...text.matchAll(pattern)].flatMap(match => {
      const value = yen(match[0]);
      if (value === undefined) return [];
      const box = reading.box;
      return [{ ...reading, text: '¥' + value.toLocaleString('en-US'), box: { ...box,
        x: box.x + box.w * match.index / text.length, w: box.w * match[0].length / text.length } }];
    });
  });
}

export function pesosToYen(amount: string, rate: string) {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || !/^\d{0,8}(?:\.\d{1,10})?$/.test(rate) || !rate) return;
  const [whole, fraction = ''] = rate.split('.');
  const divisor = BigInt(whole + fraction);
  if (!divisor) return;
  const [pesos, centavos = ''] = amount.split('.');
  const cents = BigInt(pesos + centavos.padEnd(2, '0'));
  const denominator = divisor * 100n;
  const rounded = (cents * 10n ** BigInt(fraction.length) + denominator / 2n) / denominator;
  return '¥' + rounded.toLocaleString('en-US');
}

export function fill(box: Box, sourceW: number, sourceH: number, viewW: number, viewH: number, fit: 'cover' | 'contain' = 'cover'): Box {
  const scale = (fit === 'contain' ? Math.min : Math.max)(viewW / sourceW, viewH / sourceH);
  return { x: box.x * sourceW * scale + (viewW - sourceW * scale) / 2,
    y: box.y * sourceH * scale + (viewH - sourceH * scale) / 2,
    w: box.w * sourceW * scale, h: box.h * sourceH * scale };
}

function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h / (a.w * a.h + b.w * b.h - w * h || 1);
}

export class Tracker {
  private tracks: Track[] = [];
  private id = 0;
  update(readings: Reading[], now: number, minimumHits = 2) {
    const unmatched = this.tracks.filter(track => now - track.seen < 3200);
    const active = readings.map(reading => {
      const index = unmatched.findIndex(track => overlap(track.box, reading.box) > 0.3 && track.text === reading.text);
      if (index < 0) return { ...reading, id: ++this.id, seen: now, hits: 1 };
      const [old] = unmatched.splice(index, 1);
      const box = { ...reading.box };
      for (const key of ['x', 'y', 'w', 'h'] as const) box[key] = old.box[key] * 0.65 + box[key] * 0.35;
      return { ...reading, box, id: old.id, seen: now, hits: old.hits + 1 };
    });
    this.tracks = active.slice(0, 40);
    return this.tracks.filter(track => track.hits >= minimumHits);
  }
  clear() { this.tracks = []; }
}

export class FrameGate {
  private epoch = 0;
  private busy = false;
  invalidate() { this.epoch++; }
  async run<T>(work: () => Promise<T>, publish: (value: T) => void) {
    if (this.busy) return false;
    this.busy = true;
    const epoch = this.epoch;
    try {
      const result = await work();
      if (epoch === this.epoch) publish(result);
    } catch (error) {
      if (epoch === this.epoch) throw error;
    } finally {
      this.busy = false;
    }
    return epoch === this.epoch;
  }
}
