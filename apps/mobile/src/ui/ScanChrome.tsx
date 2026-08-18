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

import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import CardImage from './CardImage';
import { CheckIcon, ChevronIcon, ScanIcon, TrashIcon } from './icons';
import { Badge } from './parts';
import { c, money, r, s, t } from './theme';

/** How well the card is framed, which is the one thing the user controls. */
export type Aim = 'idle' | 'near' | 'good';

export interface Candidate {
  cardId: string;
  name: string;
  set: string;
  number: string;
  rarity: string | null;
  price: number | null;
}

export interface ScannedRow {
  key: string;
  /** Collection entry key, so a row can be removed or replaced. */
  entryKey: string;
  name: string;
  set: string;
  cardId: string;
  number: string;
  rarity: string | null;
  price: number | null;
  unsure: boolean;
  /** What the matcher's next best answers were. */
  others: Candidate[];
}

export interface LiveCard {
  name: string;
  set: string;
  cardId: string;
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
  aim, live, fps, onConfirm,
}: {
  aim: Aim;
  live: LiveCard | null;
  fps: number;
  /**
   * Take the card the engine is currently showing, without waiting for it to be
   * sure.
   *
   * On a real phone the margin between the winner and the next different card
   * runs at 2 to 15 bits where the fixtures give 146, so the accept rule refuses
   * the great majority of frames - 16,181 of 17,746 in one session. The engine
   * is often looking straight at the right card and declining to commit it.
   *
   * The person holding the card can see the answer on screen and knows whether
   * it is right. This lets them say so. It is not a workaround for a bad
   * recogniser so much as an admission that they have information the
   * recogniser does not.
   */
  onConfirm?: (card: LiveCard) => void;
}) {
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

      {/*
        * The coaching line, weighted by how it is going.
        *
        * This is the only thing standing between someone and a good scan, and
        * it used to be the same flat grey whether the card was perfectly framed
        * or not in shot at all. Distance is what people get wrong - the
        * measurements say a card at half the frame's width costs more match
        * quality than blur, white balance and glare put together - so "too far"
        * is the state that gets the loud colour.
        *
        * The second line only appears when nothing is being seen. Once a card
        * is in the brackets it would be advice about a problem already solved.
        */}
      <View pointerEvents="none" style={[styles.hud, { borderTopColor: bracket }]}>
        {live ? (
          <>
            <CardImage cardId={live.cardId} number={live.number} width={30} radius={3} />
            <View style={{ flex: 1 }}>
              <Text style={styles.hudText} numberOfLines={1}>{live.name}</Text>
              <Text style={styles.hudSub} numberOfLines={1}>{live.set}</Text>
            </View>
          </>
        ) : (
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.hudText, aim === 'near' ? { color: c.warn } : null]}
              numberOfLines={1}
            >
              {aim === 'near'
                ? 'Closer — fill the brackets'
                : aim === 'good'
                  ? 'Hold it there'
                  : 'Pass a card through the frame'}
            </Text>
            {aim === 'idle' ? (
              <Text style={styles.hudSub} numberOfLines={1}>
                A plain dark surface reads best — lay the card flat
              </Text>
            ) : null}
          </View>
        )}
        <View style={[styles.fps, aim === 'good' && { borderColor: c.good }]}>
          <Text style={styles.fpsText}>{fps.toFixed(0)} fps</Text>
        </View>
      </View>

      {live && onConfirm ? (
        <Pressable
          onPress={() => onConfirm(live)}
          style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.8 }]}
        >
          <CheckIcon size={16} color={c.onAccent} strong />
          <Text style={styles.confirmText}>That&apos;s my card — add it</Text>
        </Pressable>
      ) : null}
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
  value, count, scanning, scansLeft, onToggle, onReset,
}: {
  value: number; count: number; scanning: boolean;
  /**
   * Scans remaining today, or null when there is no limit.
   *
   * On screen because the competition's worst reviews are about running into a
   * wall without warning - "it only lets me scan 3 cards?!?!?! Thats dumb" is
   * the top critical review of the fastest scanner in the category. This app
   * gives thirty a day free and ten more per video, which is a real difference
   * and was invisible at exactly the moment it mattered. A number that is going
   * down in front of you is also a fair warning, which a paywall appearing
   * mid-pile is not.
   */
  scansLeft: number | null;
  onToggle: () => void;
  /** Start the tally again. Deliberately a hold, not a tap. */
  onReset: () => void;
}) {
  return (
    <View style={styles.summary}>
      {/*
        Resetting is a long press rather than a button.
        The session used to reset itself whenever you left the tab, which meant
        the totals you were watching vanished if you so much as looked at your
        collection. Now it runs until you say otherwise - and saying otherwise
        needs to be deliberate, because it is not undoable.
      */}
      <Pressable onLongPress={onReset} delayLongPress={600} style={{ flex: 1 }}>
        <Text style={styles.label}>THIS SESSION</Text>
        <Text style={styles.total}>{money(value)}</Text>
        <Text style={styles.resetHint}>hold to start over</Text>
      </Pressable>
      <View style={styles.countCol}>
        <Text style={styles.label}>CARDS</Text>
        <Text style={styles.count}>{count}</Text>
        {scansLeft != null ? (
          <Text
            style={[styles.leftText, scansLeft <= 5 ? { color: c.warn } : null]}
            numberOfLines={1}
          >
            {scansLeft} left today
          </Text>
        ) : null}
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
  rows, onOpenCollection, onUndo, onRedirect,
}: {
  rows: ScannedRow[];
  onOpenCollection: () => void;
  onUndo: (entryKey: string) => void;
  onRedirect: (entryKey: string, cardId: string) => string;
}) {
  /*
   * Which row is open for correction.
   *
   * A bulk scan is a stream of small decisions the machine makes for you, and
   * some of them are wrong - a misread costs nothing to the total and is still
   * a card you do not own sitting in your collection. You can see it is wrong
   * from the picture in a quarter of a second; the only thing missing was a way
   * to say so without leaving the screen and hunting for it in a list of four
   * hundred.
   */
  const [open, setOpen] = useState<string | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});

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

  const keyFor = (x: ScannedRow) => keys[x.key] ?? x.entryKey;

  return (
    <ScrollView
      style={styles.feedWrap}
      contentContainerStyle={{ paddingBottom: s.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.feedHeadRow}>
        <Text style={styles.feedHead}>JUST SCANNED</Text>
        <Pressable onPress={onOpenCollection} hitSlop={8}>
          <Text style={styles.link}>Open collection</Text>
        </Pressable>
      </View>

      {rows.map((x) => {
        const isOpen = open === x.key;
        return (
          <View key={x.key}>
            <Pressable
              onPress={() => setOpen(isOpen ? null : x.key)}
              style={({ pressed }) => [
                styles.feedRow, (pressed || isOpen) && styles.feedRowOn,
              ]}
            >
              <CardImage
                cardId={x.cardId} number={x.number} rarity={x.rarity} width={32} radius={3}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.feedName} numberOfLines={1}>{x.name}</Text>
                <Text style={styles.feedMeta} numberOfLines={1}>{x.set} · #{x.number}</Text>
              </View>
              {x.unsure ? <Badge label="CHECK" tone="warn" /> : null}
              <Text style={styles.feedPrice}>{money(x.price)}</Text>
              <ChevronIcon size={13} color={c.faint} dir={isOpen ? 'up' : 'down'} />
            </Pressable>

            {isOpen ? (
              <View style={styles.fixWrap}>
                <Text style={styles.fixLabel}>NOT THIS CARD?</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.fixRow}
                >
                  {x.others.map((alt) => (
                    <Pressable
                      key={alt.cardId}
                      onPress={() => {
                        setKeys((prev) => ({
                          ...prev, [x.key]: onRedirect(keyFor(x), alt.cardId),
                        }));
                        setOpen(null);
                      }}
                      style={({ pressed }) => [styles.fixCard, pressed && { opacity: 0.7 }]}
                    >
                      <CardImage
                        cardId={alt.cardId} number={alt.number} rarity={alt.rarity}
                        width={54} radius={4}
                      />
                      <Text style={styles.fixName} numberOfLines={1}>{alt.name}</Text>
                      <Text style={styles.fixPrice}>{money(alt.price)}</Text>
                    </Pressable>
                  ))}
                  {!x.others.length ? (
                    <Text style={styles.fixNone}>
                      Nothing else came close on that read.
                    </Text>
                  ) : null}
                </ScrollView>
                <Pressable
                  onPress={() => { onUndo(keyFor(x)); setOpen(null); }}
                  style={({ pressed }) => [styles.remove, pressed && { opacity: 0.7 }]}
                >
                  <TrashIcon size={14} color={c.bad} />
                  <Text style={styles.removeText}>Not a card — take it back off</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
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

  /*
   * Above the readout rather than inside it: the readout names the card and
   * this acts on it, and a control that commits something to a collection
   * should not sit on the same line as a label.
   */
  confirm: {
    position: 'absolute', left: s.md, right: s.md, bottom: HUD_H + s.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 11, borderRadius: r.pill,
    backgroundColor: c.accent,
  },
  confirmText: { ...t.body, color: c.onAccent, fontWeight: '800' },
  hud: {
    position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: HUD_H,
    paddingHorizontal: s.md, paddingVertical: s.sm,
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: 'rgba(5,7,12,0.72)',
    // The same colour as the brackets, so framing reads as one signal rather
    // than two things that happen to change at the same time.
    borderTopWidth: 2,
  },
  hudText: { ...t.body, color: c.text, flex: 1 },
  hudSub: { ...t.tiny, color: c.dim, marginTop: 1 },
  fps: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: r.sm,
    borderWidth: 1, borderColor: c.line, backgroundColor: 'rgba(8,9,13,0.6)',
  },
  fpsText: { ...t.tiny, color: c.dim, fontVariant: ['tabular-nums'] },
  leftText: { ...t.tiny, color: c.faint, marginTop: 2, fontVariant: ['tabular-nums'] },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: s.lg,
    paddingHorizontal: s.lg, paddingVertical: s.md,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  label: { ...t.section, color: c.faint },
  resetHint: { ...t.tiny, fontSize: 9.5, color: c.faint, opacity: 0.7, marginTop: 1 },
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
    paddingHorizontal: 6, marginHorizontal: -6, borderRadius: r.sm,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  feedRowOn: { backgroundColor: c.surface },
  fixWrap: {
    backgroundColor: c.surface, borderRadius: r.md, padding: s.md, marginBottom: s.sm,
    borderWidth: 1, borderColor: c.lineSoft, gap: s.sm,
  },
  fixLabel: { ...t.section, color: c.faint },
  fixRow: { gap: s.md, paddingRight: s.sm },
  fixCard: { width: 54, gap: 3 },
  fixName: { ...t.tiny, color: c.dim },
  fixPrice: { ...t.tiny, color: c.money, fontWeight: '800' },
  fixNone: { ...t.tiny, color: c.faint, paddingVertical: s.lg },
  remove: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: r.sm, backgroundColor: c.badWash,
  },
  removeText: { ...t.tiny, color: c.bad, fontWeight: '800' },
  feedName: { ...t.body, color: c.text },
  feedMeta: { ...t.meta, color: c.dim, marginTop: 1 },
  feedPrice: { ...t.money, color: c.money },
  link: { ...t.tiny, color: c.accent, fontWeight: '800' },
  idleWrap: { paddingTop: s.xl, paddingHorizontal: s.md, gap: s.sm },
  idleTitle: { ...t.subtitle, color: c.text, textAlign: 'center' },
  feedIdle: { ...t.meta, color: c.faint, textAlign: 'center', lineHeight: 19 },
});
