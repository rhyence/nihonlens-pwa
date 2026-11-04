# NihonLens

NihonLens is an offline Japanese yen price scanner and Philippine peso converter. Start the camera and hold an explicit price such as ¥500 or 500円 in view. The app shows the peso amount after one scan. Tap Freeze to capture a still photo immediately and put the phone down while recognition finishes; Resume returns to live scanning. Live scanning starts at 640 pixels on the longest side and retries at 960 if no prices are found. Frozen photos use 960 pixels for smaller print. Use the manual converter to enter pesos and see the equivalent in yen.

The rate starts at ₱0.40 per ¥1. It is editable, stored on the device, and never fetched from a rates service. Camera frames stay on the device. NihonLens downloads only the Japanese OCR data and its browser runtime, about 7 MB in total. The old pack’s verified OCR files can be reused on upgrade.

## Run locally

```sh
npm ci
npm run build
npm test
npm run preview
```

Camera access requires HTTPS on a phone. For browser tests, install Playwright Chromium or set `NIHON_BROWSER_CHANNEL=msedge` to use installed Edge. Set `NIHON_MODEL_DIR` to a directory with the pinned `jpn.traineddata` or set `NIHON_LIVE_DOWNLOAD=1` to download it from its source. Then run `npm run test:e2e`.

Japanese OCR uses [Tesseract tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) under Apache 2.0. The test checks offline reload, live camera scanning with a deterministic video frame, and rate changes. For a physical-device check, install the app, download the scanner, then reopen in Airplane Mode and point the camera at a clearly printed yen price. Camera permissions, focus, and print quality can affect recognition.
