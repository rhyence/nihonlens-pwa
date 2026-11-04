import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { runtimeChunkBytes } from '../src/pack-info.ts';
await mkdir('public/runtime', { recursive: true });
const files = {
  'tesseract.js/dist': ['worker.min.js'],
  'tesseract.js-core': ['tesseract-core-lstm.wasm.js'],
  'onnxruntime-web/dist': [
    'ort-wasm-simd-threaded.jsep.mjs',
  ],
};
for (const [directory, assets] of Object.entries(files)) {
  for (const asset of assets) await copyFile('node_modules/' + directory + '/' + asset, 'public/runtime/' + asset);
}
const wasm = 'ort-wasm-simd-threaded.jsep.wasm';
const binary = await readFile('node_modules/onnxruntime-web/dist/' + wasm);
for (let offset = 0; offset < binary.length; offset += runtimeChunkBytes) {
  const index = offset / runtimeChunkBytes;
  await writeFile('public/runtime/' + wasm + '.' + index + '.bin', gzipSync(binary.subarray(offset, offset + runtimeChunkBytes)));
}
