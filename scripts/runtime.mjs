import { copyFile, mkdir, readdir, unlink } from 'node:fs/promises';
await mkdir('public/runtime', { recursive: true });
for (const name of await readdir('public/runtime')) {
  if (/^ort-wasm-simd-threaded\./.test(name)) await unlink('public/runtime/' + name);
}
await copyFile('node_modules/tesseract.js/dist/worker.min.js', 'public/runtime/worker.min.js');
await copyFile('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'public/runtime/tesseract-core-lstm.wasm.js');
