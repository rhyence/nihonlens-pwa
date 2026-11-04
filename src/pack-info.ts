const revision = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';
const model = 'https://huggingface.co/Xenova/opus-mt-ja-en/resolve/' + revision + '/';
const tess = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/';
export const packVersion = 'marian-xenova-1a906cf-ocr410-runtime2';
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
  translation('config.json', 1376, 'd35476f1d3858883feec67e5a63ddc387452a70fda9c8e26db99c71aa2ad6a34'),
  translation('generation_config.json', 293, 'ed1bc2193210ca2a6dc9c144ea789936fed8a27113e01010d8e591f45f238912'),
  translation('tokenizer.json', 5991485, '770ff2855437cf44f1f110550c5a9dca773253a167aeac36076b2073d259aa3b'),
  translation('tokenizer_config.json', 280, '414e9e7e2492b95fa80f24ccb295645d35c4dd0a74d7ef8b89820c0c7e8ec356'),
  translation('onnx/encoder_model_quantized.onnx', 50705822, '345262b16bcdda1468b0f3380c112b7ce79f731176b4b1d21f6edd5b2ae0d25c'),
  translation('onnx/decoder_model_merged_quantized.onnx', 58001744, 'b304d0014e4e1575437b6af95467b6cb54405d923732d8359113bd6dbbee93c0'),
  ocr('jpn.traineddata', 2471260, '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d'),
  ocr('jpn_vert.traineddata', 3037480, 'bf1e2640954691797e2dc14f38533e601b59ee37958698ae0f0b81dc6f09c71b'),
  runtime('worker.min.js', 111162, '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842'),
  runtime('tesseract-core-lstm.wasm.js', 3954181, '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687'),
  runtime('ort-wasm-simd-threaded.jsep.mjs', 44484, '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'),
  { ...runtime('ort-wasm-simd-threaded.jsep.wasm', 21596019, 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'), split: true },
];
export const packBytes = packAssets.reduce((sum, asset) => sum + asset.bytes, 0);
