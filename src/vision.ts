export type Box = { x: number; y: number; w: number; h: number };
export type Reading = { text: string; box: Box; english?: string };
export type Track = Reading & { id: number; seen: number; hits: number };
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export function normalize(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function yen(text: string): bigint | undefined {
  const match = normalize(text).match(/^(?:(?:税込|税抜)\s*[:：]?\s*)?(?:(¥)\s*)?((?:\d{1,3}(?:,\d{3})+|\d+))\s*(円)?(?:\s*[(（]?(?:税込|税抜)[)）]?)?$/u);
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

export function fill(box: Box, sourceW: number, sourceH: number, viewW: number, viewH: number): Box {
  const scale = Math.max(viewW / sourceW, viewH / sourceH);
  return { x: box.x * sourceW * scale + (viewW - sourceW * scale) / 2,
    y: box.y * sourceH * scale + (viewH - sourceH * scale) / 2,
    w: box.w * sourceW * scale, h: box.h * sourceH * scale };
}

function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h / (a.w * a.h + b.w * b.h - w * h || 1);
}

function similar(a: string, b: string) {
  const left = a.replace(/\s/g, '');
  const right = b.replace(/\s/g, '');
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length < 3 || shorter.length / longer.length < 0.65) return false;
  return longer.includes(shorter) || [...shorter].filter((c, i) => longer[i] === c).length / longer.length >= 0.65;
}

export class Tracker {
  private tracks: Track[] = [];
  private id = 0;
  update(readings: Reading[], now: number) {
    const unmatched = this.tracks.filter(track => now - track.seen < 3200);
    const active = readings.map(reading => {
      const index = unmatched.findIndex(track => overlap(track.box, reading.box) > 0.3 && similar(track.text, reading.text));
      if (index < 0) return { ...reading, id: ++this.id, seen: now, hits: 1 };
      const [old] = unmatched.splice(index, 1);
      const box = { ...reading.box };
      for (const key of ['x', 'y', 'w', 'h'] as const) box[key] = old.box[key] * 0.65 + box[key] * 0.35;
      return { ...reading, box, english: reading.english ?? (old.text === reading.text ? old.english : undefined), id: old.id, seen: now, hits: old.hits + 1 };
    });
    this.tracks = [...active, ...unmatched].slice(0, 40);
    return this.tracks.filter(track => track.hits >= 2);
  }
  clear() { this.tracks = []; }
}

export class TranslationCache {
  private values = new Map<string, string>();
  constructor(private limit = 128) {}
  async get(text: string, translate: (text: string) => Promise<string>) {
    const key = normalize(text);
    if (!japanese.test(key) || yen(key) !== undefined) return '';
    let result = this.values.get(key);
    if (result === undefined) result = await translate(key.slice(0, 200));
    this.values.delete(key);
    this.values.set(key, result);
    if (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
    return result;
  }
}

export class FrameGate {
  private epoch = 0;
  private busy = false;
  invalidate() { this.epoch++; }
  async run<T>(work: () => Promise<T>, publish: (value: T) => void) {
    if (this.busy) return;
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
  }
}
