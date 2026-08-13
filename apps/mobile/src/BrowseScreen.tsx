/**
 * Search all 20,444 cards by name, set or number, and add one by hand.
 *
 * A scanner needs this for the cards a scanner cannot do: sleeved, graded,
 * damaged past recognition, or simply not in front of you. It also doubles as
 * the set browser - opening a set from the Sets tab lands here filtered - so
 * checking what you are missing and adding it are the same screen.
 *
 * A grid of art rather than a list of names, because the question being asked
 * here is usually "which printing is the one I am holding", and that is a
 * question about a picture. It is also how every app in this category shows a
 * search result, and for once the convention is right.
 *
 * The search runs over the catalogue already in memory, so it works with the
 * network off like everything else.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import {
  FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';

import type { CardRecord, PricedVariant } from '@bulksift/core';
import CardImage, { cardHeight } from './ui/CardImage';
import { CloseIcon, PlusIcon, SearchIcon, WantIcon } from './ui/icons';
import { Empty, OwnedTick, Segmented } from './ui/parts';
import { c, money, noOutline, plural, r, rarityTone, s, shadow, t } from './ui/theme';

const LIMIT = 120;
const COLUMNS = 2;

/** Inside a set, the question is usually "what am I still missing". */
type Have = 'all' | 'owned' | 'missing';

const HAVE: Array<{ id: Have; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'missing', label: 'Missing' },
];

