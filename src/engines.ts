import { createWorker, OEM, PSM, type Worker as OCR } from 'tesseract.js';
import { packPath } from './pack-info';
import { normalize, type Reading } from './vision';

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

  async read(canvas: HTMLCanvasElement, vertical: boolean): Promise<Reading[]> {
    if (this.closed) throw new Error('OCR stopped.');
    if (!this.ocr || this.vertical !== vertical) {
      await this.ocr?.terminate();
      const started = createWorker(vertical ? 'jpn_vert' : 'jpn', OEM.LSTM_ONLY, {
        workerPath: packPath + 'runtime/worker.min.js', workerBlobURL: false,
        corePath: packPath + 'runtime/tesseract-core-lstm.wasm.js',
        langPath: packPath + 'ocr', cacheMethod: 'none', gzip: false,
      });
      try {
        this.ocr = await deadline(started, 'Japanese OCR initialization timed out.');
      } catch (error) {
        void started.then(worker => worker.terminate(), () => {});
        throw error;
      }
      if (this.closed) {
        await this.ocr.terminate();
        throw new Error('OCR stopped.');
      }
      this.vertical = vertical;
      await this.ocr.setParameters({ tessedit_pageseg_mode: vertical ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SPARSE_TEXT });
    }
    const { data } = await deadline(this.ocr.recognize(canvas, {}, { blocks: true }), 'Japanese OCR timed out.');
    const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    return lines.map(({ text, bbox }) => ({
      text: normalize(text),
      box: { x: bbox.x0 / canvas.width, y: bbox.y0 / canvas.height,
        w: (bbox.x1 - bbox.x0) / canvas.width, h: (bbox.y1 - bbox.y0) / canvas.height },
    })).filter(line => line.text && line.box.w > 0 && line.box.h > 0).slice(0, 30);
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
      this.translator!.postMessage({ id: ++this.id, text });
    }), 'English translation timed out.');
  }

  async smokeTest() {
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
    const translation = await this.translate(recognized);
    if (!/hello|hi\b|good afternoon/i.test(translation)) throw new Error('Translation failed its Japanese verification sentence.');
    return translation;
  }

  async close() {
    this.closed = true;
    this.translator?.terminate();
    this.pending?.reject(new Error('Translation stopped.'));
    this.pending = undefined;
    await this.ocr?.terminate();
  }
}
