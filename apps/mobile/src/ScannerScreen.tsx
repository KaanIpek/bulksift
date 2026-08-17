/**
 * The scanning screen.
 *
 * Frames come from VisionCamera's frame output at ~960x540 RGB. The recognition
 * work runs on the JS thread rather than inside the frame worklet: the engine is
 * ordinary TypeScript with classes, Maps and typed arrays, and the index is a
 * ~1.9 MB buffer that would have to be duplicated into a worklet context.
 *
 * Two device bugs were fixed here, and both are worth writing down because
 * neither was visible from the JavaScript.
 *
 * 1. The app died a few seconds after opening, with or without a card in view.
 *    The worklet was handing its pixels over as `scheduleOnRN(onPixels, new
 *    Uint8Array(buf), info)`. Worklets serialise arguments by type, and a typed
 *    array is not an ArrayBuffer - it falls through to the generic object case,
 *    which enumerates every own property. For a two-million-element buffer that
 *    is two million string keys allocated per frame, so iOS killed the process
 *    for memory almost immediately. Handing over the ArrayBuffer itself takes
 *    the memcpy path instead. The copy happens synchronously inside
 *    `scheduleOnRN`, so disposing the frame right after is safe.
 *
 * 2. Photo capture was tried as a way around it and cannot work at all:
 *    `containerFormat: 'native'` resolves to HEIC, and an AVCapturePhoto only
 *    exposes a pixel buffer for uncompressed formats. `hasPixelBuffer` is
 *    always false. That path is gone.
 *
 * Everything the camera creates is also memoised at module scope. Passing an
 * options object literal to `useFrameOutput` builds a *new* frame output on
 * every React render - each with its own native thread - and the session then
 * spends its life being reconfigured instead of delivering frames.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import type { CardRecord, ScanHit } from '@bulksift/core';
import { type LoadedEngine } from './engine';
import { c, s as sp, t as ty } from './ui/theme';
import { ScanIcon } from './ui/icons';
import { Button } from './ui/parts';
import {
  ScanFeed, ScanOverlay, ScanSummary, ScanViewport,
  type Aim, type LiveCard, type ScannedRow,
} from './ui/ScanChrome';
import { cameraPixels, lumaSource, toWorkGrid, type FrameInfo } from './frame';
import { isNativeAvailable, nativeDescriber, nativeStages } from '../modules/bulksift-detect';
import { runSelfTest } from './selfTest';
import type { CapturedRead } from './capture';

/**
 * 960x540 rather than 1280x720.
 *
 * A card filling most of the frame arrives ~430 px tall, comfortably above the
 * 336 px the descriptor rectifies to, while costing 44% fewer pixels to scan.
 * The on-device self-test runs at exactly this size and matches at the same
 * distances as the desktop suite, so the resolution is not what limits it.
 *
 * Declared once, at module scope. `useFrameOutput` memoises on the identity of
 * this object, so an inline literal would rebuild the camera pipeline on every
 * render.
 */
const TARGET_RESOLUTION = { width: 960, height: 540 };

declare global {
  /**
   * The worklets runtime's own serialiser, installed on every worklet runtime
   * by `WorkletRuntimeDecorator`. It is not part of the public API, but it is
   * the only thing on that runtime that knows how to copy an ArrayBuffer, and
   * the public `scheduleOnRN` silently turns one into an empty object.
   */
  // eslint-disable-next-line no-var
  var _createSerializable: ((value: unknown, nativeStateSource: unknown) => unknown) | undefined;
}

/**
 * Run the bundled-frame self-test on startup.
 *
 * Normally dev-only, but flip it on to measure a release build: a debug build
 * runs Hermes without bytecode or optimisations, so its timings say very little
 * about what a shipped app does.
 */
const RUN_SELF_TEST = __DEV__;

/**
 * Share of the frame a card should cover before a read is trustworthy.
 *
 * At this fraction a card is read at the quality the whole test suite was
 * measured on; at half of it the descriptor disagrees with its own reference on
 * a third of its bits, which is close enough to noise that the winner flickers.
 */
const GOOD_FILL = 0.28;

