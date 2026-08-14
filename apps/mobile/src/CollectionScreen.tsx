/**
 * Everything you own, what it is worth, and the ones the scanner was unsure of.
 *
 * The layout follows what collectors already expect from a portfolio app - a
 * headline value, a change, a chart, then the holdings - because that shape is
 * not a style choice, it is the order the questions are asked in: what is it
 * worth, is it up, what is in it.
 *
 * The ordering choice that matters: cards needing a printing decision are
 * pinned to the top. A bulk scan produces a handful of them among hundreds of
 * settled rows, and buried at scan-order they would never be looked at - which
 * would turn "we tell you when we are unsure" into a footnote nobody reads.
 */

import { useMemo, useState } from 'react';
import {
  FlatList, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';

import {
  conditionOf, entryValue, gradeLabel, toCsv, totalCards, totalValue,
  type Entry, type WishEntry,
} from './collection';
import { changeOver, series, shortDay, type Point } from './history';
import CardImage from './ui/CardImage';
import ValueChart from './ui/ValueChart';
import {
  ChevronIcon, CloseIcon, ScanIcon, SearchIcon, ShareIcon, WantIcon,
} from './ui/icons';
import { Badge, Button, Chip, Delta, Empty, SectionLabel, Segmented } from './ui/parts';
import { c, money, moneyShort, noOutline, plural, r, rarityTone, s, shadow, t } from './ui/theme';

type Sort = 'recent' | 'value' | 'name' | 'set';
type Range = '7' | '30' | 'all';

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'recent', label: 'Recent' },
  { id: 'value', label: 'Value' },
  { id: 'name', label: 'Name' },
  { id: 'set', label: 'Set' },
];

const RANGES: Array<{ id: Range; label: string; days: number }> = [
  { id: '7', label: '7D', days: 7 },
  { id: '30', label: '30D', days: 30 },
  { id: 'all', label: 'ALL', days: Infinity },
];

const THUMB = 40;