export default function BrowseScreen({
  cards,
  variantsFor,
  ownedIds,
  setFilter,
  setNameFor,
  onClearSetFilter,
  onAdd,
  wishedIds,
  onWish,
}: {
  cards: CardRecord[];
  variantsFor: (cardId: string) => PricedVariant[];
  ownedIds: Set<string>;
  setFilter: string | null;
  setNameFor: (setId: string) => string;
  onClearSetFilter: () => void;
  onAdd: (card: CardRecord, variant: string, price: number | null) => void;
  wishedIds: Set<string>;
  onWish: (card: CardRecord, price: number | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [have, setHave] = useState<Have>('all');
  const deferred = useDeferredValue(query);
  const { width } = useWindowDimensions();

  // Two columns with a gutter each side and one between them.
  const artW = Math.floor((width - s.lg * 2 - s.md) / COLUMNS);

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    let pool = setFilter ? cards.filter((x) => x.s === setFilter) : cards;
    /*
     * The have/missing filter only exists inside a set, because that is the
     * only place the answer means anything: "missing" out of all 20,444 cards
     * is not a gap worth showing, it is the whole catalogue.
     */
    if (setFilter && have !== 'all') {
      pool = pool.filter((x) => ownedIds.has(x.i) === (have === 'owned'));
    }
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
  }, [cards, deferred, setFilter, have, ownedIds]);

  const setSize = useMemo(
    () => (setFilter ? cards.filter((x) => x.s === setFilter) : []),
    [cards, setFilter],
  );
  const ownedInSet = useMemo(
    () => setSize.filter((x) => ownedIds.has(x.i)).length,
    [setSize, ownedIds],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {setFilter ? setNameFor(setFilter) : 'Browse'}
            </Text>
            <Text style={styles.sub}>
              {setFilter
                ? `${ownedInSet} of ${setSize.length} collected`
                : `${plural(cards.length, 'card')} on this phone, no connection needed`}
            </Text>
          </View>
          {setFilter ? (
            <Pressable onPress={onClearSetFilter} hitSlop={10} style={styles.clear}>
              <CloseIcon size={16} color={c.dim} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.searchWrap}>
          <SearchIcon size={17} color={c.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={setFilter ? 'Filter this set' : 'Card name, set or number'}
            placeholderTextColor={c.faint}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <CloseIcon size={16} color={c.faint} />
            </Pressable>
          ) : null}
        </View>
        {setFilter ? (
          <Segmented options={HAVE} value={have} onChange={setHave} small />
        ) : null}
      </View>

      <FlatList
        data={results}
        key={COLUMNS}
        numColumns={COLUMNS}
        keyExtractor={(x) => x.i}
        keyboardShouldPersistTaps="handled"
        columnWrapperStyle={results.length ? styles.column : undefined}
        contentContainerStyle={results.length ? styles.grid : { flexGrow: 1 }}
        renderItem={({ item }) => {
          const variants = variantsFor(item.i);
          const best = variants.find((v) => v.market != null);
          return (
            <Tile
              card={item}
              width={artW}
              showSet={!setFilter}
              price={best?.market ?? null}
              owned={ownedIds.has(item.i)}
              wished={wishedIds.has(item.i)}
              onAdd={() => onAdd(item, best?.variant ?? 'Normal', best?.market ?? null)}
              onWish={() => onWish(item, best?.market ?? null)}
            />
          );
        }}
        ListEmptyComponent={
          <Empty
            title={
              setFilter && have === 'missing' && !query.trim()
                ? 'Set complete'
                : setFilter && have === 'owned' && !query.trim()
                  ? 'None from this set yet'
                  : query.trim() ? 'Nothing found' : 'Search the catalogue'
            }
            hint={
              setFilter && !query.trim()
                ? have === 'missing'
                  ? 'Every card in this set is in your collection.'
                  : 'Scan one, or add it by hand from the All tab.'
                : query.trim()
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

/**
 * One card in the grid.
 *
 * The two actions sit on the art itself rather than under it: want on the
 * picture's top corner, add on the bottom. That keeps the tile the height of a
 * card plus two lines, so a phone shows six of them instead of four, and the
 * picture stays the biggest thing on screen.
 */
function Tile({
  card, width, price, owned, wished, showSet, onAdd, onWish,
}: {
  card: CardRecord;
  width: number;
  /** Off inside a set, where the header already says which set this is. */
  showSet: boolean;
  price: number | null;
  owned: boolean;
  wished: boolean;
  onAdd: () => void;
  onWish: () => void;
}) {
  return (
    <View style={{ width }}>
      <View style={{ height: cardHeight(width) }}>
        <CardImage
          setId={card.s} number={card.u} rarity={card.r} width={width} radius={r.md}
        />
        <Pressable
          onPress={onWish}
          hitSlop={6}
          style={({ pressed }) => [
            styles.wish, wished && styles.wishOn, pressed && { opacity: 0.7 },
          ]}
        >
          <WantIcon size={14} color={wished ? c.onAccent : c.text} strong={wished} />
        </Pressable>

        {owned ? <View style={styles.tick}><OwnedTick size={22} /></View> : null}

        <Pressable
          onPress={onAdd}
          style={({ pressed }) => [styles.add, pressed && { opacity: 0.8 }]}
        >
          <PlusIcon size={15} color={c.onAccent} strong />
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      {/*
        The set has to be on the tile. A search for "charizard" returns a dozen
        cards all called Charizard, several of them numbered #4, and without the
        set beside the number the only difference visible between two rows is
        the price - which is the one thing you are trying to look up.
      */}
      <Text style={styles.name} numberOfLines={1}>{card.n}</Text>
      {showSet ? <Text style={styles.set} numberOfLines={1}>{card.S}</Text> : null}
      <View style={styles.tileFoot}>
        <View style={styles.numRow}>
          <View style={[styles.pip, { backgroundColor: rarityTone(card.r) }]} />
          <Text style={styles.meta} numberOfLines={1}>#{card.u}</Text>
        </View>
        <Text style={styles.price}>{money(price)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingHorizontal: s.lg, paddingTop: s.sm, paddingBottom: s.md, gap: s.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: s.md },
  title: { ...t.title, fontSize: 26, color: c.text },
  sub: { ...t.meta, color: c.dim, marginTop: 2 },
  clear: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
  },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md,
  },
  search: { flex: 1, paddingVertical: 11, color: c.text, ...t.body, ...noOutline },

  grid: { paddingHorizontal: s.lg, paddingBottom: 100, gap: s.lg },
  column: { gap: s.md },

  wish: {
    position: 'absolute', top: 6, left: 6,
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,9,13,0.72)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  wishOn: { backgroundColor: c.accent, borderColor: c.accent },
  tick: { position: 'absolute', top: 6, right: 6, ...shadow.low },
  add: {
    position: 'absolute', left: 8, right: 8, bottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingVertical: 7, borderRadius: r.sm,
    backgroundColor: c.accent, ...shadow.low,
  },
  addText: { ...t.tiny, color: c.onAccent, fontWeight: '800' },

  name: { ...t.body, color: c.text, marginTop: 8 },
  set: { ...t.tiny, color: c.dim, marginTop: 1 },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pip: { width: 5, height: 5, borderRadius: 3 },
  tileFoot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2,
  },
  meta: { ...t.tiny, color: c.faint },
  price: { ...t.tiny, color: c.money, fontWeight: '800', fontVariant: ['tabular-nums'] },

  more: { ...t.tiny, color: c.faint, textAlign: 'center', padding: s.lg },
});
