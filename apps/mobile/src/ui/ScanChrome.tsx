/**
 * Everything on the scan screen that is not the camera.
 *
 * Split out for one reason: the camera cannot mount in a browser, so with this
 * markup inside ScannerScreen the app's most-used screen was the one screen
 * that could never be looked at between ten-minute device builds. Its layout
 * was being written blind and shipped on faith. Here it takes plain props, so
 * the web build renders it with a placeholder where the picture goes and every
 * state - nothing seen, card in view, five cards deep - can be checked in a
 * phone-sized frame before it is built.
 *
 * ScannerScreen keeps all of the camera and engine work. Nothing in this file
 * knows what a frame is.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import CardImage from './CardImage';
import { ScanIcon } from './icons';
import { Badge } from './parts';
import { c, money, r, s, t } from './theme';

/** How well the card is framed, which is the one thing the user controls. */
export type Aim = 'idle' | 'near' | 'good';

export interface ScannedRow {
  key: string;
  name: string;
  set: string;
  setId: string;
  number: string;
  rarity: string | null;
  price: number | null;
  unsure: boolean;
}

export interface LiveCard {
  name: string;
  set: string;
  setId: string;
  number: string;
}

/**
 * The overlay drawn on top of the camera picture.
 *
 * Corner brackets rather than a closed rectangle. An outline invites you to
 * line the card up with it; brackets say "somewhere in here", which is what
 * the detector actually wants - it finds the quad itself, and the only thing
 * that matters is that the card is big enough in frame. The measurements are
 * blunt about that: a card at half the frame's width costs 256 bits of match
 * quality, more than blur, white balance and glare put together.
 */
