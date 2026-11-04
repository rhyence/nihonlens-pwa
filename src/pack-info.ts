const tess = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/';
// Keep the cache key so existing installs can reuse their verified OCR files.
export const packVersion = 'marian-xenova-1a906cf-ocr410-runtime2';
export const packCache = 'nihonlens-pack-' + packVersion;
export const packPath = '/__pack/' + packVersion + '/';

type Asset = { path: string; url: string; bytes: number; sha256: string; type: string };

function asset(directory: string, source: string, file: string, bytes: number, sha256: string, query = ''): Asset {
  const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' :
    /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream';
  return { path: directory + file, url: source + file + query, bytes, sha256, type };
}
function ocr(file: string, bytes: number, digest: string) {
  return asset('ocr/', tess, file, bytes, digest);
}
function runtime(file: string, bytes: number, digest: string) {
  return asset('runtime/', '/runtime/', file, bytes, digest);
}

export const packAssets = [
  ocr('jpn.traineddata', 2471260, '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d'),
  runtime('worker.min.js', 111162, '38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842'),
  runtime('tesseract-core-lstm.wasm.js', 3954181, '775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687'),
];
export const packBytes = packAssets.reduce((sum, asset) => sum + asset.bytes, 0);
