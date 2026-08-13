/**
 * Set completion: how far through each set you are, and what it is worth.
 *
 * Only sets you have started are listed. A wall of 180 sets at 0% is a list of
 * things you have not done; the sets you are actually working on are the ones
 * worth showing, with a search box for the rest.
 *
 * Each row leads with the set's own logo. A collector knows "Evolving Skies" by
 * its wordmark long before they read the words, and it turns a page of grey
 * progress bars into something recognisable at arm's length.
 */

import { useMemo, useState } from 'react';
import {
  FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';

import type { SetInfo } from './engine';
import { bySet, type Entry } from './collection';
import { SetLogo, SetSymbol } from './ui/CardImage';
import { ChevronIcon, CloseIcon, SearchIcon } from './ui/icons';
import { Empty, Meter } from './ui/parts';
import { c, money, noOutline, plural, r, s, t } from './ui/theme';

interface Row {
  id: string;
  name: string;
  have: number;
  total: number;
  value: number;
  released: string | null;
}

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
  const { width } = useWindowDimensions();
  const logoW = Math.min(120, Math.round(width * 0.3));

  const { rows, startedCount, completeCount, totalValue } = useMemo(() => {
    const totals = new Map(sets.map((x) => [x.id, x]));
    const started: Row[] = bySet(entries).map((g) => {
      const info = totals.get(g.setId);
      return {
        id: g.setId,
        name: g.setName,
        have: g.distinct.size,
        total: info?.total ?? g.distinct.size,
        value: g.value,
        released: info?.released ?? null,
      };
    });

    const q = query.trim().toLowerCase();
    let list: Row[];
    if (!q) {
      list = started.slice().sort((a, b) => b.have / b.total - a.have / a.total);
    } else {
      const startedIds = new Set(started.map((x) => x.id));
      const others: Row[] = sets
        .filter((x) => !startedIds.has(x.id) && x.name.toLowerCase().includes(q))
        .map((x) => ({
          id: x.id, name: x.name, have: 0, total: x.total, value: 0, released: x.released,
        }));
      list = [...started.filter((x) => x.name.toLowerCase().includes(q)), ...others];
    }

    return {
      rows: list,
      startedCount: started.length,
      completeCount: started.filter((x) => x.have >= x.total && x.total > 0).length,
      totalValue: started.reduce((sum, x) => sum + x.value, 0),
    };
  }, [entries, sets, query]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Sets</Text>
        <View style={styles.summary}>
          <Text style={styles.sub}>
            {startedCount
              ? `${plural(startedCount, 'set')} started` +
                (completeCount ? ` · ${completeCount} complete` : '')
              : 'Scan a card to start a set'}
          </Text>
          {startedCount ? (
            <Text style={styles.summaryValue}>{money(totalValue)}</Text>
          ) : null}
        </View>

        <View style={styles.searchWrap}>
          <SearchIcon size={17} color={c.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search all ${sets.length} sets`}
            placeholderTextColor={c.faint}
            style={styles.search}
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <CloseIcon size={16} color={c.faint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        contentContainerStyle={rows.length ? styles.list : { flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const pct = item.total ? item.have / item.total : 0;
          const done = item.have >= item.total && item.total > 0;
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surfaceHi }]}
              onPress={() => onOpenSet(item.id)}
            >
              {/* Fixed width, so a wide wordmark and a narrow one leave the
                  set names starting in the same place down the list. */}
              <View style={[styles.logoWrap, { width: logoW }]}>
                <SetLogo setId={item.id} name={item.name} width={logoW} height={38} />
              </View>

              <View style={styles.body}>
                <View style={styles.nameRow}>
                  <SetSymbol setId={item.id} size={15} />
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <ChevronIcon size={14} color={c.faint} />
                </View>

                <Meter value={pct} tone={done ? c.money : c.accent} />

                <View style={styles.rowBottom}>
                  <Text style={styles.meta}>
                    <Text style={[styles.count, done && { color: c.money }]}>
                      {item.have}/{item.total}
                    </Text>
                    {'  '}
                    {done ? 'complete' : `${Math.round(pct * 100)}%`}
                    {item.released ? ` · ${item.released.slice(0, 4)}` : ''}
                  </Text>
                  <Text style={styles.value}>{item.value > 0 ? money(item.value) : ''}</Text>
                </View>
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
  header: { paddingHorizontal: s.lg, paddingTop: s.sm, paddingBottom: s.md, gap: s.md },
  title: { ...t.title, fontSize: 26, color: c.text },
  summary: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: -8,
  },
  sub: { ...t.meta, color: c.dim },
  summaryValue: { ...t.money, color: c.money },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md,
  },
  search: { flex: 1, paddingVertical: 11, color: c.text, ...t.body, ...noOutline },

  list: { paddingHorizontal: s.lg, paddingBottom: 100, gap: s.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: s.md,
    backgroundColor: c.surface, borderRadius: r.lg,
    borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md,
  },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 7 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...t.body, color: c.text, flex: 1 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { ...t.tiny, color: c.faint },
  count: { ...t.tiny, color: c.dim, fontWeight: '800', fontVariant: ['tabular-nums'] },
  value: { ...t.tiny, color: c.money, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