export function ScanOverlay({
  aim, live, fps,
}: { aim: Aim; live: LiveCard | null; fps: number }) {
  const bracket = aim === 'good' ? c.good : aim === 'near' ? c.warn : 'rgba(242,244,249,0.5)';
  return (
    <>
      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={styles.guide}>
          {CORNERS.map(([id, pos]) => (
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

      <View pointerEvents="none" style={styles.hud}>
        {live ? (
          <>
            <CardImage setId={live.setId} number={live.number} width={30} radius={3} />
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
    </>
  );
}

const CORNERS = [
  ['tl', { top: -2, left: -2 }],
  ['tr', { top: -2, right: -2 }],
  ['bl', { bottom: -2, left: -2 }],
  ['br', { bottom: -2, right: -2 }],
] as const;

/**
 * The session, not the collection.
 *
 * What matters mid-scan is whether the last card landed and what the pile is
 * worth so far; the collection tab is where any of it gets examined.
 */
export function ScanSummary({
  value, count, scanning, onToggle,
}: { value: number; count: number; scanning: boolean; onToggle: () => void }) {
  return (
    <View style={styles.summary}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>THIS SESSION</Text>
        <Text style={styles.total}>{money(value)}</Text>
      </View>
      <View style={styles.countCol}>
        <Text style={styles.label}>CARDS</Text>
        <Text style={styles.count}>{count}</Text>
      </View>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.pill, scanning ? styles.scanOn : styles.scanOff,
          pressed && { opacity: 0.75 },
        ]}
      >
        {scanning ? (
          <View style={styles.pauseGlyph}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : (
          <ScanIcon size={16} color={c.onAccent} strong />
        )}
        <Text style={[styles.pillText, !scanning && { color: c.onAccent }]}>
          {scanning ? 'Pause' : 'Resume'}
        </Text>
      </Pressable>
    </View>
  );
}

export function ScanFeed({
  rows, onOpenCollection,
}: { rows: ScannedRow[]; onOpenCollection: () => void }) {
  if (!rows.length) {
    return (
      <View style={styles.feedWrap}>
        <View style={styles.idleWrap}>
          <Text style={styles.idleTitle}>Prop the phone up and start passing</Text>
          <Text style={styles.feedIdle}>
            Each card lands in your collection with its price. It reads
            continuously — there is no button to press per card.
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.feedWrap}>
      <View style={styles.feedHeadRow}>
        <Text style={styles.feedHead}>JUST SCANNED</Text>
        <Pressable onPress={onOpenCollection} hitSlop={8}>
          <Text style={styles.link}>Open collection</Text>
        </Pressable>
      </View>
      {rows.map((x) => (
        <View key={x.key} style={styles.feedRow}>
          <CardImage
            setId={x.setId} number={x.number} rarity={x.rarity} width={32} radius={3}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.feedName} numberOfLines={1}>{x.name}</Text>
            <Text style={styles.feedMeta} numberOfLines={1}>{x.set} · #{x.number}</Text>
          </View>
          {x.unsure ? <Badge label="CHECK" tone="warn" /> : null}
          <Text style={styles.feedPrice}>{money(x.price)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The camera's slot: a fixed share of the screen, whatever fills it. */
export function ScanViewport({ children }: { children: ReactNode }) {
  return <View style={styles.cameraWrap}>{children}</View>;
}

/** How tall the readout strip is, so the framing guide can sit clear of it. */
const HUD_H = 50;

const styles = StyleSheet.create({
  cameraWrap: { height: '44%', backgroundColor: '#05070c' },
  /*
   * The guide centres in the picture *above* the readout, not in the whole
   * picture. Centred in the whole thing, its two bottom brackets landed behind
   * the readout bar and were invisible - which is the half of the frame you
   * are actually aiming at when you slide a card in from below.
   */
  guideWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    paddingBottom: HUD_H, paddingTop: s.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  guide: { height: '94%', aspectRatio: 2.5 / 3.5 },
  corner: { position: 'absolute', width: 30, height: 30, borderWidth: 3 },
  cornerTop: { borderBottomWidth: 0 },
  cornerBottom: { borderTopWidth: 0 },
  cornerLeft: { borderRightWidth: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  cornerRight: { borderLeftWidth: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10 },

  hud: {
    position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: HUD_H,
    paddingHorizontal: s.md, paddingVertical: s.sm,
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: 'rgba(5,7,12,0.72)',
  },
  hudText: { ...t.body, color: c.text, flex: 1 },
  hudSub: { ...t.tiny, color: c.dim, marginTop: 1 },
  fps: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: r.sm,
    borderWidth: 1, borderColor: c.line, backgroundColor: 'rgba(8,9,13,0.6)',
  },
  fpsText: { ...t.tiny, color: c.dim, fontVariant: ['tabular-nums'] },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: s.lg,
    paddingHorizontal: s.lg, paddingVertical: s.md,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  label: { ...t.section, color: c.faint },
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
    paddingHorizontal: s.lg, paddingVertical: 11,
    borderRadius: r.pill, borderWidth: 1,
  },
  scanOn: { backgroundColor: c.surfaceHi, borderColor: c.line },
  scanOff: { backgroundColor: c.accent, borderColor: c.accent },
  pillText: { ...t.body, color: c.text, fontWeight: '800' },
  pauseGlyph: { flexDirection: 'row', gap: 3 },
  pauseBar: { width: 3.5, height: 13, borderRadius: 2, backgroundColor: c.text },

  feedWrap: { flex: 1, paddingHorizontal: s.lg, paddingTop: s.md },
  feedHeadRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: s.sm,
  },
  feedHead: { ...t.section, color: c.faint },
  feedRow: {
    flexDirection: 'row', alignItems: 'center', gap: s.md, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  feedName: { ...t.body, color: c.text },
  feedMeta: { ...t.meta, color: c.dim, marginTop: 1 },
  feedPrice: { ...t.money, color: c.money },
  link: { ...t.tiny, color: c.accent, fontWeight: '800' },
  idleWrap: { paddingTop: s.xl, paddingHorizontal: s.md, gap: s.sm },
  idleTitle: { ...t.subtitle, color: c.text, textAlign: 'center' },
  feedIdle: { ...t.meta, color: c.faint, textAlign: 'center', lineHeight: 19 },
});
