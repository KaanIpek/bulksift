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
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { c, money as fmtMoney, r as rd, s as sp, t as ty } from './ui/theme';
import CardImage from './ui/CardImage';
import { ScanIcon } from './ui/icons';
import { Badge, Button } from './ui/parts';
import { cameraPixels, lumaSource, toWorkGrid, type FrameInfo } from './frame';
import { isNativeAvailable, nativeDescriber, nativeStages } from '../modules/bulksift-detect';
import { runSelfTest } from './selfTest';

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
}: {
  engine: LoadedEngine;
  onHit: (hit: ScanHit) => void;
  sessionCount: number;
  sessionValue: number;
  onOpenCollection: () => void;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Prefer the rear camera, but fall back to whatever exists. Asking for 'back'
  // and stopping there kills the app on hardware that has no rear camera - some
  // tablets, and every emulator whose AVD only defines a front lens, where
  // CameraX fails with "No available camera can be found".
  const backDevice = useCameraDevice('back');
  const allDevices = useCameraDevices();
  const device = backDevice ?? allDevices[0];
  const [live, setLive] = useState<
    { name: string; set: string; setId: string; number: string } | null
  >(null);
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
    frames: 0, detected: 0, matched: 0, bestDistance: -1,
    pack: 0, detect: 0, describe: 0, search: 0, reused: 0, shownAt: 0,
    sections: '' ,
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
  const [recent, setRecent] = useState<Array<{
    key: string; name: string; set: string; setId: string; number: string;
    rarity: string | null; price: number | null; unsure: boolean;
  }>>([]);

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
            : { name: card.n, set: card.S, setId: card.s, number: card.u }
        ));
      } else if (!result.detection) {
        setLive((prev) => (prev === null ? prev : null));
      }

      if (result.hit) {
        const hit = result.hit;
        onHit(hit);
        setRecent((prev) => [
          {
            key: `${hit.card.i}-${seqRef.current++}`,
            name: hit.card.n,
            set: hit.card.S,
            setId: hit.card.s,
            number: hit.card.u,
            rarity: hit.card.r ?? null,
            price: hit.topMarket,
            unsure: !!hit.ambiguity,
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

  const aim: 'idle' | 'near' | 'good' =
    fill >= GOOD_FILL ? 'good' : fill > 0 ? 'near' : 'idle';
  const bracket = aim === 'good' ? c.good : aim === 'near' ? c.warn : 'rgba(242,244,249,0.5)';

  return (
    <View style={styles.root}>
      <View style={styles.cameraWrap}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          outputs={outputs}
          onError={(e) => setDiag(`camera error: ${e.message}`)}
        />

        {/*
          Corner brackets rather than a full rectangle.
          A closed outline invites you to line the card up with it; brackets
          say "somewhere in here", which is what the detector actually wants -
          it finds the quad itself, and the only thing that matters is that the
          card is big enough in frame. The measurements are blunt about that:
          a card at half the frame's width costs 256 bits of match quality,
          more than blur, white balance and glare put together.
        */}
        <View pointerEvents="none" style={styles.guideWrap}>
          <View style={styles.guide}>
            {([
              ['tl', { top: -2, left: -2 }],
              ['tr', { top: -2, right: -2 }],
              ['bl', { bottom: -2, left: -2 }],
              ['br', { bottom: -2, right: -2 }],
            ] as const).map(([id, pos]) => (
              <View
                key={id}
                style={[
                  styles.corner,
                  pos,
                  { borderColor: bracket },
                  id[0] === 't' ? styles.cornerTop : styles.cornerBottom,
                  id[1] === 'l' ? styles.cornerLeft : styles.cornerRight,
                ]}
              />
            ))}
          </View>
        </View>

        {/* What the engine is seeing right now, over the picture. */}
        <View pointerEvents="none" style={styles.hud}>
          {live ? (
            <>
              <CardImage
                setId={live.setId} number={live.number} width={30} radius={3}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.hudText} numberOfLines={1}>{live.name}</Text>
                <Text style={styles.hudSub} numberOfLines={1}>{live.set}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.hudText} numberOfLines={1}>
              {aim === 'near'
                ? 'Move closer — fill the brackets'
                : 'Pass a card through the frame'}
            </Text>
          )}
          <View style={[styles.fps, aim === 'good' && { borderColor: c.good }]}>
            <Text style={styles.fpsText}>{fps.toFixed(0)} fps</Text>
          </View>
        </View>
      </View>

      {/*
        The session, not the collection. What matters mid-scan is whether the
        last card landed and what the pile is worth so far; the collection tab
        is where any of it gets examined.
      */}
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>THIS SESSION</Text>
          <Text style={styles.total}>{fmtMoney(sessionValue)}</Text>
        </View>
        <View style={styles.countCol}>
          <Text style={styles.label}>CARDS</Text>
          <Text style={styles.count}>{sessionCount}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.pill, scanning ? styles.scanOn : styles.scanOff,
            pressed && { opacity: 0.75 },
          ]}
          onPress={() => {
            const next = !scanning;
            setScanning(next);
            setDiag(next ? 'scanning ON — point at a card' : 'scanning OFF — camera only');
          }}
        >
          {scanning
            ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
            : <ScanIcon size={16} color={c.onAccent} strong />}
          <Text style={[styles.pillText, !scanning && { color: c.onAccent }]}>
            {scanning ? 'Pause' : 'Resume'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.feedWrap}>
        {recent.length ? (
          <>
            <View style={styles.feedHeadRow}>
              <Text style={styles.feedHead}>JUST SCANNED</Text>
              <Pressable onPress={onOpenCollection} hitSlop={8}>
                <Text style={styles.link}>Open collection</Text>
              </Pressable>
            </View>
            {recent.map((x) => (
              <View key={x.key} style={styles.feedRow}>
                <CardImage
                  setId={x.setId} number={x.number} rarity={x.rarity} width={32} radius={3}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.feedName} numberOfLines={1}>{x.name}</Text>
                  <Text style={styles.feedMeta} numberOfLines={1}>
                    {x.set} · #{x.number}
                  </Text>
                </View>
                {x.unsure ? <Badge label="CHECK" tone="warn" /> : null}
                <Text style={styles.feedPrice}>{fmtMoney(x.price)}</Text>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.idleWrap}>
            <Text style={styles.idleTitle}>Prop the phone up and start passing</Text>
            <Text style={styles.feedIdle}>
              Each card lands in your collection with its price. It reads
              continuously — there is no button to press per card.
            </Text>
          </View>
        )}
      </View>

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

  cameraWrap: { height: '44%', backgroundColor: '#05070c' },
  guideWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  guide: { height: '82%', aspectRatio: 2.5 / 3.5 },
  corner: { position: 'absolute', width: 30, height: 30, borderWidth: 3 },
  cornerTop: { borderBottomWidth: 0 },
  cornerBottom: { borderTopWidth: 0 },
  cornerLeft: { borderRightWidth: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  cornerRight: { borderLeftWidth: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10 },

  hud: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: sp.md, paddingVertical: sp.sm,
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: 'rgba(5,7,12,0.72)',
  },
  hudText: { ...ty.body, color: c.text, flex: 1 },
  hudSub: { ...ty.tiny, color: c.dim, marginTop: 1 },
  fps: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: rd.sm,
    borderWidth: 1, borderColor: c.line, backgroundColor: 'rgba(8,9,13,0.6)',
  },
  fpsText: { ...ty.tiny, color: c.dim, fontVariant: ['tabular-nums'] },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: sp.lg,
    paddingHorizontal: sp.lg, paddingVertical: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  label: { ...ty.section, color: c.faint },
  total: {
    fontSize: 26, fontWeight: '800', color: c.money, letterSpacing: -0.6,
    fontVariant: ['tabular-nums'], marginTop: 2,
  },
  countCol: { alignItems: 'flex-end' },
  count: {
    fontSize: 22, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: sp.lg, paddingVertical: 11,
    borderRadius: rd.pill, borderWidth: 1,
  },
  scanOn: { backgroundColor: c.surfaceHi, borderColor: c.line },
  scanOff: { backgroundColor: c.accent, borderColor: c.accent },
  pillText: { ...ty.body, color: c.text, fontWeight: '800' },
  pauseGlyph: { flexDirection: 'row', gap: 3 },
  pauseBar: { width: 3.5, height: 13, borderRadius: 2, backgroundColor: c.text },

  feedWrap: { flex: 1, paddingHorizontal: sp.lg, paddingTop: sp.md },
  feedHeadRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: sp.sm,
  },
  feedHead: { ...ty.section, color: c.faint },
  feedRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  feedName: { ...ty.body, color: c.text },
  feedMeta: { ...ty.meta, color: c.dim, marginTop: 1 },
  feedPrice: { ...ty.money, color: c.money },
  link: { ...ty.tiny, color: c.accent, fontWeight: '800' },
  idleWrap: { paddingTop: sp.xl, paddingHorizontal: sp.md, gap: sp.sm },
  idleTitle: { ...ty.subtitle, color: c.text, textAlign: 'center' },
  feedIdle: { ...ty.meta, color: c.faint, textAlign: 'center', lineHeight: 19 },

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
