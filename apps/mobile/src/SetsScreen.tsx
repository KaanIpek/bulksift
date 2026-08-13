/**
 * Set completion: how far through each set you are, and what it is worth.
 *
 * Only sets you have started are listed. A wall of 180 sets at 0% is a list of
 * things you have not done; the sets you are actually working on are the ones
 * worth showing, with a search box for the rest.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SetInfo } from './engine';
import { bySet, type Entry } from './collection';
import { Empty, Meter } from './ui/parts';
import { c, money, plural, r, s, t } from './ui/theme';

export default function SetsScreen({
  entries,
  sets,
  onOpenSet,
}: {
  entries: Entry[];
  sets: SetInfo[];
  onOpenSet: (setId: string) => void;
}) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const totals = new Map(sets.map((x) => [x.id, x]));
    const started = bySet(entries).map((g) => {
      const info = totals.get(g.setId);
      const total = info?.total ?? g.distinct.size;
      return {
        id: g.setId,
        name: g.setName,
        have: g.distinct.size,
        total,
        value: g.value,
        released: info?.released ?? null,
      };
    });

    const q = query.trim().toLowerCase();
    if (!q) return started.sort((a, b) => b.have / b.total - a.have / a.total);

    const startedIds = new Set(started.map((x) => x.id));
    const others = sets
      .filter((x) => !startedIds.has(x.id) && x.name.toLowerCase().includes(q))
      .map((x) => ({
        id: x.id, name: x.name, have: 0, total: x.total, value: 0, released: x.released,
      }));
    return [
      ...started.filter((x) => x.name.toLowerCase().includes(q)),
      ...others,
    ];
  }, [entries, sets, query]);

  const complete = rows.filter((x) => x.have >= x.total).length;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Sets</Text>
        <Text style={styles.sub}>
          {rows.length
            ? `${plural(rows.filter((x) => x.have > 0).length, 'set')} started` +
              (complete ? ` · ${complete} complete` : '')
            : 'Scan a card to start a set'}
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search all 180+ sets"
          placeholderTextColor={c.faint}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        contentContainerStyle={rows.length ? { paddingBottom: 100 } : { flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const pct = item.total ? item.have / item.total : 0;
          const done = item.have >= item.total && item.total > 0;
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
              onPress={() => onOpenSet(item.id)}
            >
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.count, done && { color: c.money }]}>
                  {item.have}/{item.total}
                </Text>
              </View>
              <Meter value={pct} />
              <View style={styles.rowBottom}>
                <Text style={styles.meta}>
                  {done ? 'complete' : `${Math.round(pct * 100)}%`}
                  {item.released ? ` · ${item.released.slice(0, 4)}` : ''}
                </Text>
                <Text style={styles.value}>{money(item.value)}</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Empty
            title={query ? 'No set by that name' : 'No sets yet'}
            hint={query ? undefined : 'Every card you scan counts towards its set.'}
          />
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
  search: {
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md, paddingVertical: 10, color: c.text, ...t.body, marginTop: s.xs,
  },
  row: {
    paddingHorizontal: s.lg, paddingVertical: s.md, gap: 7,
    borderBottomWidth: 1, borderBottomColor: c.lineSoft,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: s.md },
  name: { ...t.body, color: c.text, flex: 1 },
  count: { ...t.meta, color: c.dim, fontWeight: '700' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { ...t.tiny, color: c.faint },
  value: { ...t.tiny, color: c.money, fontWeight: '700' },
});
