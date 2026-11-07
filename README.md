# NihonLens

NihonLens is an offline Japanese yen price scanner and Philippine peso converter. Start the camera and hold an explicit price such as ¥500 or 500円 in view. Live prices appear after two matching reads. Tap Freeze to capture a still photo immediately and put the phone down while recognition finishes; Resume returns to live scanning. Live scanning starts at 640 pixels on the longest side and retries at 960 if no prices are found. Frozen photos use 960 pixels for smaller print. Use the manual converter to enter pesos and see the equivalent in yen.

The rate starts at ₱0.40 per ¥1. It is editable, stored on the device, and never fetched from a rates service. Camera frames stay on the device. NihonLens downloads only the Japanese OCR data and its browser runtime, about 7 MB in total. The old pack’s verified OCR files can be reused on upgrade.

The PHP/USD switch applies to both camera prices and manual conversion in either direction. Fresh app loads always select PHP. Both rates are saved independently. The USD default is US$0.0063055360 per ¥1, calculated from CurrencyBeacon's November 4, 2026 quote of US$1 = ¥158.5908 (https://www.currencybeacon.com/rates/USD/JPY). This is an editable offline snapshot, not an automatically refreshed rate.

When the normal scan finds no price, the scanner retries with grayscale contrast enhancement and rotations of ±15° and ±30°. Each live cycle does one recognition pass; frozen scans stop on a result or after its bounded fallback sequence. Resume or Stop discards pending results. Rotated boxes are mapped back to the camera coordinates. These fallbacks can take longer and cannot recover unreadable blur, clipped glare, or strong perspective distortion. The browser test includes a dimmed, 15°-tilted price fixture; outdoor iPhone performance still requires device testing.

Live scanning tries the untouched higher-resolution frame before contrast enhancement to preserve small currency glyphs. It retains up to 120 digit-containing regions instead of truncating the first 30 text regions. Aligned columns with damaged currency symbols receive targeted numeric crop reads, normalized at several sizes to handle both small print and digitally enlarged text. A numeric read must independently agree with the proposed digits. Each frame checks at most 24 candidates, stopping each crop check as soon as it agrees. These extra reads can increase scan time on dense menus.

Ambiguous letter-like suffixes are offered only as possible prices in aligned columns, never silently added as yen. Uncertain results require confirmation and allow correction before adding to the shopping list. Normal scanning excludes bare numbers and isolated unit quantities. If all normal lighting/angle attempts fail, a numbers-only backup looks for separate amounts without requiring a currency glyph. Backup crops must independently confirm the number; correcting extra digits introduced by a size/currency label requires agreement at two crop scales. All backup results require confirmation because quantities and other numbers may resemble prices. This uses the existing offline engine, not a second OCR model or cloud service. More than six detections use outlines and a View prices list to avoid overlapping labels.

To run the private real-photo regressions, set `NIHON_MENU_IMAGE` to the cropped bowl photo, `NIHON_FULL_MENU_IMAGE` to the full-menu photo, and `NIHON_MODEL_DIR` to the OCR model folder. Photos are neither bundled nor uploaded. Tests cover live and frozen recognition, review/edit-to-cart, and enlarged crops of two individual price groups. Some of the smallest full-menu prices are still missed; browser tests do not establish physical iPhone camera performance.

## Shopping list and budget

Tap a camera price overlay to add one item, or use Quick converter / Add item for manual entry. Adding a camera or manually entered price opens the shopping list; uncertain camera prices require confirmation first. Reopen saved items from Shopping list & budget in the menu to rename items, edit unit prices in yen, change quantities, remove entries, and undo the last removal. Separate PHP and USD budgets deduct the current converted list total and restore the balance when items are removed. A negative balance is shown as over budget. Original yen prices, quantities, and budgets are saved locally for offline reload; currency selection still starts on PHP. Conversion rates apply to the whole list, so changing a rate updates the total and balance. Invalid item edits hide the total until corrected. The hamburger menu contains appearance, exchange-rate, offline-scanner, and translator controls. No payments are made.

## Run locally

```sh
npm ci
npm run build
npm test
npm run preview
```

Camera access requires HTTPS on a phone. For browser tests, install Playwright Chromium or set `NIHON_BROWSER_CHANNEL=msedge` to use installed Edge. Set `NIHON_MODEL_DIR` to a directory with the pinned `jpn.traineddata` or set `NIHON_LIVE_DOWNLOAD=1` to download it from its source. Then run `npm run test:e2e`.

Japanese OCR uses [Tesseract tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) under Apache 2.0. The test checks offline reload, live camera scanning with a deterministic video frame, and rate changes. For a physical-device check, install the app, download the scanner, then reopen in Airplane Mode and point the camera at a clearly printed yen price. Camera permissions, focus, and print quality can affect recognition.

The private phone-screenshot regression uses `NIHON_PHONE_IMAGE`. It crops out the app UI, preserves the menu aspect ratio, and checks live and frozen recognition at two input resolutions. An aligned pair with a damaged suffix (such as 480m and 380pg) remains review-only and must pass the independent numeric crop check. This does not prove identical performance from a physical camera.

Service-worker updates activate without waiting for every browser tab to close. An already-open updated client shows Update now on controller changes; returning to the app checks for updates. Reload preserves the locally saved shopping list and OCR pack. The menu shows the scanner build so installed versions can be identified.

Live labels use stronger coordinate smoothing and match the closest overlapping price region. A missing result may be held for one missed scan if it was seen within 2.2 seconds, then is removed. This trades immediate disappearance for less flicker; Stop and Freeze still clear tracking immediately. Compact stacked labels use nearby free vertical slots to avoid covering one another. The latest horizontal-price screenshot regression uses `NIHON_SIDE_IMAGE` and verifies 240/340 in live and frozen views at two resolutions.

Frozen scans now complete a second page-layout pass plus a contrast pass for initially unrotated frames and verify each candidate row at two distinct crop sizes before finishing. Horizontal amounts use OCR word boundaries and adjacent currency glyphs rather than character-count estimates. Disagreeing values at the same region are excluded. Live scanning alternates original resolutions and contrast passes even after a partial result, and continues while the detected-price list is open. Existing labels require two consecutive conflicting reads before changing amount. The normal crop check cannot invent a different amount; the separately marked numeric backup still requires two matching crop reads to correct a damaged numeric candidate.

These passes remain bounded to 24 candidate crops and cannot guarantee every menu price. They may take longer than the previous early-stop scan, and the stricter checks may suppress a readable but inconsistent row. Physical iPhone focus, memory, and latency remain unverified. Browser regressions cover the private stacked/horizontal photos and the dim/rotated fixture, and reject the observed erroneous 8540 result.

Camera controls live inside the preview: the centered camera icon starts scanning (or opens setup if the scanner is not installed), the bottom circular shutter freezes the frame and changes to a resume icon, and the top-right X stops the camera. There is no persistent controls row or shopping-list dock below the preview. The shopping dialog does not open just from detecting prices.

Colored-text fallback: when normal scans and the original numeric backup find no prices, a bounded local-contrast pass uses the darkest RGB channel and nearby brightness to reveal ink under uneven lighting. Its damaged currency prefixes and numeric candidates still require crop verification and price confirmation; frozen reads require two distinct crop sizes. The private red-menu screenshot test (`NIHON_RED_MENU_IMAGE`) checks only 500/250 at two resolutions, live and frozen. It cannot restore detail hidden by clipped glare or blur, and adds processing time when earlier passes fail.
