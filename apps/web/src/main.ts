/**
 * BulkSift web app.
 *
 * Camera frames go to a worker that runs detection + matching; results come
 * back as a card, a price and an overlay quad. A demo feed renders simulated
 * card passes so the engine can be exercised on a machine with no webcam.
 */

import type { CardRecord, Detection, ScanHit } from '@bulksift/core';
import ScanWorker from './worker?worker';

declare const __BUILD_ID__: string;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const video = $<HTMLVideoElement>('video');
const demoCanvas = $<HTMLCanvasElement>('demo');
const overlay = $<HTMLCanvasElement>('overlay');
const idleHint = $('idleHint');
const statusDot = $('statusDot');
const engineStats = $('engineStats');
const liveCard = $('liveCard');
const perf = $('perf');
const scanList = $<HTMLUListElement>('scanList');
const sessionTotal = $('sessionTotal');
const sessionCount = $('sessionCount');
const priceMeta = $('priceMeta');
const btnCamera = $<HTMLButtonElement>('btnCamera');
const btnDemo = $<HTMLButtonElement>('btnDemo');
const btnStop = $<HTMLButtonElement>('btnStop');
const btnClear = $<HTMLButtonElement>('btnClear');
const btnExport = $<HTMLButtonElement>('btnExport');
const alertThreshold = $<HTMLInputElement>('alertThreshold');
const alertCount = $('alertCount');
const readout = document.querySelector<HTMLElement>('.readout')!;
const ambiguityModal = $('ambiguityModal');
const ambiguityWhy = $('ambiguityWhy');
const ambiguityOptions = $('ambiguityOptions');

const worker = new ScanWorker();

/**
 * Width the frame is downscaled to before scanning.
 *
 * Not smaller than this: the rectified card is 336 px tall, so at 640 px wide a
 * card filling the frame arrives at ~290 px and has to be upsampled into the
 * descriptor grid. 1280 keeps the card comfortably above canonical size, which
 * measurably lowered Hamming distances.
 */
const SCAN_WIDTH = 1280;

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Mode = 'idle' | 'camera' | 'demo';
let mode: Mode = 'idle';
let stream: MediaStream | null = null;
let rafId = 0;
let seq = 0;
let inFlight = false;
let ready = false;

const scanCanvas = document.createElement('canvas');
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true })!;
const overlayCtx = overlay.getContext('2d')!;
const demoCtx = demoCanvas.getContext('2d')!;

interface SessionEntry {
  hit: ScanHit;
  chosen: CardRecord;
  price: number | null;
  li: HTMLLIElement;
  scannedAt: string;
}
const session: SessionEntry[] = [];

const fpsWindow: number[] = [];
let lastFrameAt = 0;

// ---------------------------------------------------------------- worker wiring

worker.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'ready') {
    ready = true;
    statusDot.classList.add('ready');
    engineStats.textContent =
      `${msg.cards.toLocaleString('en-US')} cards · ${(msg.indexBytes / 1e6).toFixed(2)} MB index · ` +
      `${msg.bits}-bit descriptor · ${msg.priced.toLocaleString('en-US')} priced`;
    priceMeta.textContent = `Prices: ${msg.priceSource} · updated ${msg.priceUpdated} · USD, raw Near Mint`;
    btnCamera.disabled = false;
    btnDemo.disabled = false;
    return;
  }
  if (msg.type === 'error') {
    statusDot.classList.add('error');
    engineStats.textContent = `engine error: ${msg.message}`;
    return;
  }
  if (msg.type === 'result') {
    inFlight = false;
    drawOverlay(msg.detection as Detection | null);
    updateLive(msg.preview, msg.timings);
    if (msg.hit) onHit(msg.hit as ScanHit);
    const waiter = frameWaiter;
    frameWaiter = null;
    waiter?.(msg);
  }
};

/** Resolved by the next worker result, so a test can advance frame by frame. */
let frameWaiter: ((msg: unknown) => void) | null = null;

worker.postMessage({ type: 'init', dataBase: '/data' });
btnCamera.disabled = true;
btnDemo.disabled = true;

// ---------------------------------------------------------------- rendering

function drawOverlay(detection: Detection | null) {
  const w = overlay.width;
  const h = overlay.height;
  overlayCtx.clearRect(0, 0, w, h);
  if (!detection) return;

  const sx = w / scanCanvas.width;
  const sy = h / scanCanvas.height;
  const q = detection.quad;
  overlayCtx.beginPath();
  overlayCtx.moveTo(q[0].x * sx, q[0].y * sy);
  for (let i = 1; i < 4; i++) overlayCtx.lineTo(q[i].x * sx, q[i].y * sy);
  overlayCtx.closePath();
  overlayCtx.strokeStyle = detection.score > 0.6 ? '#4ade80' : '#fbbf24';
  overlayCtx.lineWidth = 3;
  overlayCtx.shadowColor = overlayCtx.strokeStyle;
  overlayCtx.shadowBlur = 10;
  overlayCtx.stroke();
  overlayCtx.shadowBlur = 0;
}

