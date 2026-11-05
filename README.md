# NihonLens

NihonLens is an offline Japanese yen price scanner and Philippine peso converter. Start the camera and hold an explicit price such as ¥500 or 500円 in view. The app shows the peso amount after one scan. Tap Freeze to capture a still photo immediately and put the phone down while recognition finishes; Resume returns to live scanning. Live scanning starts at 640 pixels on the longest side and retries at 960 if no prices are found. Frozen photos use 960 pixels for smaller print. Use the manual converter to enter pesos and see the equivalent in yen.

The rate starts at ₱0.40 per ¥1. It is editable, stored on the device, and never fetched from a rates service. Camera frames stay on the device. NihonLens downloads only the Japanese OCR data and its browser runtime, about 7 MB in total. The old pack’s verified OCR files can be reused on upgrade.

The PHP/USD switch applies to both camera prices and manual conversion in either direction. Fresh app loads always select PHP. Both rates are saved independently. The USD default is US$0.0063055360 per ¥1, calculated from CurrencyBeacon's November 4, 2026 quote of US$1 = ¥158.5908 (https://www.currencybeacon.com/rates/USD/JPY). This is an editable offline snapshot, not an automatically refreshed rate.

When the normal scan finds no price, the scanner retries with grayscale contrast enhancement and rotations of ±15° and ±30°. Each live cycle does one recognition pass; frozen scans stop on a result or after six attempts. Resume or Stop discards pending results. Rotated boxes are mapped back to the camera coordinates. These fallbacks can take longer and cannot recover unreadable blur, clipped glare, or strong perspective distortion. The browser test includes a dimmed, 15°-tilted price fixture; outdoor iPhone performance still requires device testing.

Live scanning tries the untouched higher-resolution frame before contrast enhancement to preserve small currency glyphs. Confident, aligned price columns with 円 misread as ロ/口 are checked using enlarged individual crops; a second digits-focused read must agree before those amounts appear. Bare numbers or gram quantities are not treated as yen. Each frame verifies at most six ambiguous candidates. To run the real-menu regression locally, set `NIHON_MENU_IMAGE` to the supplied photo and `NIHON_MODEL_DIR` to the OCR model folder. The private photo is not bundled or uploaded with the app; the test checks ¥480, ¥580, and ¥380 in live and frozen modes, plus tap-to-cart behavior.

## Shopping list and budget

Tap a camera price overlay to add one item, or use Quick converter / Add item for manual entry. Open the bottom shopping bar to rename items, edit unit prices in yen, change quantities, remove entries, and undo the last removal. Separate PHP and USD budgets deduct the current converted list total and restore the balance when items are removed. A negative balance is shown as over budget. Original yen prices, quantities, and budgets are saved locally for offline reload; currency selection still starts on PHP. Conversion rates apply to the whole list, so changing a rate updates the total and balance. Invalid item edits hide the total until corrected. The hamburger menu contains appearance, exchange-rate, offline-scanner, and translator controls. No payments are made.

## Run locally

```sh
npm ci
npm run build
npm test
npm run preview
```

Camera access requires HTTPS on a phone. For browser tests, install Playwright Chromium or set `NIHON_BROWSER_CHANNEL=msedge` to use installed Edge. Set `NIHON_MODEL_DIR` to a directory with the pinned `jpn.traineddata` or set `NIHON_LIVE_DOWNLOAD=1` to download it from its source. Then run `npm run test:e2e`.

Japanese OCR uses [Tesseract tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) under Apache 2.0. The test checks offline reload, live camera scanning with a deterministic video frame, and rate changes. For a physical-device check, install the app, download the scanner, then reopen in Airplane Mode and point the camera at a clearly printed yen price. Camera permissions, focus, and print quality can affect recognition.