export default function ScannerScreen({
  engine,
  onHit,
  sessionCount,
  sessionValue,
  onOpenCollection,
  onUndo,
  onRedirect,
  recent,
  onRecent,
  onResetSession,
  onCaptured,
}: {
  engine: LoadedEngine;
  onHit: (hit: ScanHit) => string;
  sessionCount: number;
  sessionValue: number;
  onOpenCollection: () => void;
  /** Receives a rectified card when Settings has asked for one. */
  onCaptured?: (read: CapturedRead) => Promise<void> | void;
  onUndo: (entryKey: string) => void;
  onRedirect: (entryKey: string, cardId: string) => string;
  /**
   * The just-scanned list, owned by the app rather than by this screen.
   *
   * This component is unmounted whenever another tab is on top, so holding it
   * here meant the feed's own "Open collection" link threw away every undo.
   */
  recent: ScannedRow[];
  onRecent: (next: (prev: ScannedRow[]) => ScannedRow[]) => void;
  onResetSession: () => void;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Prefer the rear camera, but fall back to whatever exists. Asking for 'back'
  // and stopping there kills the app on hardware that has no rear camera - some
  // tablets, and every emulator whose AVD only defines a front lens, where
  // CameraX fails with "No available camera can be found".
  const backDevice = useCameraDevice('back');
  const allDevices = useCameraDevices();
  const device = backDevice ?? allDevices[0];
  const [live, setLive] = useState<LiveCard | null>(null);
  /**
   * How much of the frame the card covers, 0..1.
   *
   * The single largest cause of bad reads, measured: a card filling the frame
   * disagrees with its own reference on 73 bits, at 70% of the frame on 168,
   * at half on 256. Nothing in the app used to say so, which left the one
   * thing the user can actually fix invisible.
   */
  const [fill, setFill] = useState(0);
  const [fps, setFps] = useState(0);
  const [selfTest, setSelfTest] = useState<string[] | null>(null);
  // Visible diagnostics. The first device build vanished with no message, so
  // every stage now reports whether it ran instead of failing silently.
  const [diag, setDiag] = useState<string>('starting…');
  // Live counters. "Nothing happens" is not a useful report; these say which
  // stage is stalling - frames arriving, cards found, or matches rejected.
  const statsRef = useRef({
    frames: 0, detected: 0, matched: 0, bestDistance: -1, margin: -1, refused: 0,
    pack: 0, detect: 0, describe: 0, search: 0, reused: 0, shownAt: 0,
    sections: '' ,
    vote: 0,
    crop: '',
  });
  const [scanning, setScanning] = useState(true);
  /**
   * The last few cards, purely as feedback that a scan landed.
   *
   * Not a second copy of the collection - it holds five rows and is thrown
   * away when the tab changes. Mid-scan the only question is "did that one go
   * in", and answering it here keeps the collection tab from having to be the
   * scanning UI as well.
   */

  const engineRef = useRef<LoadedEngine | null>(null);
  const lastTickRef = useRef(0);
  const fpsRef = useRef(0);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!hasPermission) void requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    engineRef.current = engine;
    setDiag(`engine ok · ${engine.cardCount.toLocaleString('en-US')} cards · waiting for frames`);
    if (!RUN_SELF_TEST) return;
    let cancelled = false;
    runSelfTest(engine.scanner)
      .then((r) => {
        const header = `engine self-test: ${r.correct}/${r.total} correct`;
        console.log(`[BulkSift] ${header}`);
        for (const l of r.lines) console.log(`[BulkSift]   ${l}`);
        if (!cancelled) setSelfTest([header, ...r.lines]);
      })
      .catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? err);
        console.log(`[BulkSift] self-test failed: ${msg}`);
        if (!cancelled) setSelfTest([`self-test failed: ${msg}`]);
      });
    return () => { cancelled = true; };
  }, [engine]);

  /**
   * Cross-runtime flags.
   *
   * `busy` is back-pressure: the worklet only hands over a frame when the JS
   * thread has finished the previous one. Without it the camera queues frames
   * faster than they can be recognised and the queue grows without bound.
   * `active` mirrors the Start/Stop button, so a stopped scan costs nothing.
   */
  const busy = useMemo(() => createSynchronizable(false), []);
  const active = useMemo(() => createSynchronizable(false), []);

  useEffect(() => {
    active.setBlocking(scanning && engine != null);
    if (!scanning) busy.setBlocking(false);
  }, [active, busy, scanning, engine]);

  /** Runs on the JS thread with a copy of one frame's pixels. */
  const onPixels = useCallback((bytes: Uint8Array, info: FrameInfo) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      // Whatever the camera gave us becomes tightly packed RGB first; the
      // engine is never handed a layout it did not expect. The frame arrives at
      // whatever the session negotiated - 1920x1080 on this phone, despite
      // asking for less - so it is subsampled to the width everything was
      // measured at on the way through.
      const tPack = Date.now();
      /*
       * The per-pixel stages, natively when the module is there.
       *
       * It is an accelerator, not a requirement: if it is missing or declines
       * the frame, the TypeScript path below runs exactly as it always has.
       * Both are checked against each other on the desktop, frame by frame, by
       * packages/core/native/check-parity.mjs.
       */
      const frameLayout = {
        width: info.width,
        height: info.height,
        bytesPerRow: info.bytesPerRow,
        bytesPerPixel: Math.max(3, Math.round(info.bytesPerRow / info.width)),
        rOff: info.pixelFormat === 'rgb-bgra-8-bit' ? 2 : 0,
        gOff: 1,
        bOff: info.pixelFormat === 'rgb-bgra-8-bit' ? 0 : 2,
      };
      const nat = nativeStages(bytes, frameLayout, 320, 2, 0.004, 1.1);
      const describer = nativeDescriber(bytes, frameLayout) ?? undefined;

      // If the native core answered, the camera buffer is described rather than
      // copied; otherwise the TypeScript builds the grid as it always has.
      const natPixels = nat ? cameraPixels(bytes, info) : null;
      const { pixels, grid } = nat && natPixels
        ? { pixels: natPixels, grid: nat.grid }
        : toWorkGrid(bytes, info, 320);
      const packMs = Date.now() - tPack;
      const sharp = lumaSource(bytes, info);
      const result = e.scanner.processFrame(
        bytes, info.width, info.height, 3,
        { gray: grid.gray, w: grid.w, h: grid.h, scale: grid.scale },
        sharp ? { ...sharp, scale: 1 } : undefined,
        pixels,
        nat && natPixels ? nat.components : undefined,
        describer,
      );
      const width = info.width;
      const height = info.height;

      const st = statsRef.current;
      st.frames++;
      st.pack += packMs;
      st.detect += result.timings.detect;
      st.describe += result.timings.describe;
      st.search += result.timings.search;
      st.reused += result.timings.reused;
      if (result.detection) st.detected++;
      if (result.preview) {
        st.matched++;
        st.bestDistance = result.preview.distance;
      }
      /*
       * The margin is the number that now decides acceptance, so it is the one
       * worth reading off a real device. The gate it replaced was set from
       * frames rendered on a desktop, which is exactly how it came to sit where
       * an empty table passes it.
       */
      if (result.nameMargin != null && Number.isFinite(result.nameMargin)) {
        st.margin = result.nameMargin;
      }
      if (result.detection && !result.preview) st.refused++;
      // How deep the multi-frame vote got. One means it is doing nothing.
      if (result.voteFrames != null) st.vote = Math.max(st.vote, result.voteFrames);
      /*
       * A capture was asked for and this is the frame that carries it.
       *
       * Written and shared off the frame thread deliberately - base64 of a
       * quarter-megabyte would drop frames if it ran here.
       */
      if (result.sample) {
        const note = {
          distance: st.bestDistance,
          margin: st.margin,
          vote: result.voteFrames,
          crop: result.crop,
          sections: st.sections,
          preview: result.preview?.card.n ?? null,
          fill: Math.round((result.detection?.areaFrac ?? 0) * 100),
        };
        const shot = { ...result.sample, note };
        setTimeout(() => { void onCaptured?.(shot); }, 0);
      }
      // What the crop calibration has settled on. Learned on the device, so it
      // can only be read on the device.
      if (result.crop) {
        const pc = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}`;
        st.crop = `${pc(result.crop.dx)}/${pc(result.crop.dy)}/${pc(result.crop.scale)}`;
      }
      // Which part of the descriptor disagrees says why a read is poor -
      // colour alone means channels, art alone means alignment, all four alike
      // means optics. Shown as a percentage so the four are comparable.
      if (result.sections) {
        st.sections = result.sections
          .map((x) => `${x.name} ${Math.round((x.d / x.of) * 100)}%`)
          .join(' ');
      }

      const now = Date.now();
      const dt = lastTickRef.current ? now - lastTickRef.current : 0;
      lastTickRef.current = now;
      if (dt > 0) fpsRef.current = fpsRef.current * 0.8 + (1000 / dt) * 0.2;

      // Redraw a few times a second, not on every frame. Each setState re-runs
      // the whole screen including the results list, on the same thread that
      // has to recognise the next frame.
      if (now - st.shownAt >= 500) {
        const n = st.frames || 1;
        const ms = (v: number) => Math.round(v / n);
        st.shownAt = now;
        setFps(fpsRef.current);
        setDiag(
          `${isNativeAvailable ? 'native' : 'js'}` +
          `${engine.nativeIndex ? '+idx' : ''} ${width}x${height} · ` +
          `frames ${st.frames} · found ${st.detected} · ` +
          `matched ${st.matched}` +
          (st.bestDistance >= 0 ? ` · d=${st.bestDistance}` : '') +
          (st.margin >= 0 ? ` m=${st.margin}` : '') +
          (st.refused ? ` · refused ${st.refused}` : '') +
          (st.vote ? ` · vote ${st.vote}` : '') +
          (st.crop ? ` · crop ${st.crop}` : '') +
          ` · pack ${ms(st.pack)} detect ${ms(st.detect)} desc ${ms(st.describe)} ` +
          `search ${ms(st.search)} ms · reused ${Math.round((st.reused / n) * 100)}%` +
          (st.sections ? ` · ${st.sections}` : ''),
        );
      }

      const area = result.detection?.areaFrac ?? 0;
      setFill((prev) => (Math.abs(prev - area) < 0.02 ? prev : area));

      if (result.preview) {
        const card = result.preview.card;
        setLive((prev) => (
          prev && prev.name === card.n && prev.set === card.S
            ? prev
            : { name: card.n, set: card.S, cardId: card.i, number: card.u }
        ));
      } else if (!result.detection) {
        setLive((prev) => (prev === null ? prev : null));
      }

      if (result.hit) {
        const hit = result.hit;
        // `onHit` returns the collection key it wrote to, so a row in the feed
        // can undo or redirect itself without searching the collection for a
        // card that may since have been merged into an existing pile.
        const entryKey = onHit(hit);
        onRecent((prev) => [
          {
            key: `${hit.card.i}-${seqRef.current++}`,
            entryKey,
            name: hit.card.n,
            set: hit.card.S,
            cardId: hit.card.i,
            number: hit.card.u,
            rarity: hit.card.r ?? null,
            price: hit.topMarket,
            unsure: !!hit.ambiguity,
            others: (hit.runnersUp ?? []).slice(0, 3).map((x) => ({
              cardId: x.card.i,
              name: x.card.n,
              set: x.card.S,
              number: x.card.u,
              rarity: x.card.r ?? null,
              price: x.topMarket,
            })),
          },
          ...prev,
        ].slice(0, 5));
        // Deliberately no prompt here. Interrupting a bulk scan with a modal
        // for every unresolved printing is the wrong trade for a workflow whose
        // whole point is passing cards quickly - the row carries a tappable
        // "check printing" tag instead, and can be settled whenever.
      }
    } catch (err) {
      // A bad frame must not take the app down - show what happened instead.
      const msg = String((err as Error)?.message ?? err);
      console.log(`[BulkSift] frame error: ${msg}`);
      setDiag(`frame error: ${msg}`);
    }
  }, []);

  /**
   * Receives one frame's pixels from the camera thread.
   *
   * `buffer` is a plain ArrayBuffer that the worklet runtime already copied for
   * us, so it outlives the Frame it came from and is safe to read here.
   */
  const deliver = useCallback(
    (buffer: ArrayBuffer, info: FrameInfo) => {
      try {
        const bytes = new Uint8Array(buffer);
        if (bytes.length === 0) {
          setDiag(
            `pixels arrived empty for ${info.pixelFormat} ${info.width}x${info.height} — ` +
            `the buffer did not survive the thread hop`,
          );
          return;
        }
        onPixels(bytes, info);
      } finally {
        busy.setBlocking(false);
      }
    },
    [onPixels, busy],
  );

  /** Something went wrong on the camera thread - say so and unblock. */
  const reportFrameProblem = useCallback(
    (msg: string) => {
      busy.setBlocking(false);
      console.log(`[BulkSift] ${msg}`);
      setDiag(msg);
    },
    [busy],
  );

  const onFrame = useMemo(() => {
    const handler = (frame: Frame) => {
      'worklet';
      try {
        if (!active.getBlocking() || busy.getBlocking()) return;

        if (typeof globalThis._createSerializable !== 'function') {
          busy.setBlocking(true);
          scheduleOnRN(
            reportFrameProblem,
            'worklet runtime has no _createSerializable — pixels cannot cross threads',
          );
          return;
        }

        if (frame.isPlanar || !frame.hasPixelBuffer) {
          busy.setBlocking(true);
          scheduleOnRN(
            reportFrameProblem,
            `camera delivered ${frame.pixelFormat}${frame.isPlanar ? ' (planar)' : ''} — ` +
            `an interleaved RGB format is required`,
          );
          return;
        }

        busy.setBlocking(true);
        // Serialise the pixels explicitly, then hand over the handle.
        //
        // `scheduleOnRN` cannot carry either a typed array or an ArrayBuffer by
        // itself: it walks arguments in JavaScript with `Object.entries`, which
        // yields every index of a typed array (millions of allocations - this
        // is what killed the app), and nothing at all for an ArrayBuffer (an
        // empty object - this is why the buffer arrived as 0 bytes). The native
        // serialiser underneath does understand ArrayBuffers and copies one
        // with a single memcpy, so it is called directly. The copy happens now,
        // synchronously, which is what makes disposing the frame below safe.
        const pixels = globalThis._createSerializable(
          frame.getPixelBuffer(),
          undefined,
        ) as ArrayBuffer;
        scheduleOnRN(deliver, pixels, {
          pixelFormat: frame.pixelFormat,
          width: frame.width,
          height: frame.height,
          bytesPerRow: frame.bytesPerRow,
        });
      } catch (e) {
        scheduleOnRN(reportFrameProblem, `frame error: ${String(e)}`);
      } finally {
        // Frames come from a fixed pool; holding one stalls the pipeline.
        frame.dispose();
      }
    };
    return handler;
  }, [active, busy, deliver, reportFrameProblem]);

  const frameOutput = useFrameOutput({
    targetResolution: TARGET_RESOLUTION,
    pixelFormat: 'rgb',
    dropFramesWhileBusy: true,
    onFrame,
  });

  const outputs = useMemo(() => [frameOutput], [frameOutput]);


  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <ScanIcon size={44} color={c.accent} />
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.muted}>
          BulkSift reads cards on this phone. No photo is uploaded and no
          account is required.
        </Text>
        <Button label="Grant access" kind="primary" onPress={() => void requestPermission()} />
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.accent} />
        <Text style={styles.muted}>
          {allDevices.length === 0 ? 'No camera found on this device.' : 'Looking for a camera…'}
        </Text>
      </View>
    );
  }

  const aim: Aim = fill >= GOOD_FILL ? 'good' : fill > 0 ? 'near' : 'idle';

  return (
    <View style={styles.root}>
      <ScanViewport>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          outputs={outputs}
          onError={(e) => setDiag(`camera error: ${e.message}`)}
        />
        <ScanOverlay
          aim={aim}
          live={live}
          fps={fps}
          onConfirm={(card) => {
            const rec = engine.byId.get(card.cardId);
            if (!rec) return;
            /*
             * Committed as a hit, through exactly the same path a confirmed
             * scan takes - so it costs an allowance, lands in the feed with its
             * runners-up, and can be undone or redirected like any other.
             *
             * The scanner is told about it as well, so the card it is currently
             * looking at does not get committed a second time when it finally
             * satisfies the accept rule on its own.
             */
            const variants = engine.scanner.pricesFor(rec.i);
            const best = variants.find((v) => v.market != null);
            const entryKey = onHit({
              card: rec,
              distance: 0,
              margin: 0,
              confidence: 1,
              variants,
              topMarket: best?.market ?? null,
              runnersUp: [],
            });
            if (!entryKey) return;
            engine.scanner.noteEmitted(rec.i);
            onRecent((prev) => [
              {
                key: `${rec.i}-${seqRef.current++}`,
                entryKey,
                name: rec.n,
                set: rec.S,
                cardId: rec.i,
                number: rec.u,
                rarity: rec.r ?? null,
                price: best?.market ?? null,
                unsure: false,
                others: [],
              },
              ...prev,
            ].slice(0, 5));
          }}
        />
      </ScanViewport>

      <ScanSummary
        value={sessionValue}
        count={sessionCount}
        scanning={scanning}
        onReset={onResetSession}
        onToggle={() => {
          const next = !scanning;
          setScanning(next);
          setDiag(next ? 'scanning ON — point at a card' : 'scanning OFF — camera only');
        }}
      />

      <ScanFeed
        rows={recent}
        onOpenCollection={onOpenCollection}
        onUndo={onUndo}
        onRedirect={onRedirect}
      />

      {selfTest ? (
        <View style={styles.selfTest}>
          {selfTest.map((l, i) => (
            <Text key={i} style={i === 0 ? styles.selfTestHead : styles.selfTestLine}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.diag} numberOfLines={4}>{diag}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: {
    flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center',
    padding: sp.xl, gap: sp.md,
  },
  title: { ...ty.title, color: c.text },
  muted: { ...ty.meta, color: c.dim, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
  diag: { ...ty.tiny, color: c.faint, paddingHorizontal: sp.md, paddingBottom: sp.sm },
  selfTest: {
    paddingHorizontal: sp.md, paddingVertical: sp.sm,
    borderTopWidth: 1, borderTopColor: c.lineSoft,
  },
  selfTestHead: { ...ty.tiny, color: c.money, fontWeight: '700' },
  selfTestLine: { fontSize: 10.5, color: c.dim },
});
