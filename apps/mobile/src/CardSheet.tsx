/**
 * One card, opened up: quantity, printing, condition, and every price behind
 * the number on the list.
 *
 * This is where the scanner's uncertainty gets settled. Every other app in this
 * category picks a printing silently and shows you one price; the measurements
 * here say that is wrong often enough to matter, so when two printings share an
 * illustration the scan says so and this is where you choose - with both prices
 * in front of you, which is the only thing that makes the choice answerable.
 */

import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CardRecord, PricedVariant } from '@bulksift/core';
import {
  CONDITIONS, CONDITION_NOTE, conditionOf, entryValue, type ConditionId, type Entry,
} from './collection';
import { Button, Chip, SectionLabel } from './ui/parts';
import { c, money, r, s, t } from './ui/theme';

export interface SheetTarget {
  entry: Entry;
  /** Other printings of the same illustration, when the scan was unsure. */
  alternatives: CardRecord[];
}

export default function CardSheet({
  target,
  variantsFor,
  onClose,
  onQuantity,
  onCondition,
  onVariant,
  onRepoint,
  onDelete,
}: {
  target: SheetTarget | null;
  variantsFor: (cardId: string) => PricedVariant[];
  onClose: () => void;
  onQuantity: (key: string, quantity: number) => void;
  onCondition: (key: string, condition: ConditionId) => void;
  onVariant: (key: string, variant: string, price: number | null) => void;
  onRepoint: (key: string, card: CardRecord, variant: string, price: number | null) => void;
  onDelete: (key: string) => void;
}) {
  const entry = target?.entry ?? null;
  const variants = useMemo(
    () => (entry ? variantsFor(entry.cardId) : []),
    [entry, variantsFor],
  );

  if (!target || !entry) return null;
  const cond = conditionOf(entry.condition);
  const lineValue = entryValue(entry);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView contentContainerStyle={{ paddingBottom: s.xxl }}>
          <Text style={styles.name}>{entry.name}</Text>
          <Text style={styles.sub}>
            {entry.setName} · #{entry.number}
            {entry.rarity ? ` · ${entry.rarity}` : ''}
          </Text>

          <View style={styles.valueRow}>
            <Text style={styles.value}>{money(lineValue)}</Text>
            <Text style={styles.valueNote}>
              {entry.quantity} × {money(entry.unitPrice)}
              {cond.multiplier !== 1 ? ` × ${cond.multiplier.toFixed(2)} ${cond.id}` : ''}
            </Text>
          </View>

          {/* Quantity. Big targets - this is used with a card in the other hand. */}
          <SectionLabel>Quantity</SectionLabel>
          <View style={styles.qtyRow}>
            <Pressable
              style={styles.qtyBtn}
              onPress={() => onQuantity(entry.key, entry.quantity - 1)}
            >
              <Text style={styles.qtyGlyph}>−</Text>
            </Pressable>
            <Text style={styles.qtyValue}>{entry.quantity}</Text>
            <Pressable
              style={styles.qtyBtn}
              onPress={() => onQuantity(entry.key, entry.quantity + 1)}
            >
              <Text style={styles.qtyGlyph}>+</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Button label="Remove" kind="danger" onPress={() => onDelete(entry.key)} />
          </View>

          {target.alternatives.length ? (
            <>
              <SectionLabel>Which printing?</SectionLabel>
              <Text style={styles.note}>
                These share an illustration, so the picture alone cannot separate
                them. Their prices differ, so it is worth a look.
              </Text>
              <View style={styles.stack}>
                {[
                  { card: null as CardRecord | null, label: `${entry.setName} · #${entry.number}` },
                  ...target.alternatives.map((a) => ({
                    card: a,
                    label: `${a.S} · #${a.u}`,
                  })),
                ].map((opt, i) => {
                  const alt = opt.card;
                  const list = alt ? variantsFor(alt.i) : variants;
                  const best = list.find((v) => v.market != null);
                  const isCurrent = alt === null;
                  return (
                    <Pressable
                      key={alt?.i ?? 'current'}
                      style={[styles.option, isCurrent && styles.optionOn]}
                      onPress={() =>
                        alt
                          ? onRepoint(entry.key, alt, best?.variant ?? 'Normal', best?.market ?? null)
                          : undefined
                      }
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionText}>{opt.label}</Text>
                        {isCurrent ? (
                          <Text style={styles.optionTag}>current pick</Text>
                        ) : null}
                      </View>
                      <Text style={styles.optionPrice}>{money(best?.market ?? null)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <SectionLabel>Printing</SectionLabel>
          <View style={styles.wrap}>
            {variants.length ? (
              variants.map((v) => (
                <Chip
                  key={v.variant}
                  label={`${v.variant} · ${money(v.market)}`}
                  active={v.variant === entry.variant}
                  onPress={() => onVariant(entry.key, v.variant, v.market ?? null)}
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
                active={k.id === entry.condition}
                onPress={() => onCondition(entry.key, k.id)}
              />
            ))}
          </View>
          <Text style={styles.note}>{CONDITION_NOTE}</Text>

          {variants.length ? (
            <>
              <SectionLabel>Market</SectionLabel>
              <View style={styles.table}>
                {variants.map((v) => (
                  <View key={v.variant} style={styles.tableRow}>
                    <Text style={styles.tableKey}>{v.variant}</Text>
                    <Text style={styles.tableLow}>{money(v.low)}</Text>
                    <Text style={styles.tableMid}>{money(v.market)}</Text>
                    <Text style={styles.tableLow}>{money(v.high)}</Text>
                  </View>
                ))}
                <View style={styles.tableHead}>
                  <Text style={styles.tableKey} />
                  <Text style={styles.tableCap}>low</Text>
                  <Text style={styles.tableCap}>market</Text>
                  <Text style={styles.tableCap}>high</Text>
                </View>
              </View>
            </>
          ) : null}

          <Button label="Done" kind="primary" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.6)' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: c.line,
    paddingHorizontal: s.lg,
    paddingTop: s.sm,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
    backgroundColor: c.line, marginBottom: s.md,
  },
  name: { ...t.title, color: c.text },
  sub: { ...t.meta, color: c.dim, marginTop: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: s.sm, marginVertical: s.lg },
  value: { fontSize: 30, fontWeight: '800', color: c.money, letterSpacing: -0.5 },
  valueNote: { ...t.meta, color: c.faint, paddingBottom: 5 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: s.md, marginBottom: s.xl },
  qtyBtn: {
    width: 48, height: 48, borderRadius: r.md, backgroundColor: c.surfaceHi,
    borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center',
  },
  qtyGlyph: { fontSize: 24, fontWeight: '700', color: c.text, lineHeight: 28 },
  qtyValue: { fontSize: 22, fontWeight: '800', color: c.text, minWidth: 34, textAlign: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm, marginBottom: s.md },
  stack: { gap: s.sm, marginBottom: s.lg },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: s.md,
    padding: s.md, borderRadius: r.md,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  optionOn: { borderColor: c.accent, backgroundColor: c.surfaceHi },
  optionText: { ...t.body, color: c.text },
  optionTag: { ...t.tiny, color: c.accent, marginTop: 2 },
  optionPrice: { ...t.body, color: c.money },
  note: { ...t.tiny, color: c.faint, lineHeight: 16, marginBottom: s.lg },
  table: { marginBottom: s.xl },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  tableHead: { flexDirection: 'row', paddingTop: 6 },
  tableKey: { ...t.meta, color: c.dim, flex: 1 },
  tableMid: { ...t.body, color: c.money, width: 78, textAlign: 'right' },
  tableLow: { ...t.meta, color: c.faint, width: 70, textAlign: 'right' },
  tableCap: { ...t.tiny, color: c.faint, width: 74, textAlign: 'right' },
});
