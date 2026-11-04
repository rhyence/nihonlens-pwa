import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Engines } from './engines';
import { controlled, downloadPack, removePack, verifyInstalled } from './pack';
import { packBytes } from './pack-info';
import { convert, fill, FrameGate, pesosToYen, Tracker, yen, yenReadings, type Track } from './vision';
import { loadSettings, saveSettings, type Settings } from './settings';
import './style.css';

function App({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [pesos, setPesos] = useState('');
  const [yenAmount, setYenAmount] = useState('');
  const [direction, setDirection] = useState<'JPY' | 'PHP'>('JPY');
  const [status, setStatus] = useState('Checking offline scanner…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [source, setSource] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const engine = useRef<Engines | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const gate = useRef(new FrameGate());
  const tracker = useRef(new Tracker());

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
  }

  function toggleFreeze() {
    const frame = video.current;
    if (!frame?.videoWidth || !still.current) return;
    gate.current.invalidate();
    tracker.current.clear();
    setTracks([]);
    setScanned(false);
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
    if (settings !== initialSettings) void saveSettings(settings).catch(() => setError('Could not save the exchange rate.'));
  }, [settings, initialSettings]);

  useEffect(() => {
    if (!camera || !ready) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const frameGate = gate.current;
    let active = true;
    let highDetail = false;
    let timer: ReturnType<typeof setTimeout>;
    const scan = async () => {
      const frame = video.current;
      const ocr = engine.current;
      if (document.visibilityState === 'visible' && frame?.videoWidth &&
          frame.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && ocr) {
        const image = frozen ? still.current! : frame;
        const w = frozen ? still.current!.width : frame.videoWidth;
        const h = frozen ? still.current!.height : frame.videoHeight;
        const scale = Math.min(1, (frozen || highDetail ? 960 : 640) / Math.max(w, h));
        let completed = false;
        try {
          await frameGate.run(async () => {
            if (active) setScanning(true);
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return yenReadings(await ocr.read(canvas));
          }, readings => {
            if (!readings.length) highDetail = !highDetail;
            setSource({ w, h });
            setTracks(tracker.current.update(readings, performance.now(), 1));
            setScanning(false);
            setScanned(true);
            completed = true;
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

  const rate = settings.php;
  const validRate = /^\d{0,8}(?:\.\d{1,10})?$/.test(rate) && Number(rate) > 0;
  const manual = pesosToYen(pesos, rate);
  const manualPesos = validRate && /^\d{1,12}$/.test(yenAmount)
    ? convert(BigInt(yenAmount), rate, 'PHP')?.replace('PHP ', '₱') : undefined;
  function display(track: Track) {
    const amount = yen(track.text);
    return amount === undefined || !validRate ? undefined : convert(amount, rate, 'PHP')?.replace('PHP ', '₱');
  }

  return <main>
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">¥</span><div><h1>NihonLens</h1><p>Your pocket price companion</p></div></div><span className="country-pair">JP <span aria-hidden="true">↔</span> PH</span></header>
    <div className="section-heading"><h2>Point. Scan. Convert.</h2><span>Yen to pesos</span></div>
    <div className="camera-card">
    <section className="view" ref={preview} aria-label="Camera preview">
      <video ref={video} muted playsInline />
      <canvas ref={still} className="frozen-preview" style={{ display: frozen ? 'block' : 'none', objectFit: 'cover' }} aria-label="Frozen camera frame" />
      <div className="camera-badge"><span className={camera && !frozen ? 'live-dot' : ''} />{frozen ? 'FROZEN FRAME' : camera ? 'LIVE CAMERA' : 'PRICE SCANNER'}</div>
      {!camera && <div className="hint"><div className="viewfinder" aria-hidden="true">¥</div><h3>A little clarity on every price.</h3><p>Point at ¥500 or 500円.<br />See what it costs in pesos.</p><span className="privacy-note">Private · On your device</span></div>}
      {camera && view.w > 8 && source.w > 0 && tracks.map(track => {
        const price = display(track);
        const box = fill(track.box, source.w, source.h, view.w, view.h);
        if (!price || box.x + box.w < 0 || box.y + box.h < 0 || box.x > view.w || box.y > view.h) return null;
        const width = Math.min(156, view.w - 8);
        const left = Math.max(4, Math.min(view.w - width - 4, box.x + box.w / 2 - width / 2));
        const top = Math.max(4, Math.min(view.h - 44, box.y));
        return <span className="overlay price" key={track.id} style={{ width, left, top }}>{price}</span>;
      })}
    </section>
    <div className="camera-controls">
      <button className={camera ? 'secondary' : 'primary'} disabled={starting || (!camera && !ready)} onClick={camera ? stopCamera : () => void startCamera()}>
        {camera ? 'Stop camera' : starting ? 'Starting…' : 'Start camera'}
      </button>
      {camera && <button className="primary" onClick={toggleFreeze}>{frozen ? 'Resume' : 'Freeze'}</button>}
    </div>
    <p className="scan-status" aria-live="polite">{camera ? frozen ? (scanned ? (tracks.length ? 'Frozen prices ready. You can put your phone down.' : 'No yen price found. Resume and move closer to the price.') : 'Scanning frozen photo… You can put your phone down.') : tracks.length ? 'Yen prices found' : scanning ? 'Scanning prices… Tap Freeze to hold this view.' : 'Point at a yen price. Freeze anytime to scan a still photo.' : ready ? 'Ready when you are. Start your camera to scan.' : busy ? 'Getting your scanner ready…' : 'Download the scanner below to get started.'}</p>
    </div>
    <section className="panel converter" aria-label="Manual converter">
      <div className="section-heading"><h2>Quick convert</h2><span>Type a price</span></div>
      <div className="direction-switch" aria-label="Conversion direction"><button aria-pressed={direction === 'JPY'} onClick={() => setDirection('JPY')}>Yen → Pesos</button><button aria-pressed={direction === 'PHP'} onClick={() => setDirection('PHP')}>Pesos → Yen</button></div>
      {direction === 'JPY' ? <><label className="amount-label">Amount in JPY <span className="amount-field"><span aria-hidden="true">¥</span><input inputMode="numeric" maxLength={12} value={yenAmount} onChange={event => setYenAmount(event.target.value)} placeholder="0" /></span></label>
      {yenAmount && !/^\d{1,12}$/.test(yenAmount) && <small>Enter a whole yen amount using digits only.</small>}
      <div className="conversion-result"><span>In Philippine pesos</span><output aria-label="Amount in pesos" aria-live="polite">{manualPesos ?? '₱—'}</output></div></> : <><label className="amount-label">Amount in PHP <span className="amount-field"><span aria-hidden="true">₱</span><input inputMode="decimal" maxLength={15} value={pesos} onChange={event => setPesos(event.target.value)} placeholder="0.00" /></span></label>
      <div className="conversion-result"><span>In Japanese yen</span><output aria-label="Amount in yen" aria-live="polite">{manual ?? '¥—'}</output></div></>}
      <small className="rate-note">{validRate ? `¥1 = ₱${rate} · Your saved rate` : 'Set a positive exchange rate below to convert.'}</small>
    </section>
    {tracks.length > 0 && <section className="panel" aria-label="Detected prices">
      <h2>Detected prices</h2>
      <ul>{tracks.map(track => <li key={track.id}>{track.text}{display(track) && <> → {display(track)}</>}</li>)}</ul>
    </section>}
    {error && <p role="alert">{error}</p>}
    <details className="panel disclosure">
      <summary>Exchange rate <span>{validRate ? `¥1 = ₱${rate}` : 'Needs attention'}</span></summary>
      <div className="settings">
      <label>PHP per JPY <input inputMode="decimal" value={rate} onChange={event => setSettings({ php: event.target.value })} /></label>
      <small>{validRate ? 'This is a manual rate. Edit it whenever you need to.' : 'Enter a positive PHP amount for ¥1.'}</small>
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
    <footer>Made for the moments between yen and pesos.</footer>
  </main>;
}

void loadSettings().then(initialSettings =>
  createRoot(document.getElementById('root')!).render(<App initialSettings={initialSettings} />));
