import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Engines } from './engines';
import { scanAngles } from './image';
import { controlled, downloadPack, removePack, verifyInstalled } from './pack';
import { packBytes } from './pack-info';
import { convert, fill, placeLabel, mergePriceRows, FrameGate, pesosToYen, Tracker, yen, yenReadings, type Track, type Box } from './vision';
import { loadSettings, saveSettings, type Settings } from './settings';
import { cartTotal, convertedCents, formatCents, formatShopping, itemTotal, loadShopping, parseCents, shoppingKey, type Item } from './shopping';
import './style.css';

function App({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [shopping, setShopping] = useState(loadShopping);
  const [notice, setNotice] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const [exportNotice, setExportNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  const [reviewPrice, setReviewPrice] = useState('');
  const [labelMeasure] = useState(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `750 16px ${getComputedStyle(document.documentElement).fontFamily}`;
    return context;
  });
  const [removed, setRemoved] = useState<Item | undefined>();
  const [foreignAmount, setForeignAmount] = useState('');
  const [currency, setCurrency] = useState<'PHP' | 'USD'>('PHP');
  const [yenAmount, setYenAmount] = useState('');
  const [direction, setDirection] = useState<'JPY' | 'local'>('JPY');
  const [status, setStatus] = useState('Checking offline scanner…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [source, setSource] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const premium = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const cart = useRef<HTMLDialogElement>(null);
  const review = useRef<HTMLDialogElement>(null);
  const detected = useRef<HTMLDialogElement>(null);
  const converter = useRef<HTMLDialogElement>(null);
  const menuClosing = useRef(false);
  const still = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const engine = useRef<Engines | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const gate = useRef(new FrameGate());
  const tracker = useRef(new Tracker());

  async function closeMenu(next?: () => void) {
    const drawer = menu.current;
    if (!drawer?.open || menuClosing.current) return;
    menuClosing.current = true;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await drawer.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(100%)', opacity: 0 }],
        { duration: 180, easing: 'ease-in' }).finished.catch(() => {});
    }
    drawer.close();
    menuClosing.current = false;
    next?.();
  }

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let controlled = !!navigator.serviceWorker.controller;
    const changed = () => {
      if (controlled) setUpdateReady(true);
      controlled = true;
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(shoppingKey, JSON.stringify(shopping)); }
    catch { setError('Could not save your shopping list. Keep this page open to retain it.'); }
  }, [shopping]);

  function addItem(price: string) {
    if (!/^\d{1,12}$/.test(price) || shopping.items.length >= 200) {
      setNotice('Enter a whole yen price. Lists can hold up to 200 items.');
      return;
    }
    const item = { id: crypto.randomUUID(), name: `Item ${shopping.items.length + 1}`, price, quantity: '1' };
    setShopping(previous => ({ ...previous, items: [...previous.items, item] }));
    setNotice(`Added ¥${BigInt(price).toLocaleString('en-US')} to your list.`);
    return true;
  }

  function addAndOpenList(price: string) {
    if (!addItem(price)) return;
    review.current?.close();
    converter.current?.close();
    detected.current?.close();
    cart.current?.showModal();
  }

  function editItem(id: string, changes: Partial<Item>) {
    setShopping(previous => ({ ...previous, items: previous.items.map(item => item.id === id ? { ...item, ...changes } : item) }));
  }

  async function prepare(download: boolean) {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setReady(false);
    setError('');
    setTracks([]);
    tracker.current.clear();
    gate.current.invalidate();
    try {
      await engine.current?.close();
      engine.current = undefined;
      if (download) {
        void navigator.storage?.persist?.().catch(() => false);
        await downloadPack(setStatus, controller.signal);
      } else if (!(await verifyInstalled(controller.signal))) {
        setStatus('Download the offline scanner to use your camera.');
        return;
      }
      await controlled();
      setStatus('Verifying offline text recognition…');
      const next = new Engines();
      engine.current = next;
      await next.smokeTest();
      controller.signal.throwIfAborted();
      setReady(true);
      setStatus('Offline scanner ready');
    } catch (failure) {
      await engine.current?.close();
      engine.current = undefined;
      setStatus(controller.signal.aborted ? 'Download canceled.' : 'Scanner unavailable. Verify or download it again.');
      if (!controller.signal.aborted) setError(String(failure));
    } finally {
      abort.current = undefined;
      setBusy(false);
    }
  }

  function stopCamera() {
    gate.current.invalidate();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = undefined;
    if (video.current) video.current.srcObject = null;
    tracker.current.clear();
    setTracks([]);
    setCamera(false);
    setFrozen(false);
    setScanning(false);
    setScanned(false);
    setScanAttempt(0);
  }

  function toggleFreeze() {
    const frame = video.current;
    if (!frame?.videoWidth || !still.current) return;
    gate.current.invalidate();
    tracker.current.clear();
    setTracks([]);
    setScanned(false);
    setScanAttempt(0);
    if (!frozen) {
      const scale = Math.min(1, 960 / Math.max(frame.videoWidth, frame.videoHeight));
      still.current.width = Math.round(frame.videoWidth * scale);
      still.current.height = Math.round(frame.videoHeight * scale);
      still.current.getContext('2d')!.drawImage(frame, 0, 0, still.current.width, still.current.height);
      frame.pause();
    } else {
      void frame.play().catch(() => stopCamera());
    }
    setFrozen(!frozen);
  }

  async function startCamera() {
    setError('');
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS.');
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.current!.srcObject = stream.current;
      await video.current!.play();
      setCamera(true);
    } catch (failure) {
      stopCamera();
      setError('Camera unavailable. Check camera permission. ' + String(failure));
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    void prepare(false);
    const observer = new ResizeObserver(([entry]) => setView({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(preview.current!);
    window.addEventListener('pagehide', stopCamera);
    return () => {
      window.removeEventListener('pagehide', stopCamera);
      observer.disconnect();
      stream.current?.getTracks().forEach(track => track.stop());
      abort.current?.abort();
      void engine.current?.close();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'dark' ? '#101a17' : '#f4f6f2');
    if (settings !== initialSettings) void saveSettings(settings).catch(() => setError('Could not save your preferences.'));
  }, [settings, initialSettings]);

  useEffect(() => {
    if (!camera || !ready) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const frameGate = gate.current;
    let active = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const scan = async () => {
      const frame = video.current;
      const ocr = engine.current;
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]:not([aria-labelledby=detected-title])') && frame?.videoWidth &&
          frame.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && ocr) {
        const image = frozen ? still.current! : frame;
        const w = frozen ? still.current!.width : frame.videoWidth;
        const h = frozen ? still.current!.height : frame.videoHeight;
        const scale = Math.min(1, (frozen || attempt > 0 ? 960 : 640) / Math.max(w, h));
        let completed = false;
        try {
          await frameGate.run(async () => {
            if (active) setScanning(true);
            setScanAttempt(attempt);
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const initial = yenReadings(await ocr.read(canvas, attempt));
            if (!frozen || (!initial.length && attempt !== scanAngles.length - 1)) return initial;
            // Finish the whole candidate list using a second layout and row crops,
            // even when the initial pass has already found one or more prices.
            setScanAttempt(scanAngles.length);
            const rows = yenReadings(await ocr.read(canvas, attempt, true));
            if (attempt > 1) return rows;
            const contrastRows = yenReadings(await ocr.read(canvas, 2, true));
            return mergePriceRows(rows, contrastRows);
          }, readings => {
            completed = readings.length > 0 || attempt === scanAngles.length - 1;
            if (!readings.length) attempt = frozen && attempt === 0 ? 2 : (attempt + 1) % scanAngles.length;
            else if (!frozen) attempt = attempt === 7 && readings.some(reading => reading.uncertain) ? 7 : (attempt + 1) % 3;
            setSource({ w, h });
            setTracks(tracker.current.update(readings, performance.now(), frozen ? 1 : 2));
            setScanning(false);
            setScanned(completed);
          });
        } catch (failure) {
          stopCamera();
          setReady(false);
          setStatus('Scanner stopped. Verify it to try again.');
          setError(String(failure));
        }
        if (frozen && completed) return;
      }
      if (active) timer = setTimeout(scan, 150);
    };
    const visibility = () => {
      if (frozen) return;
      frameGate.invalidate();
      tracker.current.clear();
      setTracks([]);
    };
    document.addEventListener('visibilitychange', visibility);
    void scan();
    return () => {
      active = false;
      frameGate.invalidate();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [camera, ready, frozen]);

  const rate = currency === 'PHP' ? settings.php : settings.usd;
  const symbol = currency === 'PHP' ? '₱' : 'US$';
  const currencyName = currency === 'PHP' ? 'Pesos' : 'Dollars';
  const currencyLabel = currency === 'PHP' ? 'Philippine pesos' : 'US dollars';
  const totalYen = cartTotal(shopping.items);
  const totalCents = totalYen === undefined ? undefined : convertedCents(totalYen, rate);
  const budget = shopping.budgets[currency];
  const budgetCents = parseCents(budget);
  const remaining = budgetCents !== undefined && totalCents !== undefined ? budgetCents - totalCents : undefined;
  const totalLabel = totalCents === undefined ? 'Check prices / rate' : formatCents(totalCents, symbol);
  const exportText = formatShopping(shopping, currency, rate);

  async function copyList() {
    if (exportText === undefined) return;
    try {
      await navigator.clipboard.writeText(exportText);
      setCopyFallback(false);
      setExportNotice('Formatted list copied. Paste it into Notes or a message.');
    } catch {
      setCopyFallback(true);
      setExportNotice('Copy is unavailable here. Select the text below to copy it, or save a text file.');
    }
  }

  function saveList() {
    if (exportText === undefined) return;
    const url = URL.createObjectURL(new Blob([exportText], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'nihonlens-shopping-list.txt';
    cart.current?.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNotice('Text file prepared. Use your browser’s download or save options.');
  }
  const validRate = /^\d{0,8}(?:\.\d{1,10})?$/.test(rate) && Number(rate) > 0;
  const manual = pesosToYen(foreignAmount, rate);
  const manualPesos = validRate && /^\d{1,12}$/.test(yenAmount)
    ? convert(BigInt(yenAmount), rate, currency)?.replace(currency + ' ', symbol) : undefined;
  function display(track: Track) {
    const amount = yen(track.text);
    return amount === undefined || !validRate ? undefined : convert(amount, rate, currency)?.replace(currency + ' ', symbol);
  }

  function choosePrice(track: Track) {
    const amount = yen(track.text);
    if (amount === undefined) return;
    detected.current?.close();
    if (track.uncertain) { setReviewPrice(String(amount)); review.current?.showModal(); }
    else addAndOpenList(String(amount));
  }

  const placedLabels: Box[] = [];
  return <main>
    {updateReady && <div className="update-banner" role="status">Scanner update ready <button onClick={() => { stopCamera(); window.location.reload(); }}>Update now</button></div>}
    <header className="app-header compact-header"><span className="brand-mark" aria-label="NihonLens">¥</span><button className="menu-toggle" aria-label="Open menu" onClick={() => menu.current?.showModal()}>☰</button></header>
    <div className="currency-picker" role="group" aria-label="Display currency"><span>Convert prices to</span><div><button aria-pressed={currency === 'PHP'} onClick={() => { setCurrency('PHP'); setForeignAmount(''); }}>₱ PHP</button><button aria-pressed={currency === 'USD'} onClick={() => { setCurrency('USD'); setForeignAmount(''); }}>US$ USD</button></div></div>
    <div className="camera-card">
    <section className="view" ref={preview} aria-label="Camera preview">
      <video ref={video} muted playsInline />
      <canvas ref={still} className="frozen-preview" style={{ display: frozen ? 'block' : 'none', objectFit: 'cover' }} aria-label="Frozen camera frame" />
      <div className="camera-badge"><span className={camera && !frozen ? 'live-dot' : ''} />{frozen ? 'FROZEN FRAME' : camera ? 'LIVE CAMERA' : 'PRICE SCANNER'}</div>
      {camera && tracks.length > 0 && <button className="detected-button" onClick={() => detected.current?.showModal()}>View {tracks.length} prices</button>}
      {!camera && <button className="camera-start" aria-label={ready ? 'Start camera' : 'Set up camera'} title={ready ? 'Start camera' : 'Set up camera'} disabled={starting || busy} onClick={() => ready ? void startCamera() : menu.current?.showModal()}>
        <svg viewBox="0 0 32 32" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M11 7l2-3h6l2 3h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="16" cy="17" r="6"/></svg>
      </button>}
      {camera && <>
        <button className="camera-stop" aria-label="Stop camera" title="Stop camera" onClick={stopCamera}>×</button>
        <div className="shutter-bar"><button className={`camera-shutter${frozen ? ' is-frozen' : ''}`} aria-label={frozen ? 'Resume' : 'Freeze'} title={frozen ? 'Resume scanning' : 'Freeze frame'} onClick={toggleFreeze}>
          {frozen && <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M8 4v16l12-8z"/></svg>}
        </button></div>
      </>}
      {camera && view.w > 8 && source.w > 0 && [...tracks].sort((a, b) => a.box.y - b.box.y).map(track => {
        const price = display(track);
        const box = fill(track.box, source.w, source.h, view.w, view.h);
        if (!price || box.x + box.w < 0 || box.y + box.h < 0 || box.x > view.w || box.y > view.h) return null;
        if (tracks.length > 6) return <span key={track.id} className="detected-box" aria-hidden="true" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />;
        const width = Math.min(Math.ceil(labelMeasure.measureText(price).width) + 18, view.w - 8);
        const left = Math.max(4, Math.min(view.w - width - 4, box.x + box.w / 2 - width / 2));
        const placement = placeLabel({ x: left, y: box.y, w: width, h: 34 }, placedLabels, view.h - 112);
        if (!placement) return null;
        placedLabels.push(placement);
        const top = placement.y;
        return <button className="overlay price" key={track.id} style={{ width, left, top }} aria-label={track.uncertain ? `Review possible ${track.text} price` : `Add ${track.text} to shopping list`} onClick={() => choosePrice(track)}>{price}</button>;
      })}
      {camera && <p className="scan-status camera-progress" aria-live="polite">{camera ? frozen ? (scanned ? (tracks.length ? 'Frozen prices ready. You can put your phone down.' : 'No yen price found. Try moving closer, facing the sign, or avoiding glare.') : (scanAttempt === scanAngles.length ? 'Checking each price row… You can put your phone down.' : scanAttempt === 7 ? 'Trying backup number scan… You can put your phone down.' : scanAttempt > 0 ? 'Checking lighting and angles… You can put your phone down.' : 'Scanning frozen photo… You can put your phone down.')) : tracks.length ? 'Yen prices found' : scanning ? 'Scanning prices… Tap Freeze to hold this view.' : 'Point at a yen price. Freeze anytime to scan a still photo.' : ready ? 'Ready when you are. Start your camera to scan.' : busy ? 'Getting your scanner ready…' : 'Download the scanner below to get started.'}</p>}
    </section>


    </div>
    <div className="scan-shortcuts"><button onClick={() => converter.current?.showModal()}>Quick converter</button>{!ready && <button onClick={() => menu.current?.showModal()}>Set up scanner</button>}</div>
    <span className="screen-reader-only" aria-live="polite">{notice}</span>
    <dialog ref={detected} className="sheet" aria-labelledby="detected-title">
      <div className="sheet-heading"><h2 id="detected-title">Detected prices</h2><button aria-label="Close detected prices" onClick={() => detected.current?.close()}>×</button></div>
      <p>Check the printed price before adding. Uncertain prices ask for confirmation before adding.</p>
      <div className="detected-list">{tracks.map(track => <button key={track.id} className={track.uncertain ? 'possible-row' : ''} aria-label={track.uncertain ? `Review possible ${track.text} price` : `Add ${track.text} to shopping list`} onClick={() => choosePrice(track)}><strong>{track.text} → {display(track) ?? 'Check rate'}</strong><small>{track.uncertain ? 'Review price' : 'Add to shopping list'}</small></button>)}</div>
    </dialog>
    <dialog ref={review} className="sheet" aria-labelledby="review-title">
      <div className="sheet-heading"><h2 id="review-title">Check this price</h2><button aria-label="Close price review" onClick={() => review.current?.close()}>×</button></div>
      <p>Confirm this number is a yen price, then correct it if needed. The scanner could not reliably read the currency symbol.</p>
      <label className="amount-label">Price in yen<span className="amount-field"><span aria-hidden="true">¥</span><input aria-label="Price in yen" inputMode="numeric" maxLength={12} value={reviewPrice} onChange={event => setReviewPrice(event.target.value)} /></span></label>
      <button className="primary" disabled={!/^\d{1,12}$/.test(reviewPrice)} onClick={() => addAndOpenList(reviewPrice)}>Confirm and add</button>
    </dialog>
    <dialog ref={converter} className="sheet" aria-labelledby="converter-title">
      <div className="sheet-heading"><h2 id="converter-title">Quick converter</h2><button aria-label="Close converter" onClick={() => converter.current?.close()}>×</button></div>
    <section className="panel converter" aria-label="Manual converter">
      <div className="section-heading"><h2>Quick convert</h2><span>Type a price</span></div>
      <div className="direction-switch" aria-label="Conversion direction"><button aria-pressed={direction === 'JPY'} onClick={() => setDirection('JPY')}>Yen → {currencyName}</button><button aria-pressed={direction === 'local'} onClick={() => setDirection('local')}>{currencyName} → Yen</button></div>
      {direction === 'JPY' ? <><label className="amount-label">Amount in JPY <span className="amount-field"><span aria-hidden="true">¥</span><input inputMode="numeric" maxLength={12} value={yenAmount} onChange={event => setYenAmount(event.target.value)} placeholder="0" /></span></label>
      {yenAmount && !/^\d{1,12}$/.test(yenAmount) && <small>Enter a whole yen amount using digits only.</small>}
      <div className="conversion-result"><span>In {currencyLabel}</span><output aria-label={currency === 'PHP' ? 'Amount in pesos' : 'Amount in dollars'} aria-live="polite">{manualPesos ?? symbol + '—'}</output></div></> : <><label className="amount-label">Amount in {currency} <span className="amount-field"><span aria-hidden="true">{symbol}</span><input inputMode="decimal" maxLength={15} value={foreignAmount} onChange={event => setForeignAmount(event.target.value)} placeholder="0.00" /></span></label>
      <div className="conversion-result"><span>In Japanese yen</span><output aria-label="Amount in yen" aria-live="polite">{manual ?? '¥—'}</output></div></>}
      <small className="rate-note">{validRate ? `¥1 = ${symbol}${rate} · Your saved rate` : 'Set a positive exchange rate below to convert.'}</small>
      {direction === 'JPY' && /^\d{1,12}$/.test(yenAmount) && <button className="primary" onClick={() => addAndOpenList(yenAmount)}>Add to shopping list</button>}
    </section>
    <p className="cart-notice" aria-live="polite">{notice}</p>
    </dialog>
    <dialog ref={premium} className="premium-dialog" aria-labelledby="premium-title" aria-describedby="premium-description">
      <button className="premium-close" aria-label="Close premium popup" onClick={() => premium.current?.close()}>×</button>
      <span className="premium-tag">NIHONLENS PREMIUM</span>
      <h2 id="premium-title">Lost in translation?</h2>
      <p id="premium-description">Japanese text to English translation is a premium feature.</p>
      <p className="premium-price">₱999<span> / month</span></p>
      <p>Unlock a whole new world of understanding.</p>
      <small className="prank-note">It’s a prank. No payments are collected.</small>
    </dialog>
    {error && <p role="alert">{error}</p>}
    <dialog ref={menu} className="sheet menu-sheet" aria-labelledby="menu-title" onCancel={event => { event.preventDefault(); void closeMenu(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) void closeMenu();
    }}>
      <div className="sheet-heading"><h2 id="menu-title">Menu & settings</h2><button aria-label="Close menu" onClick={() => void closeMenu()}>×</button></div>
      <nav className="menu-links" aria-label="App tools"><button aria-label="Open shopping list" onClick={() => void closeMenu(() => cart.current?.showModal())}>Shopping list & budget <span className="shopping-count">{shopping.items.length} {shopping.items.length === 1 ? 'item' : 'items'}</span></button><button onClick={() => void closeMenu(() => converter.current?.showModal())}>Quick converter</button></nav>
      <p className="build-version">Scanner build 2026.11.06.2</p>
      <div className="theme-setting"><span>Appearance</span><button className="theme-toggle" aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setSettings(previous => ({ ...previous, theme: previous.theme === 'dark' ? 'light' : 'dark' }))}>{settings.theme === 'dark' ? '☀️' : '🌙'}</button></div>
    <details className="panel disclosure">
      <summary>Exchange rate <span>{validRate ? `¥1 = ${symbol}${rate}` : 'Needs attention'}</span></summary>
      <div className="settings">
      <label>{currency} per JPY <input inputMode="decimal" value={rate} onChange={event => setSettings(previous => ({ ...previous, [currency === 'PHP' ? 'php' : 'usd']: event.target.value }))} /></label>
      <small>{validRate ? 'This is a manual rate. Edit it whenever you need to.' : `Enter a positive ${currency} amount for ¥1.`}</small>
      {currency === 'USD' && <small>USD default checked 4 Nov 2026: US$1 = ¥158.5908. <a href="https://www.currencybeacon.com/rates/USD/JPY" target="_blank" rel="noreferrer">Rate source</a>. Saved for offline use; not a live rate.</small>}
      </div>
    </details>
    <details className="panel disclosure" open={!ready}>
      <summary>Offline scanner <span>{ready ? 'Ready' : busy ? 'Preparing' : 'Set up'}</span></summary>
      <div className="settings">
      <p className="pack-status" role="status">{status}</p>
      <small>About {Math.ceil(packBytes / 1e6)} MB. Camera frames stay on your device.</small>
      <div className="row">
        {!ready && <button disabled={busy} onClick={() => void prepare(true)}>Download scanner</button>}
        <button disabled={busy} onClick={() => void prepare(false)}>Verify scanner</button>
        {busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
        {ready && <button onClick={async () => {
          stopCamera();
          setReady(false);
          try {
            await engine.current?.close();
            engine.current = undefined;
            await removePack();
            setStatus('Offline scanner deleted.');
          } catch (failure) {
            setError(String(failure));
            setStatus('Could not delete the offline scanner.');
          }
        }}>Delete scanner</button>}
      </div>
      </div>
    </details>
    <button className="translator-button" onClick={() => void closeMenu(() => premium.current?.showModal())}><span>Japanese text → English translator</span><span className="premium-tag">PREMIUM</span></button>
    </dialog>

    <dialog ref={cart} className="sheet cart-sheet" aria-labelledby="cart-title">
      <div className="sheet-heading"><div><h2 id="cart-title">Shopping list</h2><small>Saved on this device</small></div><button aria-label="Close shopping list" onClick={() => cart.current?.close()}>×</button></div>
      <div className="export-actions"><button disabled={exportText === undefined} onClick={() => void copyList()}>Copy list</button><button disabled={exportText === undefined} onClick={saveList}>Save .txt</button></div>
      {exportText === undefined && <small>Correct item prices, quantities, rate, or budget before exporting.</small>}
      <p className="export-notice" aria-live="polite">{exportNotice}</p>
      {copyFallback && <textarea className="copy-preview" aria-label="Formatted shopping list" readOnly value={exportText ?? ''} onFocus={event => event.currentTarget.select()} />}
      <section className="budget-card" aria-label="Shopping total and budget">
        <div className="cart-total"><span>Estimated total ({currency})</span><strong aria-label="Shopping total">{totalLabel}</strong><small>{totalYen === undefined ? 'Finish editing the item prices and quantities.' : `¥${totalYen.toLocaleString('en-US')} in total · Converted at your saved rate`}</small></div>
        <label>Budget in {currency}<input aria-label={`Budget in ${currency}`} inputMode="decimal" placeholder="Set a budget" maxLength={15} value={budget} onChange={event => setShopping(previous => ({ ...previous, budgets: { ...previous.budgets, [currency]: event.target.value } }))} /></label>
        {budget && budgetCents === undefined && <small>Enter a positive amount with up to two decimal places.</small>}
        {remaining !== undefined && <p className={remaining < 0n ? 'over-budget' : 'budget-remaining'} aria-live="polite">{remaining < 0n ? 'Over budget: ' : 'Remaining: '}{formatCents(remaining < 0n ? -remaining : remaining, symbol)}</p>}
        <small>Adding items deducts from this balance. Removing them restores it. PHP and USD budgets are saved separately.</small>
      </section>
      <div className="section-heading"><h3>{shopping.items.length} {shopping.items.length === 1 ? 'item' : 'items'}</h3><button disabled={shopping.items.length >= 200} onClick={() => addItem('0')}>+ Add item</button></div>
      {!shopping.items.length && <p className="empty-cart">Your list is empty. Tap a camera price or add an item manually.</p>}
      <div className="cart-items">{shopping.items.map((item, index) => {
        const amount = itemTotal(item);
        const cents = amount === undefined ? undefined : convertedCents(amount, rate);
        return <section className="cart-item" key={item.id} aria-label={`Shopping item ${index + 1}`}>
          <label className="item-name">Name<input aria-label={`Item ${index + 1} name`} maxLength={80} value={item.name} onChange={event => editItem(item.id, { name: event.target.value })} /></label>
          <div className="item-fields"><label>Unit price (¥)<input aria-label={`Item ${index + 1} yen price`} inputMode="numeric" maxLength={12} value={item.price} onChange={event => editItem(item.id, { price: event.target.value })} /></label><label>Quantity<input aria-label={`Item ${index + 1} quantity`} inputMode="numeric" maxLength={4} value={item.quantity} onChange={event => editItem(item.id, { quantity: event.target.value })} /></label></div>
          {amount === undefined && <small>Enter a whole yen price and quantity from 1 to 9999.</small>}
          <div className="item-actions"><strong>{cents === undefined ? 'Check item / rate' : formatCents(cents, symbol)}</strong><button aria-label={`Remove item ${index + 1}`} onClick={() => { setRemoved(item); setShopping(previous => ({ ...previous, items: previous.items.filter(entry => entry.id !== item.id) })); }}>Remove</button></div>
        </section>;
      })}</div>
      {removed && <button className="undo-remove" onClick={() => { if (shopping.items.length < 200) { setShopping(previous => ({ ...previous, items: [...previous.items, removed] })); setRemoved(undefined); } }}>Undo removal of {removed.name || 'item'}</button>}
      <small>OCR can misread prices. Check your list before buying. Totals are estimates, not payments.</small>
    </dialog>
  </main>;
}

void loadSettings().then(initialSettings =>
  createRoot(document.getElementById('root')!).render(<App initialSettings={initialSettings} />));
