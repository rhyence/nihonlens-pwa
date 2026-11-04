import { createWorker, OEM, PSM, type Worker as OCR } from 'tesseract.js';
import { packCache, packPath } from './pack-info';
import { normalize, yen, type Reading } from './vision';

function deadline<T>(work: Promise<T>, message: string, milliseconds = 45000) {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

export class Engines {
  private ocr?: OCR;
  private translator?: Worker;
  private pending?: { resolve: (result: string) => void; reject: (error: Error) => void };
  private id = 0;
  private closed = false;
  private vertical = false;

  constructor(private readonly lowMemory = false) {}

  async read(canvas: HTMLCanvasElement, vertical: boolean, thorough = false): Promise<Reading[]> {
    if (this.closed) throw new Error('OCR stopped.');
    if (!this.ocr || this.vertical !== vertical) {
      await this.ocr?.terminate();
      let workerPath = packPath + 'runtime/worker.min.js';
      let workerUrl: string | undefined;
      if (this.lowMemory) {
        const cached = await (await caches.open(packCache)).match(workerPath);
        if (!cached) throw new Error('The Japanese OCR worker is missing from the offline pack.');
        workerUrl = URL.createObjectURL(await cached.blob());
        workerPath = workerUrl;
      }
      const started = createWorker(vertical ? 'jpn_vert' : 'jpn', OEM.LSTM_ONLY, {
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
        if (workerUrl) URL.revokeObjectURL(workerUrl);
      }
      if (this.closed) {
        await this.ocr.terminate();
        throw new Error('OCR stopped.');
      }
      this.vertical = vertical;
    }
    const worker = this.ocr;
    const { width, height } = canvas;
    const recognize = async (mode: PSM): Promise<Reading[]> => {
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await deadline(worker.recognize(canvas, {}, { blocks: true }), 'Japanese OCR timed out.');
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
      return lines.flatMap(({ text, bbox }) => {
        const x0 = Math.max(0, bbox.x0);
        const y0 = Math.max(0, bbox.y0);
        const x1 = Math.min(width, bbox.x1);
        const y1 = Math.min(height, bbox.y1);
        const normalized = normalize(text);
        if (!normalized || !(x1 > x0 && y1 > y0)) return [];
        return [{ text: normalized, box: { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height } }];
      }).slice(0, 30);
    };

    const first = await recognize(vertical ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SPARSE_TEXT);
    if (vertical || !thorough) return first;
    const useful = (readings: Reading[]) => readings.some(({ text }) =>
      yen(text) !== undefined || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]{2}/u.test(text.replace(/\s/g, '')));
    if (useful(first)) return first;

    // Sparse recognition can miss dense horizontal menus or tightly framed text.
    for (const mode of [PSM.AUTO, PSM.SINGLE_BLOCK]) {
      if (this.closed) return [];
      const retry = await recognize(mode);
      if (useful(retry)) return retry;
      if (retry.length > first.length) first.splice(0, first.length, ...retry);
    }
    return first;
  }

  translate(text: string): Promise<string> {
    if (this.closed || this.pending) return Promise.reject(new Error('Translation is unavailable.'));
    if (!this.translator) {
      this.translator = new Worker(new URL('./translation.worker.ts', import.meta.url), { type: 'module' });
      this.translator.onmessage = ({ data }) => {
        if (data.id !== this.id) return;
        const pending = this.pending;
        this.pending = undefined;
        if (data.error) pending?.reject(new Error(data.error));
        else pending?.resolve(data.value);
      };
      this.translator.onerror = event => {
        const pending = this.pending;
        this.pending = undefined;
        pending?.reject(new Error(event.message || 'Translation worker stopped.'));
      };
    }
    return deadline(new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.translator!.postMessage({ id: ++this.id, text, lowMemory: this.lowMemory });
    }), 'English translation timed out.');
  }

  async releaseOcr() {
    const worker = this.ocr;
    this.ocr = undefined;
    await worker?.terminate();
  }

  releaseTranslation() {
    this.translator?.terminate();
    this.translator = undefined;
    this.pending?.reject(new Error('Translation stopped.'));
    this.pending = undefined;
  }

  async smokeTest(verifyTranslation = true) {
    let recognized = '';
    for (const vertical of [true, false]) {
      const image = new Image();
      image.src = vertical ? '/smoke-vertical.png' : '/smoke-ja.png';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const lines = await this.read(canvas, vertical);
      recognized = lines.map(line => line.text).join('').replace(/\s/g, '');
      if (!recognized.includes('こんにちは')) {
        throw new Error((vertical ? 'Vertical' : 'Horizontal') + ' Japanese OCR failed its verification image.');
      }
    }
    if (this.lowMemory) await this.releaseOcr();
    if (!verifyTranslation) return;
    const translation = await this.translate(recognized);
    if (!/hello|hi\b|good afternoon/i.test(translation)) throw new Error('Translation failed its Japanese verification sentence.');
    return translation;
  }

  async close() {
    this.closed = true;
    this.releaseTranslation();
    await this.releaseOcr();
  }
}
