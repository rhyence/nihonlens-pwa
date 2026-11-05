import { createWorker, OEM, PSM, type Worker as OCR } from 'tesseract.js';
import { packCache, packPath } from './pack-info';
import { confusedYenCandidates, normalize, yen, yenReadings, type Reading } from './vision';
import { enhance } from './image';

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

  async read(source: HTMLCanvasElement, attempt = 0): Promise<Reading[]> {
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
    const { canvas, map } = enhance(source, attempt);
    const { width, height } = canvas;
    const recognize = async (mode: PSM): Promise<Reading[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: '' });
      const { data } = await deadline(worker.recognize(canvas, {}, { blocks: true }), 'Japanese OCR timed out.');
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
      return lines.flatMap(({ text, bbox, confidence }) => {
        const x0 = Math.max(0, bbox.x0);
        const y0 = Math.max(0, bbox.y0);
        const x1 = Math.min(width, bbox.x1);
        const y1 = Math.min(height, bbox.y1);
        const normalized = normalize(text);
        if (!normalized || !(x1 > x0 && y1 > y0)) return [];
        return [{ text: normalized, confidence, box: { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height } }];
      }).slice(0, 30);
    };

    const lines = await recognize(PSM.SPARSE_TEXT);
    const recovered: Reading[] = [];
    const candidates = confusedYenCandidates(lines).slice(0, 6);
    if (candidates.length) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789,¥￥円' });
      for (const candidate of candidates) {
        const box = candidate.box;
        const padding = Math.max(4, box.h * height * 0.15);
        const x = Math.max(0, Math.floor(box.x * width - padding));
        const y = Math.max(0, Math.floor(box.y * height - padding));
        const w = Math.min(width - x, Math.ceil(box.w * width + padding * 2));
        const h = Math.min(height - y, Math.ceil(box.h * height + padding * 2));
        const zoom = Math.min(3, 1024 / w, 256 / h);
        const crop = document.createElement('canvas');
        crop.width = Math.max(1, Math.round(w * zoom));
        crop.height = Math.max(1, Math.round(h * zoom));
        crop.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height);
        const { data } = await deadline(worker.recognize(crop), 'Price verification timed out.');
        const confirmed = normalize(data.text).replace(/[¥￥円,\s]/g, '');
        // A second, enlarged read must independently agree on all digits.
        if (/^\d+$/.test(confirmed) && BigInt(confirmed) === yen(candidate.text)) recovered.push(candidate);
      }
    }
    return [...lines, ...recovered].map(reading => ({ ...reading, box: map(reading.box) }));
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
