/**
 * A card's picture.
 *
 * Every app in this category is built on card art, and this one had none: rows
 * of text where a collector expects to see the card. That is the difference
 * between a database and something worth opening.
 *
 * The picture comes off the device, not the network. The catalogue's image host
 * looked like the obvious source and is not a dependable one: asked for a card
 * from a 2026 set it answers 200 OK with a picture of a card *back*, so there
 * is no error to catch and the app shows the wrong card confidently. Cards from
 * Chaos Rising, Ascended Heroes and Black Bolt all did that on a device. So
 * every thumbnail ships with the app - see `thumbs.ts`.
 *
 * What this deliberately does not do is retry. A card whose picture is missing
 * from the pack - there are two, the Unown numbered "!" and "?" - shows a slot
 * in its rarity colour with its number, which is a legible, deliberate-looking
 * thing rather than a grey hole.
 *
 * The proportions are the real ones: a Pokémon card is 63 x 88 mm, which the
 * catalogue's own images keep at 245 x 342.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { logoUrl, symbolUrl } from './art';
import { c, rarityTone, t } from './theme';
import { cachedThumb, thumbUri } from './thumbs';

/** Height for a given width, at the real card ratio. */
export const CARD_RATIO = 342 / 245;
export const cardHeight = (width: number) => Math.round(width * CARD_RATIO);

export default function CardImage({
  cardId,
  number,
  width,
  rarity,
  radius,
  dim,
}: {
  /** The catalogue id. Not derivable from set and number - 26 cards differ. */
  cardId: string;
  /** Printed collector number, shown when there is no picture. */
  number: string;
  width: number;
  rarity?: string | null;
  radius?: number;
  /** Draw it knocked back, for cards you do not own yet. */
  dim?: boolean;
}) {
  // Start from the cache so a row that has been seen draws its picture on the
  // first paint rather than flashing an empty slot on every scroll.
  const [uri, setUri] = useState<string | null>(() => cachedThumb(cardId));
  const height = cardHeight(width);
  const rad = radius ?? Math.max(3, Math.round(width * 0.055));

  useEffect(() => {
    const ready = cachedThumb(cardId);
    if (ready) { setUri(ready); return; }
    let live = true;
    setUri(null);
    void thumbUri(cardId).then((u) => { if (live) setUri(u); });
    return () => { live = false; };
  }, [cardId]);

  const frame = {
    width, height, borderRadius: rad,
    backgroundColor: c.slot,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.line,
    overflow: 'hidden' as const,
    opacity: dim ? 0.45 : 1,
  };

  if (!uri) {
    return (
      <View style={[frame, styles.fallback]}>
        <View style={[styles.pip, { backgroundColor: rarityTone(rarity) }]} />
        <Text style={styles.fallbackNum} numberOfLines={1}>{number}</Text>
      </View>
    );
  }

  return (
    <View style={frame}>
      <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  pip: { width: 7, height: 7, borderRadius: 4 },
  fallbackNum: { ...t.tiny, color: c.faint },
});

/**
 * A set's symbol and logo still come from the network.
 *
 * They are one image per set rather than one per card, they are decoration on a
 * screen that reads fine without them, and bundling 174 more files to save a
 * few kilobytes of traffic is not a trade worth making. Both fall back to
 * nothing rather than to a placeholder.
 */
export function SetSymbol({ setId, size = 18 }: { setId: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [setId]);
  if (failed) return <View style={{ width: size, height: size }} />;
  return (
    <Image
      source={{ uri: symbolUrl(setId) }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

/** A set's logo. Falls back to the set's name, which is what a logo says anyway. */
export function SetLogo({
  setId, name, width, height = 42,
}: { setId: string; name: string; width: number; height?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [setId]);
  if (failed) {
    return (
      <View style={[logoStyles.wrap, { width, height }]}>
        <Text style={logoStyles.name} numberOfLines={2}>{name}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: logoUrl(setId) }}
      style={{ width, height }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

const logoStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  name: { ...t.subtitle, color: c.text, textAlign: 'center' },
});
