import { createWorker, OEM, PSM, type Worker as OCR } from 'tesseract.js';
import { packCache, packPath } from './pack-info';
import { confusedYenCandidates, possiblePriceCandidates, damagedPrefixCandidates, normalize, yen, yenReadings, overlap, withoutConflicts, type Reading } from './vision';
import { enhance } from './image';
import { priceRows } from './rows';

function deadline<T>(work: Promise<T>, message: string, milliseconds = 45000) {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export class Engines {
  private ocr?: OCR;
  private closed = false;

  async read(source: HTMLCanvasElement, attempt = 0, detailed = false): Promise<Reading[]> {
    if (this.closed) throw new Error('OCR stopped.');
    if (!this.ocr) {
      const cached = await (await caches.open(packCache)).match(packPath + 'runtime/worker.min.js');
      if (!cached) throw new Error('The Japanese OCR worker is missing from the offline pack.');
      const workerPath = URL.createObjectURL(await cached.blob());
      const started = createWorker('jpn', OEM.LSTM_ONLY, {
        workerPath, workerBlobURL: false,
        corePath: packPath + 'runtime/tesseract-core-lstm.wasm.js',
        langPath: packPath + 'ocr', cacheMethod: 'none', gzip: false,
      });
      try {
        this.ocr = await deadline(started, 'Japanese OCR initialization timed out.');
      } catch (error) {
        void started.then(worker => worker.terminate(), () => {});
        throw error ?? new Error('Japanese OCR could not start.');
      } finally {
        URL.revokeObjectURL(workerPath);
      }
      if (this.closed) {
        await this.ocr.terminate();
        throw new Error('OCR stopped.');
      }
    }
    const worker = this.ocr;
    const { canvas, map } = enhance(source, attempt === 7 ? 0 : attempt);
    const { width, height } = canvas;
    const recognize = async (mode: PSM, numbersOnly = false): Promise<Reading[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: numbersOnly ? '0123456789,¥￥円' : '' });
      const { data } = await deadline(worker.recognize(canvas, {}, { blocks: true }), 'Japanese OCR timed out.');
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
      const regions = numbersOnly ? lines.flatMap(line => line.words) : priceRows(lines);
      return regions.flatMap(({ text, bbox, confidence }) => {
        const x0 = Math.max(0, bbox.x0);
        const y0 = Math.max(0, bbox.y0);
        const x1 = Math.min(width, bbox.x1);
        const y1 = Math.min(height, bbox.y1);
        const normalized = normalize(text);
        if (!normalized || !(x1 > x0 && y1 > y0)) return [];
        return [{ text: normalized, confidence, box: { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height } }];
      }).filter(reading => /\d/.test(reading.text)).slice(0, 120);
    };

    let lines = await recognize(PSM.SPARSE_TEXT);
    if (detailed) {
      const layout = await recognize(PSM.AUTO);
      lines = [...lines, ...layout.filter(row => !lines.some(other => other.text === row.text && overlap(other.box, row.box) > 0.5))];
    }
    const recovered: Reading[] = [];
    const confident = confusedYenCandidates(lines);
    const candidates = [...(attempt === 8 ? damagedPrefixCandidates(lines) : []), ...(detailed ? yenReadings(lines) : []), ...confident, ...possiblePriceCandidates(lines).filter(candidate =>
      !confident.some(other => other.box === candidate.box))].slice(0, 24);
    // A bounded backup pass looks for digits even when the yen glyph is lost.
    // Never expose bare numeric OCR directly: verify its crop and require review.
    const backupCandidates = new Set<Reading>();
    if ((attempt === 7 && !yenReadings(lines).length) || attempt === 8) {
      const numeric = await recognize(PSM.SPARSE_TEXT, true);
      for (const reading of numeric) {
        const digits = normalize(reading.text).replace(/[¥￥円,\s]/g, '');
        if (!/^\d{2,6}$/.test(digits) || BigInt(digits) < 10n || reading.box.w * width < reading.box.h * height * 0.8) continue;
        if (candidates.some(other => Math.abs(other.box.x - reading.box.x) < 0.03 && Math.abs(other.box.y - reading.box.y) < 0.03)) continue;
        if (candidates.length >= 24) break;
        const candidate = { ...reading, text: '¥' + digits, uncertain: true };
        candidates.push(candidate);
        backupCandidates.add(candidate);
      }
    }
    // Do not scan the same physical amount twice when both layouts find it.
    const consistent = detailed ? withoutConflicts(candidates) : candidates;
    const unique = consistent.filter((row, i) => !consistent.slice(0, i).some(other => other.text === row.text && overlap(row.box, other.box) > 0.5));
    if (unique.length) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789,¥￥円' });
      for (const candidate of unique) {
        const box = candidate.box;
        const padding = Math.max(2, box.h * height * 0.1);
        const x = Math.max(0, Math.floor(box.x * width - padding));
        const y = Math.max(0, Math.floor(box.y * height - padding));
        const w = Math.min(width - x, Math.ceil(box.w * width + padding * 2));
        const h = Math.min(height - y, Math.ceil(box.h * height + padding * 2));
        // Normalize overly magnified digits as well as small text.
        const votes = new Map<string, number>();
        const sizes = new Set<string>();
        for (const targetHeight of [60, 40, 160]) {
          const zoom = Math.min(3, 1024 / w, targetHeight / h);
          const crop = document.createElement('canvas');
          crop.width = Math.max(1, Math.round(w * zoom));
          crop.height = Math.max(1, Math.round(h * zoom));
          const size = `${crop.width}x${crop.height}`;
          if (sizes.has(size)) continue;
          sizes.add(size);
          crop.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
          const { data } = await deadline(worker.recognize(crop), 'Price verification timed out.');
          const confirmed = normalize(data.text).replace(/[¥￥円,\s]/g, '');
          // An independent numeric read must agree on every digit before display.
          if (!/^\d{2,6}$/.test(confirmed) || BigInt(confirmed) < 10n) continue;
          if (!detailed && BigInt(confirmed) === yen(candidate.text)) { recovered.push(candidate); break; }
          // Backup segmentation can include a size label or the currency as digits.
          // Correct it only when two independently scaled crop reads agree.
          if ((detailed && BigInt(confirmed) === yen(candidate.text)) || backupCandidates.has(candidate)) {
            const count = (votes.get(confirmed) ?? 0) + 1;
            votes.set(confirmed, count);
            if (count >= 2) { recovered.push({ ...candidate, text: '¥' + confirmed, uncertain: candidate.uncertain || BigInt(confirmed) !== yen(candidate.text) }); break; }
          }
        }
      }
    }
    return [...(detailed ? [] : lines), ...recovered].filter((row, i, all) => !all.slice(0, i).some(other => other.text === row.text && overlap(other.box, row.box) > 0.5)).map(reading => ({ ...reading, box: map(reading.box) }));
  }

  async releaseOcr() {
    const worker = this.ocr;
    this.ocr = undefined;
    await worker?.terminate();
  }

  async smokeTest() {
    const image = new Image();
    image.src = '/camera-ja.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const lines = await this.read(canvas);
    if (!yenReadings(lines).some(reading => yen(reading.text) === 1280n)) {
      throw new Error('The offline scanner could not read the test price.');
    }
  }

  async close() {
    this.closed = true;
    await this.releaseOcr();
  }
}
