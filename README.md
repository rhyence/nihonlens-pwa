# NihonLens

NihonLens is an installable camera app that reads Japanese, shows English labels near the original text, and converts yen prices using manual PHP or USD rates. Camera frames, recognized text, and inference stay on the device.

## Run the production build locally

```sh
npm ci
npm run build
npm test
npm run preview
```

Use the preview server to test service workers and offline use. A phone needs HTTPS to use the camera. The app asks for the rear camera and processes at most one frame at a time. Freeze pauses inference and preserves the visible overlays. Tap an overlay to inspect the OCR text. Enable **Vertical Japanese** for top-to-bottom text. Enter the amount of PHP or USD received for one yen under Settings.

## Offline pack

Start the download while online. The app validates the exact byte count and SHA-256 of every asset, then runs OCR on horizontal and vertical fixtures and translates the recognized text to English. It repeats integrity and inference checks when the app opens with an installed pack. **Offline Ready** appears only after those checks pass. The app automatically retries transient server or connection errors for each file. Retry interrupted streams or damaged downloads from the pack panel. **Delete pack** frees the model cache. The app requests persistent browser storage when supported, but the browser still controls quota and eviction.

Workbox precaches the app shell separately. Its cache-only route serves model assets and WASM to dedicated workers. Transformers.js disables remote model lookup and runs ONNX Runtime Web locally with one WASM thread and greedy decoding. OCR uses Tesseract.js and LSTM mode. The original Japanese remains visible beneath or beside the overlay.

| Component | Pack contents | License |
| --- | --- | --- |
| [ONNX Community OPUS-MT Japanese → English](https://huggingface.co/onnx-community/opus-mt-ja-en/tree/05470cd69b62aa32e3ee64ccfd41279789ee4b1e), derived from [Helsinki-NLP](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en) | 50,681,158-byte q8 encoder, 182,303,484-byte q8 merged decoder, 5,994,013 bytes of tokenizer and configuration files | CC BY 4.0 per the ONNX model card |
| [Tesseract tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) | 2,471,260-byte `jpn` and 3,037,480-byte `jpn_vert` trained data | Apache 2.0 |
| Browser runtimes | Tesseract.js 6.0.1 worker and core, Transformers.js 3.8.1 and its pinned ONNX Runtime Web WASM runtime | See dependency license files |

The pack is about 271 MB. Vercel serves the app, OCR worker, and WASM runtime from the same origin. The larger weights and tokenizer are distributed from Hugging Face and the OCR data from GitHub on explicit download. These are public asset requests. Inference sends no text or images to either host. This keeps the 182 MB decoder out of Git and the Vercel deployment bundle. If a distribution host is blocked, the download fails visibly and the user can retry when it is reachable. The manifest, content sizes and integrity hashes are in `src/pack-info.ts`.

## Browser tests

```sh
npx playwright install chromium
npm run test:e2e
```

Set `NIHON_LIVE_DOWNLOAD=1` to exercise the real distribution URLs and the offline inference flow. Alternatively, set `NIHON_MODEL_DIR` to a directory with the eight model assets named by their basenames. The test server streams those same binary files, which are checked against the same production hashes. The full test turns off network access before reload, verifies on-device inference, exercises overlays using a deterministic camera frame, and tests corrupted cache recovery. Set `NIHON_BROWSER_CHANNEL=msedge` to use an installed Edge browser.

## Mobile acceptance

Test in iPhone Safari, an installed iPhone PWA, Android Chrome, and an installed Android PWA. On iOS, use Safari’s Share → Add to Home Screen. On Android, use Chrome’s Install app or Add to Home screen menu. Open the installed app before downloading because storage can differ between the browser tab and the installed app.

1. With Wi-Fi on, install and launch the app. Download the pack and wait for **Offline Ready**.
2. Enter manual PHP and USD rates. Enable both currencies. Start the rear camera, scan a horizontal menu and a vertical sign, and verify label placement when rotating or resizing.
3. Freeze, tap an overlay to inspect Japanese, adjust the exchange rate, and check that the displayed price updates on the frozen frame. Turn translation and currency off independently, then resume.
4. Enable Airplane Mode with Wi-Fi off. Close the app or browser fully. Relaunch it, wait for **Offline Ready**, and repeat the camera, OCR, translation and price checks.
5. Delete the pack while offline and restart. The shell and preferences should still open, and the pack panel should require a new download.

The browser can evict models under storage pressure and may stop long downloads when backgrounded. Safari can terminate a tab when the model's working memory exceeds the device's limit. Available storage does not imply enough inference memory. Performance and camera availability vary with device, browser, permission, lighting and layout. The fixtures validate baseline text recognition and inference, while dense menus, low light, mixed reading order and stylized signs still need device testing.
