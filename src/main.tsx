import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Engines } from './engines';
import { controlled, downloadPack, removePack, verifyInstalled } from './pack';
import { packBytes, packVersion } from './pack-info';
import { convert, fill, FrameGate, Tracker, TranslationCache, yen, type Track } from './vision';
import { loadSettings, saveSettings, type Settings } from './settings';
import './style.css';

const scanOnFreeze = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const interruptionKey = 'nihonlens.translation-in-progress';
function translationInterrupted() {
  try { return sessionStorage.getItem(interruptionKey) === 'yes'; }
  catch { return false; }
}
function recordTranslation(active: boolean) {
  try {
    if (active) sessionStorage.setItem(interruptionKey, 'yes');
    else sessionStorage.removeItem(interruptionKey);
  } catch { /* Browser storage may be unavailable. */ }
}

function App({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [mobileTranslation, setMobileTranslation] = useState(false);
  const [interrupted, setInterrupted] = useState(() => scanOnFreeze && translationInterrupted());
  const translationEnabled = scanOnFreeze ? mobileTranslation : settings.translate;
  const [status, setStatus] = useState('Checking offline pack…');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const still = useRef<HTMLCanvasElement | undefined>(undefined);
  const frozenPreview = useRef<HTMLCanvasElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selected, setSelected] = useState<Track>();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [source, setSource] = useState({ w: 0, h: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const engines = useRef<Engines | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const gate = useRef(new FrameGate());
  const tracker = useRef(new Tracker());
  const translations = useRef(new TranslationCache());
  const stream = useRef<MediaStream | undefined>(undefined);

  async function prepare(download: boolean) {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setReady(false);
    setTracks([]);
    setSelected(undefined);
    tracker.current.clear();
    gate.current.invalidate();
    try {
      if (download) {
        void navigator.storage?.persist?.().catch(() => false);
        await downloadPack(setStatus, controller.signal);
      } else {
        if (!(await verifyInstalled(controller.signal))) {
          setStatus('Japanese offline pack needs a download.');
          return;
        }
        await controlled();
      }
      setStatus(scanOnFreeze ? 'Verifying Japanese text recognition…' : 'Verifying Japanese OCR and English translation…');
      const engine = new Engines(scanOnFreeze);
      await engines.current?.close();
      engines.current = engine;
      await engine.smokeTest(!scanOnFreeze);
      controller.signal.throwIfAborted();
      setReady(true);
      setStatus(scanOnFreeze ? 'Offline OCR ready. English translation is optional on iPhone and iPad.' : 'Offline Ready');
    } catch (error) {
      await engines.current?.close();
      engines.current = undefined;
      setStatus(controller.signal.aborted ? 'Download canceled. Retry when online.' :
        'Pack unavailable. Retry download. ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      abort.current = undefined;
      setBusy(false);
    }
  }

  useEffect(() => {
    void prepare(false);
    const node = preview.current!;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(node);
    const pagehide = () => { stream.current?.getTracks().forEach(track => track.stop()); };
    window.addEventListener('pagehide', pagehide);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      observer.disconnect();
      pagehide();
      abort.current?.abort();
      void engines.current?.close();
    };
  }, []);

  useEffect(() => {
    if (settings !== initialSettings) void saveSettings(settings).catch(() => setNotice('Browser storage is unavailable. Settings may reset on reload.'));
  }, [settings, initialSettings]);

  useEffect(() => {
    if (!ready || !camera || (!frozen && !translationEnabled && !settings.currency) || (scanOnFreeze && !frozen)) return;
    const surface = document.createElement('canvas');
    const context = surface.getContext('2d')!;
    const frameGate = gate.current;
    let timer: ReturnType<typeof setTimeout>;
    let running = true;
    const scan = async () => {
      const element = video.current;
      const snapshot = frozen ? still.current : undefined;
      if (frozen && !snapshot) return;
      const liveFrame = element?.videoWidth && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (document.visibilityState === 'visible' && (snapshot || liveFrame) && engines.current) {
        try {
          const engine = engines.current;
          const width = snapshot?.width ?? element!.videoWidth;
          const height = snapshot?.height ?? element!.videoHeight;
          const scale = Math.min(1, 960 / Math.max(width, height));
          const processed = await frameGate.run(async () => {
            if (frozen) setScanMessage('Reading frozen frame…');
            surface.width = Math.round(width * scale);
            surface.height = Math.round(height * scale);
            if (!snapshot) context.drawImage(element!, 0, 0, surface.width, surface.height);
            const readings = await engine.read(snapshot ?? surface, settings.vertical);
            if (scanOnFreeze) await engine.releaseOcr();
            if (frozen && running && document.visibilityState === 'visible') {
              setSource({ w: width, h: height });
              setTracks(readings.map((reading, id) => ({ ...reading, id, hits: 2, seen: performance.now() })));
              if (translationEnabled && readings.length) setScanMessage('Translating frozen frame…');
            }
            let translationFailed = false;
            if (translationEnabled && running && document.visibilityState === 'visible') {
              try {
                for (const reading of readings.slice(0, 4)) {
                  if (!running || document.visibilityState !== 'visible') break;
                  reading.english = await translations.current.get(reading.text, text => {
                    if (scanOnFreeze) recordTranslation(true);
                    return engine.translate(text);
                  });
                }
              } catch (error) {
                if (!scanOnFreeze) throw error;
                translationFailed = true;
              } finally {
                if (scanOnFreeze) {
                  engine.releaseTranslation();
                  recordTranslation(false);
                }
              }
            }
            if (scanOnFreeze && running && document.visibilityState === 'visible') {
              if (translationFailed) {
                setNotice('English translation stopped. Yen conversion is still available.');
              } else if (readings.some(reading => reading.english)) {
                setStatus('Offline Ready');
                setInterrupted(false);
              }
            }
            return readings;
          }, readings => {
            if (document.visibilityState !== 'visible') return;
            setSource({ w: width, h: height });
            if (frozen) {
              setTracks(readings.map((reading, id) => ({ ...reading, id, hits: 2, seen: performance.now() })));
              setScanMessage(!readings.length ? 'No text found. Resume, move closer, and scan again.' :
                readings.some(reading => reading.english) ? 'English translation complete.' :
                !translationEnabled ? 'Text found. English translation is off.' :
                'Text found. No English translation was produced for this frame.');
            } else setTracks(tracker.current.update(readings, performance.now()));
          });
          if (frozen && processed && document.visibilityState === 'visible') return;
        } catch (error) {
          setScanMessage('');
          setReady(false);
          await engines.current?.close();
          engines.current = undefined;
          setTracks([]);
          setStatus('Inference stopped. Verify or redownload the offline pack.');
          setNotice(error instanceof Error ? error.message : String(error));
        }
      }
      if (running) timer = setTimeout(scan, 500);
    };
    const visibility = () => frameGate.invalidate();
    document.addEventListener('visibilitychange', visibility);
    void scan();
    return () => {
      running = false;
      frameGate.invalidate();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [ready, camera, frozen, translationEnabled, settings.currency, settings.vertical]);

  function stopCamera() {
    gate.current.invalidate();
    still.current = undefined;
    setScanMessage('');
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = undefined;
    if (video.current) video.current.srcObject = null;
    tracker.current.clear();
    setCamera(false);
    setFrozen(false);
    setTracks([]);
    setSelected(undefined);
  }

  async function startCamera() {
    setNotice('');
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS and a supported browser.');
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      const node = video.current!;
      node.srcObject = stream.current;
      await node.play();
      setCamera(true);
    } catch (error) {
      stopCamera();
      setNotice('Camera unavailable. Check browser permission and close other camera apps. ' + String(error));
    } finally { setStarting(false); }
  }

  async function toggleFreeze() {
    gate.current.invalidate();
    if (frozen) {
      try { await video.current?.play(); } catch (error) { setNotice(String(error)); return; }
      setSelected(undefined);
      still.current = undefined;
      setScanMessage('');
      tracker.current.clear();
      setTracks([]);
    } else {
      const element = video.current;
      if (!element?.videoWidth || element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        setScanMessage('The camera is still starting. Wait for the preview, then tap again.');
        return;
      }
      const frame = frozenPreview.current!;
      const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
      frame.width = Math.round(element.videoWidth * scale);
      frame.height = Math.round(element.videoHeight * scale);
      frame.getContext('2d')!.drawImage(element, 0, 0, frame.width, frame.height);
      still.current = frame;
      element.pause();
      setTracks([]);
      setScanMessage(ready ? 'Reading frozen frame…' : busy ? 'Checking the offline pack. The scan will start when it is ready.' :
        'The offline pack is unavailable. Download or verify it below.');
    }
    setFrozen(!frozen);
  }

  function label(track: Track) {
    const price = yen(track.text);
    const converted = settings.currency && price !== undefined
      ? [settings.units !== 'USD' && convert(price, settings.php, 'PHP'),
         settings.units !== 'PHP' && convert(price, settings.usd, 'USD')].filter(Boolean).join(' / ')
      : '';
    return [translationEnabled && track.english, converted].filter(Boolean).join(' · ') || (frozen ? track.text : '');
  }

  return <main>
    <header><p className="eyebrow">ON-DEVICE JAPANESE CAMERA</p><h1>NihonLens</h1><p>Translate signs and convert yen prices as you look.</p></header>
    <section className="view" ref={preview} aria-label="Camera preview">
      <video ref={video} muted playsInline hidden={frozen} />
      <canvas ref={frozenPreview} className="frozen-preview" hidden={!frozen} aria-label="Frozen camera frame" />
      {!camera && <p className="hint">Start the camera to scan Japanese text.</p>}
      {source.w > 0 && size.w > 0 && tracks.map(track => {
        const value = label(track);
        const box = fill(track.box, source.w, source.h, size.w, size.h, frozen ? 'contain' : 'cover');
        if (!value || box.x + box.w < 0 || box.y + box.h < 0 || box.x > size.w || box.y > size.h) return null;
        return <button className="overlay" key={track.id} style={{ left: Math.max(0, Math.min(size.w - 100, box.x)),
          top: Math.max(0, Math.min(size.h - 46, box.y + box.h)), maxWidth: Math.max(100, size.w - Math.max(0, box.x)) }}
          onClick={() => setSelected(track)}>{value}</button>;
      })}
    </section>
    <div className="row">
      <button disabled={starting} onClick={camera ? stopCamera : () => void startCamera()}>{camera ? 'Stop camera' : starting ? 'Starting…' : 'Start camera'}</button>
      <button disabled={!camera} onClick={() => void toggleFreeze()}>{frozen ? 'Resume' : scanOnFreeze ? 'Freeze & scan' : 'Freeze'}</button>
    </div>
    {camera && scanOnFreeze && !frozen && <p>Tap Freeze &amp; scan to read a still frame.</p>}
    {interrupted && <p role="alert">The last English translation was interrupted. You can still scan yen prices. Enable English translation to try it again.</p>}
    {scanMessage && <p aria-live="polite">{scanMessage}</p>}
    {scanOnFreeze && frozen && ready && tracks.length > 0 && !translationEnabled &&
      <button onClick={() => { setMobileTranslation(true); setInterrupted(false); setNotice(''); }}>
        Translate this frame
      </button>}
    {frozen && tracks.length > 0 && <section className="panel" aria-label="Scan results">
      <h2>Scan results</h2>
      <ul>{tracks.map(track => <li key={track.id}>
        <span lang="ja">{track.text}</span>
        {label(track) !== track.text && <div>{label(track)}</div>}
      </li>)}</ul>
    </section>}
    {selected && <aside><strong>Original Japanese</strong><p lang="ja">{selected.text}</p><button onClick={() => setSelected(undefined)}>Close</button></aside>}
    {notice && <p role="alert">{notice}</p>}
    <section className="panel">
      <h2>Japanese offline pack</h2>
      <p role="status">{status}</p>
      <small>{packVersion} · {Math.ceil(packBytes / 1e6)} MB download · Keep this tab open</small>
      <div className="row">
        <button disabled={busy} onClick={() => void prepare(true)}>{ready ? 'Redownload pack' : 'Download / retry pack'}</button>
        <button disabled={busy} onClick={() => void prepare(false)}>Verify pack</button>
        {busy ? <button onClick={() => { abort.current?.abort(); void engines.current?.close(); }}>Cancel</button> :
          <button onClick={async () => {
            setBusy(true);
            setReady(false);
            gate.current.invalidate();
            setSelected(undefined);
            setTracks([]);
            tracker.current.clear();
            try {
              await engines.current?.close();
              engines.current = undefined;
              await removePack();
              setStatus('Japanese offline pack deleted.');
            } catch (error) { setStatus('Could not delete pack. ' + String(error)); }
            finally { setBusy(false); }
          }}>Delete pack</button>}
      </div>
    </section>
    <section className="panel settings">
      <h2>Settings</h2>
      <label><input type="checkbox" checked={translationEnabled} onChange={e => {
        if (scanOnFreeze) {
          setMobileTranslation(e.target.checked);
          setNotice('');
          if (e.target.checked) setInterrupted(false);
        } else setSettings({ ...settings, translate: e.target.checked });
      }} /> English translation</label>
      <label><input type="checkbox" checked={settings.currency} onChange={e => setSettings({ ...settings, currency: e.target.checked })} /> Yen conversion</label>
      <label><input type="checkbox" checked={settings.vertical} onChange={e => {
        tracker.current.clear(); setTracks([]); setSelected(undefined);
        setSettings({ ...settings, vertical: e.target.checked });
      }} /> Vertical Japanese</label>
      <label>Convert to <select value={settings.units} onChange={e => setSettings({ ...settings, units: e.target.value })}>
        <option>PHP</option><option>USD</option><option value="both">PHP and USD</option>
      </select></label>
      <label>PHP per JPY <input inputMode="decimal" value={settings.php} onChange={e => setSettings({ ...settings, php: e.target.value })} placeholder="Enter manual rate" /></label>
      <label>USD per JPY <input inputMode="decimal" value={settings.usd} onChange={e => setSettings({ ...settings, usd: e.target.value })} placeholder="Enter manual rate" /></label>
    </section>
    <details><summary>Install NihonLens</summary><p>On iPhone, open in Safari and choose Share → Add to Home Screen. On Android, use Chrome’s Install app or Add to Home screen menu. Open the installed app and verify the Japanese pack before going offline.</p></details>
  </main>;
}

void loadSettings().then(initialSettings => createRoot(document.getElementById('root')!).render(<App initialSettings={initialSettings} />));
