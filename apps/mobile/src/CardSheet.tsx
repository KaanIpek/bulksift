/**
 * One card, opened up: quantity, printing, condition, and every price behind
 * the number on the list.
 *
 * This is where the scanner's uncertainty gets settled. Every other app in this
 * category picks a printing silently and shows you one price; the measurements
 * here say that is wrong often enough to matter, so when two printings share an
 * illustration the scan says so and this is where you choose - with both cards
 * and both prices in front of you, which is the only thing that makes the
 * choice answerable.
 *
 * The card's own picture leads, at the size a card is held. Everything below it
 * is a decision about the object in that picture, and a sheet that opens with a
 * heading instead makes you take the app's word for which card it means.
 */

import { useMemo } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';

import type { CardRecord, PricedVariant } from '@bulksift/core';
import {
  CONDITIONS, CONDITION_NOTE, GRADED_NOTE, GRADERS, conditionOf, entryValue,
  gradeLabel, type ConditionId, type Entry, type Grade,
} from './collection';
import CardImage from './ui/CardImage';
import { CheckIcon, CloseIcon, TrashIcon } from './ui/icons';
import { Badge, Button, Chip, SectionLabel, Stepper } from './ui/parts';
import { c, money, r, rarityTone, s, shadow, t } from './ui/theme';

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
  onGrade,
  onDelete,
}: {
  target: SheetTarget | null;
  variantsFor: (cardId: string) => PricedVariant[];
  onClose: () => void;
  onQuantity: (key: string, quantity: number) => void;
  onCondition: (key: string, condition: ConditionId) => void;
  onVariant: (key: string, variant: string, price: number | null) => void;
  onRepoint: (key: string, card: CardRecord, variant: string, price: number | null) => void;
  onGrade: (key: string, grade: Grade | null) => void;
  onDelete: (key: string) => void;
}) {
  const entry = target?.entry ?? null;
  const { width } = useWindowDimensions();
  const variants = useMemo(
    () => (entry ? variantsFor(entry.cardId) : []),
    [entry, variantsFor],
  );

  if (!target || !entry) return null;
  const cond = conditionOf(entry.condition);
  const lineValue = entryValue(entry);
  const artW = Math.min(132, Math.round(width * 0.34));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <CloseIcon size={17} color={c.dim} />
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: s.xxl }}>
          <View style={styles.head}>
            <View style={shadow.high}>
              <CardImage
                cardId={entry.cardId} number={entry.number} rarity={entry.rarity}
                width={artW} radius={r.sm}
              />
            </View>

            <View style={styles.headBody}>
              <Text style={styles.name} numberOfLines={2}>{entry.name}</Text>
              <Text style={styles.sub} numberOfLines={2}>
                {entry.setName} · #{entry.number}
              </Text>
              {entry.rarity ? (
                <View style={styles.rarityRow}>
                  <View style={[styles.pip, { backgroundColor: rarityTone(entry.rarity) }]} />
                  <Text style={styles.rarity}>{entry.rarity}</Text>
                </View>
              ) : null}

              <Text style={styles.value}>{money(lineValue)}</Text>
              <Text style={styles.valueNote}>
                {entry.quantity} × {money(entry.unitPrice)}
                {cond.multiplier !== 1 ? ` × ${cond.multiplier.toFixed(2)}` : ''}
              </Text>

              <View style={styles.headTags}>
                <Badge label={entry.variant.replace(' Holofoil', ' Holo')} />
                {entry.grade
                  ? <Badge label={gradeLabel(entry.grade)} tone="accent" />
                  : <Badge label={cond.label} />}
              </View>
            </View>
          </View>

          <View style={styles.qtyRow}>
            <View>
              <Text style={styles.qtyLabel}>QUANTITY</Text>
              <Text style={styles.qtyHint}>How many of this exact pile</Text>
            </View>
            <Stepper
              value={entry.quantity}
              onChange={(q) => onQuantity(entry.key, q)}
              min={0}
              max={999}
            />
          </View>

          {target.alternatives.length ? (
            <View style={styles.decision}>
              <SectionLabel>Which printing?</SectionLabel>
              <Text style={styles.note}>
                These share an illustration, so the picture alone cannot separate
                them. Their prices differ, so it is worth a look.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.printings}
              >
                {[
                  { card: null as CardRecord | null, cardId: entry.cardId,
                    number: entry.number, setName: entry.setName },
                  ...target.alternatives.map((a) => ({
                    card: a, cardId: a.i, number: a.u, setName: a.S,
                  })),
                ].map((opt) => {
                  const alt = opt.card;
                  const list = alt ? variantsFor(alt.i) : variants;
                  const best = list.find((v) => v.market != null);
                  const isCurrent = alt === null;
                  return (
                    <Pressable
                      key={alt?.i ?? 'current'}
                      disabled={isCurrent}
                      onPress={() =>
                        alt && onRepoint(
                          entry.key, alt, best?.variant ?? 'Normal', best?.market ?? null,
                        )}
                      style={({ pressed }) => [
                        styles.printing, isCurrent && styles.printingOn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <CardImage
                        cardId={opt.cardId} number={opt.number} width={78} radius={r.sm}
                      />
                      {isCurrent ? (
                        <View style={styles.printingTick}>
                          <CheckIcon size={13} color={c.accent} strong />
                        </View>
                      ) : null}
                      <Text style={styles.printingSet} numberOfLines={1}>{opt.setName}</Text>
                      <Text style={styles.printingPrice}>{money(best?.market ?? null)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
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

          {/*
            Condition and grade are the same axis from the market's point of
            view - a slab's grade already says what state it is in - so only
            one of them is offered at a time.
          */}
          {entry.grade ? null : (
            <>
              <SectionLabel>Condition</SectionLabel>
              <View style={styles.wrap}>
                {CONDITIONS.map((k) => (
                  <Chip
                    key={k.id}
                    label={
                      k.id === 'NM' ? k.label : `${k.label} ·${Math.round(k.multiplier * 100)}%`
                    }
                    active={k.id === entry.condition}
                    onPress={() => onCondition(entry.key, k.id)}
                  />
                ))}
              </View>
              <Text style={styles.note}>{CONDITION_NOTE}</Text>
            </>
          )}

          <SectionLabel>Graded slab</SectionLabel>
          <View style={styles.wrap}>
            <Chip
              label="Raw"
              active={!entry.grade}
              onPress={() => onGrade(entry.key, null)}
            />
            {GRADERS.map((g) => (
              <Chip
                key={g}
                label={g}
                active={entry.grade?.grader === g}
                onPress={() =>
                  onGrade(entry.key, { grader: g, score: entry.grade?.score ?? 10 })}
              />
            ))}
          </View>
          {entry.grade ? (
            <>
              <View style={styles.wrap}>
                {[10, 9.5, 9, 8.5, 8, 7, 6, 5].map((v) => (
                  <Chip
                    key={v}
                    label={String(v)}
                    active={entry.grade?.score === v}
                    onPress={() => onGrade(entry.key, { grader: entry.grade!.grader, score: v })}
                  />
                ))}
              </View>
              <Text style={styles.note}>
                {gradeLabel(entry.grade)} — {GRADED_NOTE}
              </Text>
            </>
          ) : null}

          {variants.length ? (
            <>
              <SectionLabel>Market</SectionLabel>
              <View style={styles.table}>
                <View style={styles.tableHead}>
                  <Text style={styles.tableKey} />
                  <Text style={styles.tableCap}>LOW</Text>
                  <Text style={styles.tableCap}>MARKET</Text>
                  <Text style={styles.tableCap}>HIGH</Text>
                </View>
                {variants.map((v) => (
                  <View key={v.variant} style={styles.tableRow}>
                    <Text style={styles.tableKey} numberOfLines={1}>{v.variant}</Text>
                    <Text style={styles.tableLow}>{money(v.low)}</Text>
                    <Text style={styles.tableMid}>{money(v.market)}</Text>
                    <Text style={styles.tableLow}>{money(v.high)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={styles.actions}>
            <Button
              label="Remove pile"
              kind="danger"
              onPress={() => onDelete(entry.key)}
              icon={<TrashIcon size={15} color={c.bad} />}
            />
            <Button label="Done" kind="primary" onPress={onClose} grow />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.68)' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: c.line,
    paddingHorizontal: s.lg,
    paddingTop: s.sm,
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
  name: { ...t.title, fontSize: 22, color: c.text },
  sub: { ...t.meta, color: c.dim, marginTop: 3 },
  rarityRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  pip: { width: 6, height: 6, borderRadius: 3 },
  rarity: { ...t.tiny, color: c.faint },
  value: {
    fontSize: 30, fontWeight: '800', color: c.money, letterSpacing: -0.7,
    fontVariant: ['tabular-nums'], marginTop: s.md,
  },
  valueNote: { ...t.tiny, color: c.faint, fontVariant: ['tabular-nums'], marginTop: 2 },
  headTags: { flexDirection: 'row', gap: 5, marginTop: s.sm, flexWrap: 'wrap' },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.surface, borderRadius: r.lg, borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md, marginBottom: s.xl,
  },
  qtyLabel: { ...t.section, color: c.dim },
  qtyHint: { ...t.tiny, color: c.faint, marginTop: 3 },

  decision: {
    backgroundColor: 'rgba(251,191,36,0.06)',
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
    borderRadius: r.lg, padding: s.md, marginBottom: s.xl,
  },
  printings: { gap: s.md, paddingRight: s.md },
  printing: { width: 78, alignItems: 'center' },
  printingOn: { opacity: 1 },
  printingTick: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,9,13,0.85)',
  },
  printingSet: { ...t.tiny, color: c.dim, marginTop: 6, textAlign: 'center' },
  printingPrice: {
    ...t.tiny, color: c.money, fontWeight: '800', fontVariant: ['tabular-nums'],
  },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: s.md },
  note: { ...t.tiny, color: c.faint, lineHeight: 16, marginBottom: s.md },

  table: {
    marginBottom: s.xl, backgroundColor: c.surface, borderRadius: r.md,
    borderWidth: 1, borderColor: c.lineSoft, paddingHorizontal: s.md,
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: c.lineSoft,
  },
  tableHead: { flexDirection: 'row', paddingTop: 9, paddingBottom: 3 },
  tableKey: { ...t.meta, color: c.dim, flex: 1, paddingRight: 6 },
  tableMid: {
    ...t.money, color: c.money, width: 74, textAlign: 'right',
  },
  tableLow: {
    ...t.meta, color: c.faint, width: 66, textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  tableCap: { ...t.section, fontSize: 9.5, color: c.faint, width: 70, textAlign: 'right' },

  actions: { flexDirection: 'row', gap: s.sm },
});
