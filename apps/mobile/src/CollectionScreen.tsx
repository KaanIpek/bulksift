/**
 * Everything you own, what it is worth, and the ones the scanner was unsure of.
 *
 * The ordering choice that matters: cards needing a printing decision are
 * pinned to the top. A bulk scan produces a handful of them among hundreds of
 * settled rows, and buried at scan-order they would never be looked at - which
 * would turn "we tell you when we are unsure" into a footnote nobody reads.
 */

import { useMemo, useState } from 'react';
import {
  FlatList, Pressable, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';

import {
  conditionOf, entryValue, toCsv, totalCards, totalValue, type Entry,
} from './collection';
import { Button, Chip, Empty, Stat } from './ui/parts';
import { c, money, moneyShort, plural, r, s, t } from './ui/theme';

type Sort = 'recent' | 'value' | 'name' | 'set';

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'value', label: 'Value' },
  { id: 'name', label: 'Name' },
  { id: 'set', label: 'Set' },
];

export default function CollectionScreen({
  entries,
  onOpen,
  onScan,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
  onScan: () => void;
}) {
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [onlyUnsure, setOnlyUnsure] = useState(false);

  const unsureCount = useMemo(
    () => entries.filter((e) => e.needsPrinting).length,
    [entries],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries;
    if (q) {
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.setName.toLowerCase().includes(q) ||
          e.number.toLowerCase() === q,
      );
    }
    if (onlyUnsure) list = list.filter((e) => e.needsPrinting);

    const sorted = list.slice().sort((a, b) => {
      switch (sort) {
        case 'value': return entryValue(b) - entryValue(a);
        case 'name': return a.name.localeCompare(b.name);
        case 'set': return a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number);
        default: return b.updatedAt - a.updatedAt;
      }
    });
    // Unresolved printings first, whatever the sort - they are the only rows
    // that need a decision, and they are worth money.
    if (!onlyUnsure) {
      sorted.sort((a, b) => Number(!!b.needsPrinting) - Number(!!a.needsPrinting));
    }
    return sorted;
  }, [entries, query, sort, onlyUnsure]);

  const shownValue = totalValue(shown);

  const exportCsv = async () => {
    if (!entries.length) return;
    await Share.share({
      title: 'BulkSift collection',
      message: toCsv(entries),
    });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.statRow}>
          <Stat label="Collection" value={moneyShort(totalValue(entries))} tone="money" />
          <Stat label="Cards" value={totalCards(entries).toLocaleString('en-US')} />
          <Stat
            label="Unique"
            value={new Set(entries.map((e) => e.cardId)).size.toLocaleString('en-US')}
            tone="dim"
          />
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your cards"
          placeholderTextColor={c.faint}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />

        <View style={styles.controls}>
          {SORTS.map((o) => (
            <Chip
              key={o.id}
              label={o.label}
              active={sort === o.id}
              onPress={() => setSort(o.id)}
            />
          ))}
          {unsureCount ? (
            <Chip
              label={`${unsureCount} to check`}
              tone={onlyUnsure ? 'plain' : 'warn'}
              active={onlyUnsure}
              onPress={() => setOnlyUnsure((v) => !v)}
            />
          ) : null}
        </View>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e) => e.key}
        contentContainerStyle={shown.length ? styles.list : styles.listEmpty}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
            onPress={() => onOpen(item)}
          >
            <View style={styles.qtyPill}>
              <Text style={styles.qtyPillText}>{item.quantity}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {item.setName} · #{item.number}
                {item.variant !== 'Normal' ? ` · ${item.variant}` : ''}
                {item.condition !== 'NM' ? ` · ${conditionOf(item.condition).id}` : ''}
              </Text>
              {item.needsPrinting ? (
                <Text style={styles.rowFlag}>tap to pick the printing</Text>
              ) : null}
            </View>
            <Text style={styles.rowPrice}>{money(entryValue(item))}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          entries.length ? (
            <Empty title="Nothing matches" hint="Try a different name, set or number." />
          ) : (
            <Empty
              title="No cards yet"
              hint="Scan a card and it lands here — with its price, and a note when two printings could not be told apart."
            />
          )
        }
        ListFooterComponent={
          shown.length ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {plural(shown.length, 'row')} · {money(shownValue)}
              </Text>
              <Button label="Export CSV" onPress={exportCsv} />
            </View>
          ) : null
        }
      />

      <Pressable style={styles.fab} onPress={onScan}>
        <Text style={styles.fabText}>Scan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingHorizontal: s.lg, paddingTop: s.md, paddingBottom: s.md,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft, gap: s.md,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  search: {
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md, paddingVertical: 10, color: c.text, ...t.body,
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: s.sm },
  list: { paddingBottom: 120 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', paddingBottom: 80 },
  sep: { height: 1, backgroundColor: c.lineSoft, marginLeft: 62 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: s.md,
    paddingVertical: 11, paddingHorizontal: s.lg,
  },
  qtyPill: {
    minWidth: 30, height: 30, borderRadius: r.sm, paddingHorizontal: 6,
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyPillText: { ...t.meta, color: c.dim, fontWeight: '700' },
  rowName: { ...t.body, color: c.text },
  rowMeta: { ...t.meta, color: c.dim, marginTop: 1 },
  rowFlag: { ...t.tiny, color: c.warn, fontWeight: '700', marginTop: 2 },
  rowPrice: { ...t.body, color: c.money },
  footer: {
    padding: s.lg, gap: s.md, alignItems: 'stretch',
    borderTopWidth: 1, borderTopColor: c.lineSoft,
  },
  footerText: { ...t.meta, color: c.faint, textAlign: 'center' },
  fab: {
    position: 'absolute', right: s.lg, bottom: s.lg,
    paddingHorizontal: s.xl, paddingVertical: 14, borderRadius: r.pill,
    backgroundColor: c.accentDim, borderWidth: 1, borderColor: '#2563eb',
  },
  fabText: { ...t.body, color: c.text, fontWeight: '800' },
});
