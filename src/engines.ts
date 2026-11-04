import { createWorker, OEM, PSM, type Worker as OCR } from 'tesseract.js';
import { packCache, packPath } from './pack-info';
import { normalize, yen, yenReadings, type Reading } from './vision';

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

  async read(canvas: HTMLCanvasElement): Promise<Reading[]> {
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
    const { width, height } = canvas;
    const recognize = async (mode: PSM): Promise<Reading[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
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

    return recognize(PSM.SPARSE_TEXT);
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
