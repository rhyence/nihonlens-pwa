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
  const [status, setStatus] = useState('Checking offline scanner…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [source, setSource] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null);
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
    let timer: ReturnType<typeof setTimeout>;
    const scan = async () => {
      const frame = video.current;
      const ocr = engine.current;
      if (document.visibilityState === 'visible' && frame?.videoWidth &&
          frame.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && ocr) {
        const { videoWidth: w, videoHeight: h } = frame;
        const scale = Math.min(1, 960 / Math.max(w, h));
        try {
          await frameGate.run(async () => {
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            return yenReadings(await ocr.read(canvas));
          }, readings => {
            setSource({ w, h });
            setTracks(tracker.current.update(readings, performance.now()));
          });
        } catch (failure) {
          stopCamera();
          setReady(false);
          setStatus('Scanner stopped. Verify it to try again.');
          setError(String(failure));
        }
      }
      if (active) timer = setTimeout(scan, 650);
    };
    const visibility = () => {
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
  }, [camera, ready]);

  const rate = settings.php;
  const validRate = /^\d{0,8}(?:\.\d{1,10})?$/.test(rate) && Number(rate) > 0;
  const manual = pesosToYen(pesos, rate);
  function display(track: Track) {
    const amount = yen(track.text);
    return amount === undefined || !validRate ? undefined : convert(amount, rate, 'PHP')?.replace('PHP ', '₱');
  }

  return <main>
    <header><p className="eyebrow">OFFLINE YEN PRICE SCANNER</p><h1>NihonLens</h1><p>Hold your camera over a yen price to see it in Philippine pesos.</p></header>
    <section className="view" ref={preview} aria-label="Camera preview">
      <video ref={video} muted playsInline />
      {!camera && <p className="hint">Start the camera and point it at a price such as ¥500 or 500円.</p>}
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
    <div className="row">
      <button disabled={starting || (!camera && !ready)} onClick={camera ? stopCamera : () => void startCamera()}>
        {camera ? 'Stop camera' : starting ? 'Starting…' : 'Start camera'}
      </button>
    </div>
    {camera && <p>{tracks.length ? 'Yen prices found' : 'Hold steady with the yen symbol or 円 in view…'}</p>}
    {tracks.length > 0 && <section className="panel" aria-label="Detected prices">
      <h2>Detected prices</h2>
      <ul>{tracks.map(track => <li key={track.id}>{track.text}{display(track) && <> → {display(track)}</>}</li>)}</ul>
    </section>}
    {error && <p role="alert">{error}</p>}
    <section className="panel settings">
      <h2>Exchange rate</h2>
      <label>PHP per JPY <input inputMode="decimal" value={rate} onChange={event => setSettings({ php: event.target.value })} /></label>
      <small>{validRate ? 'This is a manual rate. Edit it whenever you need to.' : 'Enter a positive PHP amount for ¥1.'}</small>
      <h2>Pesos to yen</h2>
      <label>Amount in PHP <input inputMode="decimal" value={pesos} onChange={event => setPesos(event.target.value)} placeholder="0.00" /></label>
      {manual && <output aria-label="Amount in yen">{manual}</output>}
    </section>
    <section className="panel">
      <h2>Offline scanner</h2>
      <p role="status">{status}</p>
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
    </section>
  </main>;
}

void loadSettings().then(initialSettings =>
  createRoot(document.getElementById('root')!).render(<App initialSettings={initialSettings} />));
