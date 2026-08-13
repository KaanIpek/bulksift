/**
 * Search all 20,444 cards by name, set or number, and add one by hand.
 *
 * A scanner needs this for the cards a scanner cannot do: sleeved, graded,
 * damaged past recognition, or simply not in front of you. It also doubles as
 * the set browser - opening a set from the Sets tab lands here filtered - so
 * checking what you are missing and adding it are the same screen.
 *
 * The search runs over the catalogue already in memory, so it works with the
 * network off like everything else.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CardRecord, PricedVariant } from '@bulksift/core';
import { Empty } from './ui/parts';
import { c, money, plural, r, s, t } from './ui/theme';

const LIMIT = 120;

export default function BrowseScreen({
  cards,
  variantsFor,
  ownedIds,
  setFilter,
  setNameFor,
  onClearSetFilter,
  onAdd,
}: {
  cards: CardRecord[];
  variantsFor: (cardId: string) => PricedVariant[];
  ownedIds: Set<string>;
  setFilter: string | null;
  setNameFor: (setId: string) => string;
  onClearSetFilter: () => void;
  onAdd: (card: CardRecord, variant: string, price: number | null) => void;
}) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    const pool = setFilter ? cards.filter((x) => x.s === setFilter) : cards;
    if (!q) {
      // No query and no set: showing the first 120 of 20,444 alphabetically
      // would be noise, so ask for a search instead.
      return setFilter ? pool.slice(0, 400) : [];
    }
    const starts: CardRecord[] = [];
    const contains: CardRecord[] = [];
    for (const card of pool) {
      const name = card.n.toLowerCase();
      if (name.startsWith(q)) starts.push(card);
      else if (name.includes(q) || card.u.toLowerCase() === q || card.S.toLowerCase().includes(q)) {
        contains.push(card);
      }
      if (starts.length >= LIMIT) break;
    }
    return [...starts, ...contains].slice(0, LIMIT);
  }, [cards, deferred, setFilter]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{setFilter ? setNameFor(setFilter) : 'Browse'}</Text>
        {setFilter ? (
          <Pressable onPress={onClearSetFilter}>
            <Text style={styles.clear}>Search all sets instead</Text>
          </Pressable>
        ) : (
          <Text style={styles.sub}>
            {plural(cards.length, 'card')} on this phone, no connection needed
          </Text>
        )}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={setFilter ? 'Filter this set' : 'Card name, set or number'}
          placeholderTextColor={c.faint}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(x) => x.i}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length ? { paddingBottom: 100 } : { flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const variants = variantsFor(item.i);
          const best = variants.find((v) => v.market != null);
          const owned = ownedIds.has(item.i);
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.n}
                  {owned ? <Text style={styles.owned}>  ✓ owned</Text> : null}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.S} · #{item.u}{item.r ? ` · ${item.r}` : ''}
                </Text>
              </View>
              <Text style={styles.price}>{money(best?.market ?? null)}</Text>
              <Pressable
                style={({ pressed }) => [styles.add, pressed && { opacity: 0.6 }]}
                onPress={() => onAdd(item, best?.variant ?? 'Normal', best?.market ?? null)}
              >
                <Text style={styles.addText}>Add</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <Empty
            title={query.trim() ? 'Nothing found' : 'Search the catalogue'}
            hint={
              query.trim()
                ? 'Try part of the card name, or its collector number.'
                : 'Every card is on the phone already — type a name to find it.'
            }
          />
        }
        ListFooterComponent={
          results.length >= LIMIT ? (
            <Text style={styles.more}>
              Showing the first {LIMIT}. Narrow the search to see the rest.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingHorizontal: s.lg, paddingTop: s.md, paddingBottom: s.md, gap: s.sm,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  title: { ...t.hero, color: c.text },
  sub: { ...t.meta, color: c.dim },
  clear: { ...t.meta, color: c.accent },
  search: {
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md, paddingVertical: 10, color: c.text, ...t.body, marginTop: s.xs,
  },
  sep: { height: 1, backgroundColor: c.lineSoft, marginLeft: s.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: s.md,
    paddingVertical: 10, paddingHorizontal: s.lg,
  },
  name: { ...t.body, color: c.text },
  owned: { ...t.tiny, color: c.money, fontWeight: '700' },
  meta: { ...t.meta, color: c.dim, marginTop: 1 },
  price: { ...t.meta, color: c.money, fontWeight: '700' },
  add: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: r.pill,
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
  },
  addText: { ...t.tiny, color: c.text, fontWeight: '700' },
  more: { ...t.tiny, color: c.faint, textAlign: 'center', padding: s.lg },
});
