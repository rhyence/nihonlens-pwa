import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public/runtime', { recursive: true });
const files = {
  'tesseract.js/dist': ['worker.min.js'],
  'tesseract.js-core': ['tesseract-core-lstm.wasm.js'],
  'onnxruntime-web/dist': [
    'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
  ],
};
for (const [directory, assets] of Object.entries(files)) {
  for (const asset of assets) await copyFile('node_modules/' + directory + '/' + asset, 'public/runtime/' + asset);
}
