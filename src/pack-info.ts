const revision = '05470cd69b62aa32e3ee64ccfd41279789ee4b1e';
const model = 'https://huggingface.co/onnx-community/opus-mt-ja-en/resolve/' + revision + '/';
const tess = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/';
export const packVersion = 'marian-05470cd-ocr410-runtime2';
export const runtimeChunkBytes = 1_048_576;
export const packCache = 'nihonlens-pack-' + packVersion;
export const packPath = '/__pack/' + packVersion + '/';

type Asset = { path: string; url: string; bytes: number; sha256: string; type: string; split?: boolean };

function asset(directory: string, source: string, file: string, bytes: number, sha256: string, query = ''): Asset {
  const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' :
    /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream';
  return { path: directory + file, url: source + file + query, bytes, sha256, type };
}
function translation(file: string, bytes: number, digest: string) {
  return asset('marian/', model, file, bytes, digest, '?download=true');
}
function ocr(file: string, bytes: number, digest: string) {
  return asset('ocr/', tess, file, bytes, digest);
}
function runtime(file: string, bytes: number, digest: string) {
  return asset('runtime/', '/runtime/', file, bytes, digest);
}

export const packAssets = [
  translation('config.json', 1393, 'f3d11469e6d6774c930e10fc2ea20f88807357b0906c532d05c3d8379525b154'),
  translation('generation_config.json', 288, 'afac8733c5d188755c782548a71ba17f34b292a1df74d7fd5093e232cc492dd7'),
  translation('tokenizer.json', 5991485, '770ff2855437cf44f1f110550c5a9dca773253a167aeac36076b2073d259aa3b'),
  translation('tokenizer_config.json', 847, '8b77cdb46d1ac4f51b91f916b61a0de788e511fd6de4f89e88a2b6a51d248a68'),
  translation('onnx/encoder_model_quantized.onnx', 50681158, '77c9a8272eebd5ab3101b3784c4c502d425de81a7e51ba135a4e4e44cc3e818b'),
  translation('onnx/decoder_model_merged_quantized.onnx', 182303484, 'b977a99bb4adf3c7f6f8abe55b27c987f856273330f0fe5073c6201465c98ba6'),
  ocr('jpn.traineddata', 2471260, '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d'),
  ocr('jpn_vert.traineddata', 3037480, 'bf1e2640954691797e2dc14f38533e601b59ee37958698ae0f0b81dc6f09c71b'),
  runtime('worker.min.js', 111162, '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842'),
  runtime('tesseract-core-lstm.wasm.js', 3954181, '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687'),
  runtime('ort-wasm-simd-threaded.jsep.mjs', 44484, '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'),
  { ...runtime('ort-wasm-simd-threaded.jsep.wasm', 21596019, 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'), split: true },
];
export const packBytes = packAssets.reduce((sum, asset) => sum + asset.bytes, 0);