function updateLive(
  preview: { card: CardRecord; distance: number } | null,
  timings: { detect: number; describe: number; search: number; total: number },
) {
  const now = performance.now();
  if (lastFrameAt) {
    fpsWindow.push(1000 / (now - lastFrameAt));
    if (fpsWindow.length > 30) fpsWindow.shift();
  }
  lastFrameAt = now;
  const fps = fpsWindow.length
    ? fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length
    : 0;

  perf.textContent =
    `${fps.toFixed(0)} fps\n` +
    `detect ${timings.detect.toFixed(1)} ms\n` +
    `hash ${timings.describe.toFixed(1)} ms\n` +
    `search ${timings.search.toFixed(1)} ms`;

  if (!preview) {
    if (!liveCard.dataset.locked) {
      liveCard.innerHTML = '<span class="muted">waiting for a card…</span>';
    }
    return;
  }
  liveCard.dataset.locked = '';
  liveCard.innerHTML = `
    <div class="row">
      <div>
        <div class="name">${escapeHtml(preview.card.n)}</div>
        <div class="sub">${escapeHtml(preview.card.S)} · #${escapeHtml(preview.card.u)}</div>
      </div>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ---------------------------------------------------------------- session

function onHit(hit: ScanHit) {
  const li = document.createElement('li');
  const entry: SessionEntry = {
    hit,
    chosen: hit.card,
    price: hit.topMarket,
    li,
    scannedAt: new Date().toISOString(),
  };
  session.unshift(entry);
  renderEntry(entry);
  scanList.prepend(li);
  updateTotals();
  if (isHot(entry)) alertHot(entry.price as number);

  liveCard.dataset.locked = '1';
  liveCard.innerHTML = `
    <div class="row">
      <div>
        <div class="name">${escapeHtml(hit.card.n)}</div>
        <div class="sub">${escapeHtml(hit.card.S)} · #${escapeHtml(hit.card.u)} ·
          ${escapeHtml(hit.card.r ?? 'unknown rarity')} ·
          ${(hit.confidence * 100).toFixed(0)}% confidence</div>
      </div>
      <div class="price">${money(hit.topMarket)}</div>
    </div>`;

  if (hit.ambiguity) promptAmbiguity(entry);
}

function thresholdValue(): number {
  const v = Number.parseFloat(alertThreshold.value);
  return Number.isFinite(v) && v >= 0 ? v : Infinity;
}

function isHot(entry: SessionEntry): boolean {
  return entry.price != null && entry.price >= thresholdValue();
}

function renderEntry(entry: SessionEntry) {
  const { hit, chosen, price } = entry;
  const variant = hit.variants.find((v) => v.market === price);
  entry.li.classList.toggle('hot', isHot(entry));
  entry.li.innerHTML = `
    <div class="info">
      <div class="nm">${escapeHtml(chosen.n)}</div>
      <div class="meta">${escapeHtml(chosen.S)} · #${escapeHtml(chosen.u)}${
        variant ? ` · ${escapeHtml(variant.variant)}` : ''
      }</div>
    </div>
    ${hit.ambiguity ? '<span class="badge" data-role="fix">check printing</span>' : ''}
    <div class="amt ${price == null ? 'none' : ''}">${money(price)}</div>`;
  const badge = entry.li.querySelector('[data-role="fix"]');
  badge?.addEventListener('click', () => promptAmbiguity(entry));
}

function updateTotals() {
  const total = session.reduce((sum, e) => sum + (e.price ?? 0), 0);
  sessionTotal.textContent = money(total);
  sessionCount.textContent = String(session.length);
  btnExport.disabled = session.length === 0;
  const hot = session.filter(isHot).length;
  alertCount.textContent = hot ? `${hot} flagged` : '';
}

/**
 * Pull attention to a card worth more than the threshold.
 *
 * Bulk scanning is a search problem: hundreds of cards worth cents, and the
 * point is the one that is not. A row that scrolls past silently is a row that
 * gets missed, so a hit above the threshold flashes the readout and beeps.
 */
let audioCtx: AudioContext | null = null;
function alertHot(price: number) {
  readout.classList.remove('flash');
  void readout.offsetWidth; // restart the animation
  readout.classList.add('flash');
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    // pitch rises with value, so a $500 card sounds different to a $20 one
    osc.frequency.value = 660 + Math.min(660, Math.log10(Math.max(price, 1)) * 320);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.24);
  } catch {
    // audio is a nicety; the visual flash is the real signal
  }
}

function exportCsv() {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['scanned_at', 'card_id', 'name', 'set', 'number', 'rarity', 'variant',
      'market_usd', 'tcgplayer_url', 'needs_check'].join(','),
    ...session
      .slice()
      .reverse()
      .map((e) => {
        const variant = e.hit.variants.find((v) => v.market === e.price);
        return [
          e.scannedAt, e.chosen.i, e.chosen.n, e.chosen.S, e.chosen.u,
          e.chosen.r ?? '', variant?.variant ?? '',
          e.price == null ? '' : e.price.toFixed(2),
          e.chosen.t ?? '', e.hit.ambiguity ? 'yes' : '',
        ].map(esc).join(',');
      }),
  ];
  const total = session.reduce((s, e) => s + (e.price ?? 0), 0);
  rows.push(['', '', 'TOTAL', '', '', '', '', total.toFixed(2), '', ''].join(','));

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bulksift-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

btnExport.addEventListener('click', exportCsv);
alertThreshold.addEventListener('input', () => {
  for (const e of session) renderEntry(e);
  updateTotals();
});

function promptAmbiguity(entry: SessionEntry) {
  const amb = entry.hit.ambiguity;
  if (!amb) return;
  ambiguityWhy.textContent =
    'These printings share the same artwork and cannot be told apart reliably from a ' +
    'moving card, but their prices differ. Pick the one you are holding.';
  ambiguityOptions.innerHTML = '';

  const choices = [
    { card: entry.hit.card, price: entry.hit.topMarket },
    ...amb.alternatives.map((a) => ({ card: a.card, price: a.topMarket })),
  ];
  for (const c of choices) {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.innerHTML = `
      <div>
        <div class="o-name">${escapeHtml(c.card.n)}</div>
        <div class="o-set">${escapeHtml(c.card.S)} · #${escapeHtml(c.card.u)}</div>
      </div>
      <div class="o-price">${money(c.price)}</div>`;
    btn.addEventListener('click', () => {
      entry.chosen = c.card;
      entry.price = c.price;
      entry.hit.ambiguity = undefined;
      renderEntry(entry);
      updateTotals();
      ambiguityModal.classList.add('hidden');
    });
    ambiguityOptions.appendChild(btn);
  }
  ambiguityModal.classList.remove('hidden');
}

ambiguityModal.addEventListener('click', (e) => {
  if (e.target === ambiguityModal) ambiguityModal.classList.add('hidden');
});

btnClear.addEventListener('click', () => {
  session.length = 0;
  scanList.innerHTML = '';
  updateTotals();
  worker.postMessage({ type: 'reset' });
});

// ---------------------------------------------------------------- capture loop

function sizeCanvases(srcW: number, srcH: number) {
  const scale = SCAN_WIDTH / srcW;
  scanCanvas.width = SCAN_WIDTH;
  scanCanvas.height = Math.round(srcH * scale);
  const box = overlay.parentElement!.getBoundingClientRect();
  overlay.width = Math.round(box.width);
  overlay.height = Math.round(box.height);
}

function pump(source: CanvasImageSource, srcW: number, srcH: number) {
  if (!ready || inFlight) return;
  scanCtx.drawImage(source, 0, 0, scanCanvas.width, scanCanvas.height);
  const img = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  inFlight = true;
  worker.postMessage(
    { type: 'frame', buffer: img.data.buffer, width: img.width, height: img.height, seq: seq++ },
    [img.data.buffer],
  );
  void srcW;
  void srcH;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (err) {
    engineStats.textContent = `camera unavailable: ${String(err)}`;
    statusDot.classList.add('error');
    return;
  }
  video.srcObject = stream;
  await video.play();
  demoCanvas.style.display = 'none';
  video.style.display = 'block';
  idleHint.classList.add('hidden');
  sizeCanvases(video.videoWidth, video.videoHeight);
  setMode('camera');

  const loop = () => {
    if (mode !== 'camera') return;
    pump(video, video.videoWidth, video.videoHeight);
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

function setMode(next: Mode) {
  mode = next;
  const running = next !== 'idle';
  btnStop.disabled = !running;
  btnCamera.disabled = running;
  btnDemo.disabled = running;
}

function stop() {
  clearTimeout(rafId);
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  setMode('idle');
  idleHint.classList.remove('hidden');
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
}

btnCamera.addEventListener('click', () => void startCamera());
btnStop.addEventListener('click', stop);

// ---------------------------------------------------------------- demo feed

interface DemoCard {
  id: string;
  img: HTMLImageElement;
}

let demoCards: DemoCard[] = [];

async function startDemo() {
  const manifest: string[] = await fetch('/dev-fixtures/manifest.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  if (!manifest.length) {
    engineStats.textContent = 'demo feed needs dev fixtures (run tools/make_dev_fixtures.py)';
    return;
  }
  const loaded: DemoCard[] = [];
  await Promise.all(
    manifest.map(
      (id) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            loaded.push({ id, img });
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `/dev-fixtures/${id}.png`;
        }),
    ),
  );
  if (!loaded.length) return;

  demoCanvas.width = 1280;
  demoCanvas.height = 720;
  video.style.display = 'none';
  demoCanvas.style.display = 'block';
  idleHint.classList.add('hidden');
  sizeCanvases(demoCanvas.width, demoCanvas.height);
  setMode('demo');

  demoCards = loaded;

  let t = 0;
  const loop = () => {
    if (mode !== 'demo') return;
    renderDemoFrame(t);
    pump(demoCanvas, demoCanvas.width, demoCanvas.height);
    t++;
    // setTimeout rather than requestAnimationFrame: rAF is starved whenever the
    // page is not compositing (hidden tab, headless preview), which silently
    // freezes the feed. The scan loop must keep running to be testable.
    rafId = window.setTimeout(loop, 16);
  };
  loop();
}

/** Draw pass frame `t` of the demo feed. Split out so it can be stepped. */
function renderDemoFrame(t: number) {
  if (!demoCards.length) return;
  const PASS_FRAMES = 90;
  const card = demoCards[Math.floor(t / PASS_FRAMES) % demoCards.length];
  const p = (t % PASS_FRAMES) / PASS_FRAMES;

  demoCtx.fillStyle = '#20293a';
  demoCtx.fillRect(0, 0, demoCanvas.width, demoCanvas.height);
  // a bit of desk texture so the detector has a realistic background
  demoCtx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 40; i++) {
    demoCtx.fillRect((i * 137) % demoCanvas.width, (i * 91) % demoCanvas.height, 60, 2);
  }

  const h = demoCanvas.height * 0.78;
  const w = h * (245 / 342);
  // slide across the frame, pausing in the middle like a real hand does
  const eased = p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 + (p - 0.6) / 0.4;
  const cx = -w + eased * (demoCanvas.width + w) * 0.6 + demoCanvas.width * 0.1;
  const cy = demoCanvas.height / 2 + Math.sin(p * Math.PI * 2) * 12;
  const angle = Math.sin(p * Math.PI * 3) * 0.09;

  demoCtx.save();
  demoCtx.translate(cx, cy);
  demoCtx.rotate(angle);
  demoCtx.transform(1, Math.sin(p * 4) * 0.02, Math.sin(p * 3) * 0.03, 1, 0, 0);
  demoCtx.drawImage(card.img, -w / 2, -h / 2, w, h);
  demoCtx.restore();
}

btnDemo.addEventListener('click', () => void startDemo());

/**
 * Test hook: step the demo deterministically, one frame at a time, without
 * depending on the render loop. Used to verify the full app path (frame pump ->
 * worker -> detection -> match -> price -> session list) in environments where
 * animation callbacks do not fire.
 */
(window as unknown as Record<string, unknown>).__bulksift = {
  async selfTest(passes = 2, stride = 3) {
    if (!demoCards.length) await startDemo();
    setMode('demo');
    let frames = 0;
    for (let t = 0; t < passes * 90; t += stride) {
      renderDemoFrame(t);
      inFlight = false;
      const done = new Promise((r) => {
        frameWaiter = r as (m: unknown) => void;
      });
      pump(demoCanvas, demoCanvas.width, demoCanvas.height);
      await done; // one frame in flight at a time, or the worker queue explodes
      frames++;
    }
    return { frames, scans: session.length };
  },
  state: () => ({
    mode,
    ready,
    cards: demoCards.map((c) => c.id),
    scans: session.map((e) => ({ id: e.chosen.i, name: e.chosen.n, price: e.price })),
  }),
};

window.addEventListener('resize', () => {
  if (mode !== 'idle') {
    const src = mode === 'camera' ? video : demoCanvas;
    sizeCanvases(
      mode === 'camera' ? video.videoWidth : demoCanvas.width,
      mode === 'camera' ? video.videoHeight : demoCanvas.height,
    );
    void src;
  }
});

// ---------------------------------------------------------------- offline

// Registered last so a service-worker failure can never block the scanner.
if ('serviceWorker' in navigator && location.protocol !== 'blob:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {
      // offline support is a bonus; the app works without it
    });
  });
}
