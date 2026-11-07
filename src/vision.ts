export type Box = { x: number; y: number; w: number; h: number };
export type Reading = { text: string; box: Box; confidence?: number; uncertain?: boolean };
export type Track = Reading & { id: number; seen: number; hits: number; misses?: number; pending?: string; pendingHits?: number };
export function normalize(text: string) {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function yen(text: string): bigint | undefined {
  const normalized = normalize(text).replace(/^[\\¥]\s*(\d{1,3}(?:[.,]\d{3})+)\s*[。」「』,]*$/u,
    (_, amount: string) => '¥' + amount.replaceAll('.', ','));
  const match = normalized.match(/^(?:(?:税込|税抜)\s*[:：]?\s*)?(?:(¥)\s*)?((?:\d{1,3}(?:[,.]\d{3})+|\d+))\s*(円)?(?:\s*[(（]?(?:税込|税抜)[)）]?)?$/u);
  if (!match || (!match[1] && !match[3])) return;
  return BigInt(match[2].replace(/[,.]/g, ''));
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
    const pattern = /[¥]\s*(?:\d{1,3}(?:[,.]\d{3})+|\d+)(?![\d.,])|\\\s*\d{1,3}(?:[,.]\d{3})+|(?<![\d.,])(?:\d{1,3}(?:[,.]\d{3})+|\d+)\s*円/gu;
    return [...text.matchAll(pattern)].flatMap(match => {
      const value = yen(match[0]);
      if (value === undefined) return [];
      const box = reading.box;
      return [{ ...reading, text: '¥' + value.toLocaleString('en-US'), box: { ...box,
        x: box.x + box.w * match.index / text.length, w: box.w * match[0].length / text.length } }];
    });
  });
}

// Small 円 glyphs can lose their internal strokes and be recognized as ロ or 口.
// Require a repeated, aligned price column; never infer prices from bare digits/g.
export function confusedYenCandidates(readings: Reading[]): Reading[] {
  const candidates = readings.flatMap(reading => {
    if ((reading.confidence ?? 0) < 60) return [];
    const match = normalize(reading.text).match(/(?<![\dA-Za-z])((?:\d{1,3}(?:[,.]\d{3})+|\d{2,7}))\s*[ロ口囗](?:[a-z])?$/u);
    if (!match) return [];
    return [{ ...reading, text: '¥' + BigInt(match[1].replace(/[,.]/g, '')).toLocaleString('en-US') }];
  });
  const anchors = [...candidates, ...yenReadings(readings)];
  return candidates.filter(candidate => anchors.some(other => {
    if (other === candidate) return false;
    const a = candidate.box, b = other.box;
    const vertical = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    return vertical > Math.min(a.h, b.h) * 0.6 && vertical < Math.max(a.h, b.h) * 6 &&
      Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) < Math.max(a.w, b.w) * 0.75 &&
      Math.max(a.h, b.h) < Math.min(a.h, b.h) * 2.8;
  }));
}

// Units and damaged currency glyphs are ambiguous: these are review-only prices.
export function possiblePriceCandidates(readings: Reading[]): Reading[] {
  const candidates = readings.flatMap(reading => {
    const match = normalize(reading.text).match(/(?<![\d.,])(\d[\dOoUu]{1,5})\s*[a-zロ口囗]{1,2}$/u);
    if (!match) return [];
    return [{ ...reading, text: '¥' + match[1].replace(/[OoUu]/g, '0'), uncertain: true }];
  });
  return candidates.filter(a => candidates.some(b => a !== b && a.text.length === b.text.length &&
    Math.abs(a.box.x + a.box.w / 2 - b.box.x - b.box.w / 2) < Math.max(a.box.w, b.box.w) * 0.8 &&
    Math.abs(a.box.y - b.box.y) > Math.min(a.box.h, b.box.h) * 0.6 &&
    Math.abs(a.box.y - b.box.y) < Math.max(a.box.h, b.box.h) * 10 &&
    Math.max(a.box.h, b.box.h) < Math.min(a.box.h, b.box.h) * 2.8));
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

export function overlap(a: Box, b: Box) {
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
      let index = -1, bestOverlap = 0.3;
      unmatched.forEach((track, candidateIndex) => {
        const score = overlap(track.box, reading.box);
        if (score > bestOverlap) { index = candidateIndex; bestOverlap = score; }
      });
      if (index < 0) return { ...reading, id: ++this.id, seen: now, hits: 1 };
      const [old] = unmatched.splice(index, 1);
      if (old.text !== reading.text) {
        const pendingHits = old.pending === reading.text ? (old.pendingHits ?? 0) + 1 : 1;
        if (pendingHits < 2) return { ...old, uncertain: true, seen: now, misses: 0, pending: reading.text, pendingHits };
      }
      const box = { ...reading.box };
      for (const key of ['x', 'y', 'w', 'h'] as const) box[key] = old.box[key] * 0.8 + box[key] * 0.2;
      return { ...reading, box, id: old.id, seen: now, hits: old.hits + 1 };
    });
    // Tolerate one brief OCR miss; do not carry a vanished price indefinitely.
    const held = unmatched.filter(track => now - track.seen < 2200 && !(track.misses ?? 0) && !active.some(current => overlap(current.box, track.box) > 0.3))
      .map(track => ({ ...track, misses: 1 }));
    this.tracks = [...active, ...held].slice(0, 40);
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

// Find the nearest free vertical slot for compact labels on stacked menu rows.
export function placeLabel(box: Box, placed: Box[], height: number): Box | undefined {
  const slots = [box.y, ...placed.flatMap(other => [other.y + other.h + 4, other.y - box.h - 4])];
  return slots.map(y => ({ ...box, y: Math.max(4, Math.min(height - box.h - 4, y)) }))
    .sort((a, b) => Math.abs(a.y - box.y) - Math.abs(b.y - box.y))
    .find(candidate => placed.every(other => candidate.x + candidate.w + 2 <= other.x || other.x + other.w + 2 <= candidate.x ||
      candidate.y + candidate.h + 2 <= other.y || other.y + other.h + 2 <= candidate.y));
}

// Disagreeing amounts at the same physical row are not independent prices.
export function withoutConflicts(readings: Reading[]): Reading[] {
  return readings.filter(row => !readings.some(other => other !== row && yen(other.text) !== yen(row.text) &&
    overlap(row.box, other.box) > 0.35));
}

export function mergePriceRows(first: Reading[], second: Reading[]): Reading[] {
  const all = withoutConflicts([...first, ...second]);
  return all.filter((row, i) => !all.slice(0, i).some(other => yen(other.text) === yen(row.text) && overlap(other.box, row.box) > 0.5));
}

// OCR sometimes loses the two horizontal strokes of a yen prefix.
// These remain candidates until a separate crop confirms the digits.
export function damagedPrefixCandidates(readings: Reading[]): Reading[] {
  return readings.flatMap(reading => {
    const match = normalize(reading.text).match(/\\\s*(\d{2,6})\s*$/u);
    return match ? [{ ...reading, text: '¥' + match[1], uncertain: true }] : [];
  });
}
