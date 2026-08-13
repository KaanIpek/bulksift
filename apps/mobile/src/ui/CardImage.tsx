/**
 * A card's picture.
 *
 * Every app in this category is built on card art, and this one had none: rows
 * of text where a collector expects to see the card. That is the difference
 * between a database and something worth opening.
 *
 * Three things this deliberately does *not* do:
 *
 *  - It does not bundle the art. 20,444 cards is four gigabytes, and even a
 *    thumbnail pack is tens of megabytes for pictures that are decoration.
 *  - It does not let a missing picture break a row. The network can be off -
 *    recognition and prices are on-device and stay that way - so a card with no
 *    art shows a slot in its rarity colour with its number, which is still a
 *    legible, deliberate-looking thing rather than a grey hole.
 *  - It does not retry. A failed image stays failed for that mount; a list that
 *    re-requests 200 missing pictures while you scroll is worse than no
 *    pictures at all.
 *
 * The proportions are the real ones: a Pokémon card is 63 x 88 mm, which the
 * catalogue's own images keep at 245 x 342.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { artUrl, c, rarityTone, t } from './theme';

/** Height for a given width, at the real card ratio. */
export const CARD_RATIO = 342 / 245;
export const cardHeight = (width: number) => Math.round(width * CARD_RATIO);

export default function CardImage({
  setId,
  number,
  width,
  rarity,
  hires = false,
  radius,
  dim,
}: {
  setId: string;
  number: string;
  width: number;
  rarity?: string | null;
  /** Ask for the large scan. Worth it for a card filling half the screen. */
  hires?: boolean;
  radius?: number;
  /** Draw it knocked back, for cards you do not own yet. */
  dim?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const height = cardHeight(width);
  const rad = radius ?? Math.max(3, Math.round(width * 0.055));

  // A recycled row can be handed a different card, and a previous failure must
  // not follow it there.
  useEffect(() => { setFailed(false); }, [setId, number, hires]);

  const frame = {
    width, height, borderRadius: rad,
    backgroundColor: c.slot,
    borderWidth: StyleSheet.hairlineWidth, borderColor: c.line,
    overflow: 'hidden' as const,
    opacity: dim ? 0.45 : 1,
  };

  if (failed) {
    return (
      <View style={[frame, styles.fallback]}>
        <View style={[styles.pip, { backgroundColor: rarityTone(rarity) }]} />
        <Text style={styles.fallbackNum} numberOfLines={1}>
          {number}
        </Text>
      </View>
    );
  }

  return (
    <View style={frame}>
      <Image
        source={{ uri: artUrl(setId, number, hires) }}
        style={{ width, height }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  pip: { width: 7, height: 7, borderRadius: 4 },
  fallbackNum: { ...t.tiny, color: c.faint },
});

/**
 * A set's symbol, which is tiny and often has no transparency to spare.
 *
 * Shown at a fixed 18 px because that is roughly how big it is printed on the
 * card, and any bigger it just looks like a blurry stamp.
 */
export function SetSymbol({ setId, size = 18 }: { setId: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [setId]);
  if (failed) return <View style={{ width: size, height: size }} />;
  return (
    <Image
      source={{ uri: `https://images.pokemontcg.io/${setId}/symbol.png` }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A set's logo. Falls back to the set's name, which is what a logo says anyway.
 */
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
      source={{ uri: `https://images.pokemontcg.io/${setId}/logo.png` }}
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
