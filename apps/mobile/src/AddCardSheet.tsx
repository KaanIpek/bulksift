/**
 * Adding a card by hand.
 *
 * The scanner cannot do every card - sleeved, slabbed, damaged past
 * recognition, or simply not in front of you - so this is the other way in, and
 * it was the weaker one: Browse's "+" picked the priciest variant, assumed Near
 * Mint, added exactly one copy, and said nothing about where it went. Every one
 * of those four is a guess, and three of them change what the card is worth.
 *
 * So this asks. It is still one screen and one button, because the common case
 * really is "one Near Mint copy of the obvious printing" - the defaults are the
 * old behaviour, and everything else is one tap away rather than impossible.
 *
 * It also names the collection. With several of them the same action can mean
 * two different things, and an add that does not say which box it went into is
 * the kind of quiet wrong that is only discovered when a total looks off.
 */

import { useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';

import type { CardRecord, PricedVariant } from '@bulksift/core';
import {
  CONDITIONS, CONDITION_NOTE, conditionOf, defaultVariant, type ConditionId,
} from './collection';
import type { Library } from './library';
import CardImage from './ui/CardImage';
import { CheckIcon, CloseIcon } from './ui/icons';
import { Badge, Button, Chip, SectionLabel, Stepper } from './ui/parts';
import { c, money, r, rarityTone, s, shadow, t } from './ui/theme';

export interface AddTarget {
  card: CardRecord;
  variants: PricedVariant[];
}

export default function AddCardSheet({
  target,
  library,
  onClose,
  onAdd,
}: {
  target: AddTarget | null;
  library: Library;
  onClose: () => void;
  onAdd: (
    card: CardRecord,
    variant: string,
    price: number | null,
    condition: ConditionId,
    quantity: number,
    collectionId: string,
  ) => void;
}) {
  const { width } = useWindowDimensions();
  const [variant, setVariant] = useState<string | null>(null);
  const [condition, setCondition] = useState<ConditionId>('NM');
  const [quantity, setQuantity] = useState(1);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const picked = useMemo(() => {
    if (!target) return null;
    const fallback = defaultVariant(target.variants);
    const name = variant ?? fallback.name;
    const found = target.variants.find((v) => v.variant === name);
    return { name, price: found?.market ?? fallback.price };
  }, [target, variant]);

  if (!target || !picked) return null;

  const card = target.card;
  const artW = Math.min(120, Math.round(width * 0.3));
  const cond = conditionOf(condition);
  const into = collectionId ?? library.activeId;
  const intoName = library.collections.find((x) => x.id === into)?.name ?? '';
  const each = picked.price == null ? null : picked.price * cond.multiplier;
  const total = each == null ? null : each * quantity;

  const reset = () => {
    setVariant(null);
    setCondition('NM');
    setQuantity(1);
    setCollectionId(null);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <CloseIcon size={17} color={c.dim} />
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: s.lg }}>
          <View style={styles.head}>
            <View style={shadow.high}>
              <CardImage
                cardId={card.i} number={card.u} rarity={card.r} width={artW} radius={r.sm}
              />
            </View>
            <View style={styles.headBody}>
              <Text style={styles.name} numberOfLines={2}>{card.n}</Text>
              <Text style={styles.sub} numberOfLines={2}>{card.S} · #{card.u}</Text>
              {card.r ? (
                <View style={styles.rarityRow}>
                  <View style={[styles.pip, { backgroundColor: rarityTone(card.r) }]} />
                  <Text style={styles.rarity}>{card.r}</Text>
                </View>
              ) : null}
              <Text style={styles.value}>{money(total)}</Text>
              <Text style={styles.valueNote}>
                {quantity} × {money(each)}
                {cond.multiplier !== 1 ? ` (${cond.id})` : ''}
              </Text>
            </View>
          </View>

          <SectionLabel>Printing</SectionLabel>
          <View style={styles.wrap}>
            {target.variants.length ? (
              target.variants.map((v) => (
                <Chip
                  key={v.variant}
                  label={`${v.variant} · ${money(v.market)}`}
                  active={v.variant === picked.name}
                  onPress={() => setVariant(v.variant)}
                />
              ))
            ) : (
              <Text style={styles.note}>No price on record for this card.</Text>
            )}
          </View>

          <SectionLabel>Condition</SectionLabel>
          <View style={styles.wrap}>
            {CONDITIONS.map((k) => (
              <Chip
                key={k.id}
                label={k.id === 'NM' ? k.label : `${k.label} ·${Math.round(k.multiplier * 100)}%`}
                active={k.id === condition}
                onPress={() => setCondition(k.id)}
              />
            ))}
          </View>
          <Text style={styles.note}>{CONDITION_NOTE}</Text>

          {/*
            Only shown when there is a choice to make. A picker with one option
            is a control that teaches you nothing and costs a line of screen.
          */}
          {library.collections.length > 1 ? (
            <>
              <SectionLabel>Add to</SectionLabel>
              <View style={styles.wrap}>
                {library.collections.map((col) => (
                  <Chip
                    key={col.id}
                    label={col.name}
                    active={col.id === into}
                    onPress={() => setCollectionId(col.id)}
                    icon={col.id === into
                      ? <CheckIcon size={12} color={c.accent} strong />
                      : undefined}
                  />
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.qtyRow}>
            <View>
              <Text style={styles.qtyLabel}>HOW MANY</Text>
              <Text style={styles.qtyHint}>
                Of this printing, in this condition
              </Text>
            </View>
            <Stepper value={quantity} onChange={setQuantity} min={1} max={999} />
          </View>

          <View style={styles.actions}>
            <Button label="Cancel" onPress={onClose} />
            <Button
              label={
                library.collections.length > 1
                  ? `Add ${quantity} to ${intoName}`
                  : `Add ${quantity === 1 ? 'card' : `${quantity} cards`}`
              }
              kind="primary"
              grow
              onPress={() => {
                onAdd(card, picked.name, picked.price, condition, quantity, into);
                reset();
                onClose();
              }}
            />
          </View>

          {quantity > 1 ? (
            <View style={styles.summary}>
              <Badge label={`${quantity} × ${picked.name}`} />
              <Badge label={cond.label} />
              <Text style={styles.summaryValue}>{money(total)}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.68)' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: c.line,
    paddingHorizontal: s.lg, paddingTop: s.sm,
    maxHeight: '90%',
  },
  grabber: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: c.line, marginBottom: s.md,
  },
  close: {
    position: 'absolute', right: s.md, top: s.md, zIndex: 5,
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
  },

  head: { flexDirection: 'row', gap: s.lg, marginBottom: s.xl, paddingRight: 34 },
  headBody: { flex: 1 },
  name: { ...t.title, fontSize: 21, color: c.text },
  sub: { ...t.meta, color: c.dim, marginTop: 3 },
  rarityRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  pip: { width: 6, height: 6, borderRadius: 3 },
  rarity: { ...t.tiny, color: c.faint },
  value: {
    fontSize: 26, fontWeight: '800', color: c.money, letterSpacing: -0.6,
    fontVariant: ['tabular-nums'], marginTop: s.md,
  },
  valueNote: { ...t.tiny, color: c.faint, fontVariant: ['tabular-nums'], marginTop: 2 },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: s.md },
  note: { ...t.tiny, color: c.faint, lineHeight: 16, marginBottom: s.lg },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.surface, borderRadius: r.lg, borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md, marginBottom: s.lg, marginTop: s.sm,
  },
  qtyLabel: { ...t.section, color: c.dim },
  qtyHint: { ...t.tiny, color: c.faint, marginTop: 3 },

  actions: { flexDirection: 'row', gap: s.sm },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    marginTop: s.md, justifyContent: 'center',
  },
  summaryValue: { ...t.money, color: c.money },
});