export default function CollectionScreen({
  entries,
  history,
  wishlist,
  wishlistValue,
  onOpen,
  onScan,
  onBrowse,
  onUnwish,
}: {
  entries: Entry[];
  history: Point[];
  wishlist: WishEntry[];
  wishlistValue: number;
  onOpen: (entry: Entry) => void;
  onScan: () => void;
  onBrowse: () => void;
  onUnwish: (cardId: string) => void;
}) {
  const [showWishlist, setShowWishlist] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [onlyUnsure, setOnlyUnsure] = useState(false);
  const [range, setRange] = useState<Range>('30');

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

  /** The five that carry the collection, shown as art. */
  const best = useMemo(
    () => entries.slice().sort((a, b) => entryValue(b) - entryValue(a)).slice(0, 8),
    [entries],
  );

  const shownValue = totalValue(shown);
  const value = totalValue(entries);
  const windowDays = RANGES.find((x) => x.id === range)?.days ?? 30;
  const chart = useMemo(() => series(history, windowDays), [history, windowDays]);
  const change = useMemo(
    () => changeOver(history, Number.isFinite(windowDays) ? windowDays : 3650, Date.now()),
    [history, windowDays],
  );

  const exportCsv = async () => {
    if (!entries.length) return;
    await Share.share({ title: 'BulkSift collection', message: toCsv(entries) });
  };

  const tone = !change || Math.abs(change.delta) < 0.005
    ? 'flat' as const
    : change.delta > 0 ? 'up' as const : 'down' as const;

  const header = (
    <View style={styles.header}>
      <View style={styles.heroRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroLabel}>COLLECTION VALUE</Text>
          <Text style={styles.hero}>{money(value)}</Text>
          {change ? (
            <Delta
              amount={change.delta}
              fraction={change.fraction}
              suffix={change.span === 1 ? 'since yesterday' : `over ${change.span} days`}
            />
          ) : (
            <Text style={styles.heroHint}>
              {history.length < 2
                ? 'Change appears once there are two days recorded.'
                : 'No change yet.'}
            </Text>
          )}
        </View>
        <View style={styles.heroSide}>
          <Text style={styles.sideValue}>{totalCards(entries).toLocaleString('en-US')}</Text>
          <Text style={styles.sideLabel}>CARDS</Text>
          <Text style={[styles.sideValue, styles.sideValueDim]}>
            {new Set(entries.map((e) => e.cardId)).size.toLocaleString('en-US')}
          </Text>
          <Text style={styles.sideLabel}>UNIQUE</Text>
        </View>
      </View>

      {history.length >= 2 ? (
        <View style={styles.chartCard}>
          <ValueChart
            points={chart?.points ?? []}
            low={chart?.low}
            high={chart?.high}
            tone={tone}
            height={104}
            labels={chart ? [shortDay(chart.from), shortDay(chart.to)] : undefined}
          />
          <View style={styles.rangeRow}>
            {RANGES.map((x) => {
              const on = x.id === range;
              return (
                <Pressable
                  key={x.id}
                  onPress={() => setRange(x.id)}
                  style={({ pressed }) => [
                    styles.range, on && styles.rangeOn, pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{x.label}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.rangeNote}>
              {chart ? plural(chart.days, 'day') : 'recording'}
            </Text>
          </View>
        </View>
      ) : null}

      {best.length >= 3 && !query && !onlyUnsure ? (
        <View>
          <SectionLabel>Most valuable</SectionLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shelf}
          >
            {best.map((e) => (
              <Pressable
                key={e.key}
                onPress={() => onOpen(e)}
                style={({ pressed }) => [styles.shelfCard, pressed && { opacity: 0.7 }]}
              >
                <CardImage
                  cardId={e.cardId} number={e.number} rarity={e.rarity} width={62}
                />
                <Text style={styles.shelfPrice} numberOfLines={1}>
                  {moneyShort(entryValue(e))}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <SearchIcon size={17} color={c.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your cards"
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
            tone="warn"
            active={onlyUnsure}
            onPress={() => setOnlyUnsure((v) => !v)}
          />
        ) : null}
      </View>
    </View>
  );

  /*
   * A first run gets its own screen, not the list's empty row.
   *
   * With nothing collected the header above is a $0.00 headline, a chart with
   * no days in it and four sort chips sorting nothing - every control the app
   * has, all of them inert. The first thing someone sees should say what the
   * app does and give them the one button that starts it.
   */
  if (!entries.length && !wishlist.length) {
    return (
      <View style={[styles.root, styles.firstRun]}>
        <View style={styles.firstArt}>
          {['sv3pt5-6', 'base1-4', 'swsh7-215'].map((id, i) => (
            <View
              key={id}
              style={[
                styles.firstCard,
                {
                  transform: [{ rotate: `${(i - 1) * 9}deg` }, { translateX: (i - 1) * 46 }],
                  zIndex: i === 1 ? 2 : 1,
                },
              ]}
            >
              <CardImage
                cardId={id}
                number={id.slice(id.lastIndexOf('-') + 1)}
                width={96}
                radius={r.sm}
              />
            </View>
          ))}
        </View>
        <Text style={styles.firstTitle}>Your collection starts here</Text>
        <Text style={styles.firstHint}>
          Prop your phone up and pass cards through the frame. Each one is
          recognised on the device and lands here with its market price - and
          when two printings cannot be told apart, it says so instead of
          guessing.
        </Text>
        <View style={styles.firstActions}>
          <Button label="Start scanning" kind="primary" onPress={onScan} grow />
          <Button label="Add by hand" onPress={onBrowse} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabsWrap}>
        <Segmented
          options={[
            { id: 'own', label: `Owned · ${entries.length}` },
            { id: 'want', label: `Want list · ${wishlist.length}` },
          ]}
          value={showWishlist ? 'want' : 'own'}
          onChange={(id) => setShowWishlist(id === 'want')}
        />
      </View>

      {showWishlist ? (
        <FlatList
          data={wishlist}
          keyExtractor={(w) => w.cardId}
          contentContainerStyle={wishlist.length ? styles.list : styles.listEmpty}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <CardImage cardId={item.cardId} number={item.number} width={THUMB} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {item.setName} · #{item.number}
                </Text>
              </View>
              <Text style={styles.rowPrice}>{money(item.unitPrice)}</Text>
              <Pressable onPress={() => onUnwish(item.cardId)} hitSlop={8} style={styles.drop}>
                <CloseIcon size={16} color={c.faint} />
              </Pressable>
            </View>
          )}
          ListHeaderComponent={
            wishlist.length ? (
              <View style={styles.wishHead}>
                <WantIcon size={15} color={c.accent} strong />
                <Text style={styles.wishNote}>
                  {money(wishlistValue)} to buy at today's prices
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Empty
              title="Nothing on the want list"
              hint="Star a card in Browse and it lands here, with what it would cost."
              action={<Button label="Browse cards" onPress={onBrowse} kind="primary" />}
            />
          }
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(e) => e.key}
          contentContainerStyle={shown.length ? styles.list : styles.listEmpty}
          keyboardShouldPersistTaps="handled"
          // Each row holds a card picture, so the mounted window is bounded
          // for the same reason as the Browse grid.
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={9}
          ListHeaderComponent={header}
          renderItem={({ item }) => <Row entry={item} onPress={() => onOpen(item)} />}
          ListEmptyComponent={
            entries.length ? (
              <Empty title="Nothing matches" hint="Try a different name, set or number." />
            ) : (
              <Empty
                title="No cards yet"
                hint="Scan a card and it lands here — with its price, and a note when two printings could not be told apart."
                action={<Button label="Start scanning" onPress={onScan} kind="primary" />}
              />
            )
          }
          ListFooterComponent={
            shown.length ? (
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  {plural(shown.length, 'pile')} shown · {money(shownValue)}
                </Text>
                <Button
                  label="Export as CSV"
                  onPress={exportCsv}
                  icon={<ShareIcon size={15} color={c.dim} />}
                />
              </View>
            ) : null
          }
        />
      )}

      {shown.length || showWishlist ? (
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
          onPress={showWishlist ? onBrowse : onScan}
        >
          {showWishlist
            ? <SearchIcon size={18} color={c.onAccent} strong />
            : <ScanIcon size={18} color={c.onAccent} strong />}
          <Text style={styles.fabText}>{showWishlist ? 'Browse' : 'Scan'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One pile.
 *
 * The quantity sits on the picture rather than beside it, the way a stack of
 * sleeved cards has its count written on the top one - which also buys back the
 * whole width the old badge column was taking from the card's name.
 */
function Row({ entry, onPress }: { entry: Entry; onPress: () => void }) {
  const unit = entry.unitPrice;
  const total = entryValue(entry);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface }]}
      onPress={onPress}
    >
      <View>
        <CardImage
          cardId={entry.cardId} number={entry.number} rarity={entry.rarity} width={THUMB}
        />
        {entry.quantity > 1 ? (
          <View style={styles.qty}>
            <Text style={styles.qtyText}>{entry.quantity}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowName} numberOfLines={1}>{entry.name}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {entry.setName} · #{entry.number}
        </Text>
        <View style={styles.tags}>
          {entry.variant !== 'Normal' ? (
            <Badge label={entry.variant.replace(' Holofoil', ' Holo')} dot={rarityTone(entry.rarity)} />
          ) : null}
          {entry.grade ? (
            <Badge label={gradeLabel(entry.grade)} tone="accent" />
          ) : entry.condition !== 'NM' ? (
            <Badge label={conditionOf(entry.condition).id} />
          ) : null}
          {entry.needsPrinting ? <Badge label="PICK PRINTING" tone="warn" /> : null}
        </View>
      </View>

      <View style={styles.priceCol}>
        <Text style={styles.rowPrice}>{money(total)}</Text>
        {entry.quantity > 1 && unit != null ? (
          <Text style={styles.rowUnit}>{money(unit)} ea</Text>
        ) : null}
      </View>
      <ChevronIcon size={14} color={c.faint} />
    </Pressable>
  );
}

/** A card id is "{setId}-{number}", and the set is everything before the last dash. */
function setIdOf(cardId: string): string {
  const at = cardId.lastIndexOf('-');
  return at > 0 ? cardId.slice(0, at) : cardId;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  firstRun: { alignItems: 'center', justifyContent: 'center', padding: s.xl, gap: s.md },
  firstArt: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 150, marginBottom: s.sm,
  },
  firstCard: { position: 'absolute', ...shadow.high },
  firstTitle: { ...t.title, fontSize: 24, color: c.text, textAlign: 'center' },
  firstHint: {
    ...t.meta, color: c.dim, textAlign: 'center', lineHeight: 20, maxWidth: 320,
  },
  firstActions: { flexDirection: 'row', gap: s.sm, alignSelf: 'stretch', marginTop: s.md },
  tabsWrap: { paddingHorizontal: s.lg, paddingTop: s.sm, paddingBottom: s.sm },

  header: { paddingHorizontal: s.lg, paddingBottom: s.md, gap: s.lg },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: s.lg },
  heroLabel: { ...t.section, color: c.faint },
  hero: { ...t.hero, color: c.text, marginTop: 2, marginBottom: 5 },
  heroHint: { ...t.tiny, color: c.faint },
  heroSide: { alignItems: 'flex-end', paddingTop: 2 },
  sideValue: {
    fontSize: 19, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'],
  },
  sideValueDim: { color: c.dim, marginTop: 8 },
  sideLabel: { ...t.section, fontSize: 9.5, color: c.faint, marginTop: 1 },

  chartCard: {
    backgroundColor: c.surface, borderRadius: r.lg, borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md, gap: s.sm,
  },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  range: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: r.pill },
  rangeOn: { backgroundColor: c.surfaceTop },
  rangeText: { ...t.tiny, color: c.faint, fontWeight: '700' },
  rangeTextOn: { color: c.text, fontWeight: '800' },
  rangeNote: { ...t.tiny, color: c.faint, marginLeft: 'auto' },

  shelf: { gap: s.sm, paddingRight: s.lg },
  shelfCard: { alignItems: 'center', gap: 5 },
  shelfPrice: { ...t.tiny, color: c.money, fontVariant: ['tabular-nums'] },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.line,
    paddingHorizontal: s.md,
  },
  search: { flex: 1, paddingVertical: 11, color: c.text, ...t.body, ...noOutline },

  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },

  list: { paddingBottom: 110 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', paddingBottom: 60 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: s.md,
    paddingVertical: 10, paddingHorizontal: s.lg,
  },
  qty: {
    position: 'absolute', right: -5, top: -5,
    minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 4,
    backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.bg,
  },
  qtyText: { fontSize: 10.5, fontWeight: '900', color: c.onAccent },
  rowName: { ...t.body, color: c.text },
  rowMeta: { ...t.meta, color: c.dim },
  tags: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  priceCol: { alignItems: 'flex-end' },
  rowPrice: { ...t.money, color: c.money },
  rowUnit: { ...t.tiny, color: c.faint, fontVariant: ['tabular-nums'], marginTop: 2 },

  footer: {
    padding: s.lg, gap: s.md, marginTop: s.sm,
    borderTopWidth: 1, borderTopColor: c.lineSoft,
  },
  footerText: { ...t.meta, color: c.faint, textAlign: 'center' },

  wishHead: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    paddingHorizontal: s.lg, paddingBottom: s.sm,
  },
  wishNote: { ...t.meta, color: c.dim },
  drop: { padding: 4 },

  fab: {
    position: 'absolute', right: s.lg, bottom: s.lg,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 20, paddingVertical: 13, borderRadius: r.pill,
    backgroundColor: c.accent, ...shadow.high,
  },
  fabText: { ...t.body, color: c.onAccent, fontWeight: '800' },
});
