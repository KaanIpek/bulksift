/**
 * The app shell: loads the engine once, owns the collection, routes the tabs.
 *
 * There is no navigation library. Four tabs and one sheet do not need a router,
 * and the screens are cheap to keep mounted - the camera is the only expensive
 * one and it is unmounted when it is not on top, which also stops it holding
 * the torch and the CPU while you read a list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { CardRecord, PricedVariant, ScanHit } from '@bulksift/core';
import BrowseScreen from './src/BrowseScreen';
import CardSheet, { type SheetTarget } from './src/CardSheet';
import CollectionScreen from './src/CollectionScreen';
import { Platform } from 'react-native';

/*
 * The scanner is loaded lazily and only where a camera exists.
 *
 * VisionCamera is a Nitro native module - importing it at all on web throws
 * before anything renders. Deferring the import is what lets the rest of the
 * app be opened in a browser to work on, which is the only way the interface
 * gets looked at between 10-minute device builds.
 */
const ScannerScreen = Platform.OS === 'web'
  ? null
  : (require('./src/ScannerScreen').default as typeof import('./src/ScannerScreen').default);
import SetsScreen from './src/SetsScreen';
import {
  addScan, defaultVariant, entryValue, reclassify, regrade, repoint, setQuantity,
  toggleWish, totalCards, totalValue, wishlistValue,
  type ConditionId, type Entry, type Grade, type WishEntry,
} from './src/collection';
import { loadCollection, saveCollection } from './src/collectionStore';
import { record, type Point } from './src/history';
import { loadEngine, type LoadedEngine } from './src/engine';
import {
  CollectionIcon, ScanIcon, SearchIcon, SetsIcon, type IconProps,
} from './src/ui/icons';
import { c, r, s, shadow, t } from './src/ui/theme';

type Tab = 'scan' | 'collection' | 'sets' | 'browse';

const TABS: Array<{
  id: Tab; label: string; Icon: (p: IconProps) => React.ReactElement;
}> = [
  { id: 'scan', label: 'Scan', Icon: ScanIcon },
  { id: 'collection', label: 'Collection', Icon: CollectionIcon },
  { id: 'sets', label: 'Sets', Icon: SetsIcon },
  { id: 'browse', label: 'Browse', Icon: SearchIcon },
];

export default function App() {
  const [engine, setEngine] = useState<LoadedEngine | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('scan');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [wishlist, setWishlist] = useState<WishEntry[]>([]);
  const [history, setHistory] = useState<Point[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [setFilter, setSetFilter] = useState<string | null>(null);

  /** When the current scanning session began; entries newer than this count. */
  const sessionStart = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((e) => { if (!cancelled) setEngine(e); })
      .catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? err);
        console.log(`[BulkSift] engine load failed: ${msg}`);
        if (!cancelled) setBootError(msg);
      });
    loadCollection()
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries);
        setWishlist(data.wishlist);
        setHistory(data.history ?? []);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  /*
   * Save on a debounce.
   *
   * A bulk scan adds a card every second or two; writing the whole file on each
   * one would put a synchronous disk write on the same thread that has to
   * recognise the next frame. Waiting a moment costs nothing and the file is
   * small enough that rewriting it whole stays simpler than any alternative.
   */
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      void saveCollection({ version: 1, entries, wishlist, history });
    }, 700);
    return () => clearTimeout(id);
  }, [entries, wishlist, history, loaded]);

  /*
   * Record today's total whenever it moves.
   *
   * `record` returns the same array when the day's numbers have not changed, so
   * this settles immediately instead of looping through its own state update.
   */
  useEffect(() => {
    if (!loaded) return;
    setHistory((prev) => record(prev, totalValue(entries), totalCards(entries), Date.now()));
  }, [entries, loaded]);

  const variantsFor = useCallback(
    (cardId: string): PricedVariant[] => engine?.scanner.pricesFor(cardId) ?? [],
    [engine],
  );

  const onHit = useCallback((hit: ScanHit) => {
    const variants = engine?.scanner.pricesFor(hit.card.i) ?? [];
    const pick = defaultVariant(variants);
    setEntries((prev) =>
      addScan(prev, hit.card, pick.name, pick.price, 'NM', !!hit.ambiguity),
    );
  }, [engine]);

  const addManual = useCallback(
    (card: CardRecord, variant: string, price: number | null) => {
      setEntries((prev) => addScan(prev, card, variant, price, 'NM', false));
    },
    [],
  );

  /** Other printings of the same illustration, for the sheet to offer. */
  const openEntry = useCallback((entry: Entry) => {
    const alternatives: CardRecord[] = [];
    if (entry.needsPrinting && engine) {
      for (const card of engine.cards) {
        if (card.n === entry.name && card.i !== entry.cardId) alternatives.push(card);
        if (alternatives.length >= 5) break;
      }
    }
    setSheet({ entry, alternatives });
  }, [engine]);

  /*
   * Keep the open sheet pointing at live data as the collection changes.
   *
   * Changing a card's grade, condition or printing changes its key - that is
   * the point of the key - so following the key alone made the sheet vanish the
   * moment you used it. It falls back to the same card's most recently touched
   * pile, which is exactly the one the edit just produced. Resolving an
   * ambiguous printing changes the card itself, and there the sheet closing is
   * the right answer: that question has been settled.
   */
  const sheetTarget = useMemo(() => {
    if (!sheet) return null;
    const byKey = entries.find((e) => e.key === sheet.entry.key);
    if (byKey) return { ...sheet, entry: byKey };
    const sameCard = entries
      .filter((e) => e.cardId === sheet.entry.cardId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return sameCard ? { ...sheet, entry: sameCard } : null;
  }, [sheet, entries]);

  const ownedIds = useMemo(() => new Set(entries.map((e) => e.cardId)), [entries]);
  const wishedIds = useMemo(() => new Set(wishlist.map((w) => w.cardId)), [wishlist]);
  const sessionEntries = useMemo(
    () => entries.filter((e) => e.updatedAt >= sessionStart.current),
    [entries],
  );

  if (bootError) {
    return (
      <Shell>
        <View style={styles.center}>
          <Text style={styles.err}>Could not start the engine</Text>
          <Text style={styles.muted}>{bootError}</Text>
        </View>
      </Shell>
    );
  }

  if (!engine || !loaded) {
    return (
      <Shell>
        <View style={styles.center}>
          <View style={styles.loadCard}>
            <Text style={styles.brand}>
              Bulk<Text style={styles.brandDot}>Sift</Text>
            </Text>
            <ActivityIndicator color={c.accent} />
            <Text style={styles.muted}>Loading 20,444 card fingerprints</Text>
            <Text style={styles.loadHint}>Everything is on this phone. No account, no upload.</Text>
          </View>
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <View style={{ flex: 1 }}>
        {tab === 'scan' ? (
          ScannerScreen ? (
            <ScannerScreen
              engine={engine}
              onHit={onHit}
              sessionCount={sessionEntries.reduce((n, e) => n + e.quantity, 0)}
              sessionValue={sessionEntries.reduce((v, e) => v + entryValue(e), 0)}
              onOpenCollection={() => setTab('collection')}
            />
          ) : (
            <View style={styles.center}>
              <Text style={styles.muted}>
                Scanning needs a phone camera. Everything else works here.
              </Text>
            </View>
          )
        ) : null}

        {tab === 'collection' ? (
          <CollectionScreen
            entries={entries}
            history={history}
            wishlist={wishlist}
            wishlistValue={wishlistValue(wishlist)}
            onOpen={openEntry}
            onScan={() => setTab('scan')}
            onBrowse={() => setTab('browse')}
            onUnwish={(cardId) =>
              setWishlist((prev) => prev.filter((w) => w.cardId !== cardId))}
          />
        ) : null}

        {tab === 'sets' ? (
          <SetsScreen
            entries={entries}
            sets={engine.sets}
            onOpenSet={(id) => { setSetFilter(id); setTab('browse'); }}
          />
        ) : null}

        {tab === 'browse' ? (
          <BrowseScreen
            cards={engine.cards}
            variantsFor={variantsFor}
            ownedIds={ownedIds}
            setFilter={setFilter}
            setNameFor={(id) => engine.sets.find((x) => x.id === id)?.name ?? 'Set'}
            onClearSetFilter={() => setSetFilter(null)}
            onAdd={addManual}
            wishedIds={wishedIds}
            onWish={(card, price) => setWishlist((prev) => toggleWish(prev, card, price))}
          />
        ) : null}
      </View>

      <View style={styles.tabs}>
        {TABS.map((x) => {
          const on = tab === x.id;
          return (
            <Pressable
              key={x.id}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
              onPress={() => {
                if (x.id === 'scan' && tab !== 'scan') sessionStart.current = Date.now();
                if (x.id === 'browse' && tab !== 'browse') setSetFilter(null);
                setTab(x.id);
              }}
            >
              <x.Icon size={23} color={on ? c.accent : c.faint} strong={on} />
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{x.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <CardSheet
        target={sheetTarget}
        variantsFor={variantsFor}
        onClose={() => setSheet(null)}
        onQuantity={(key, q) => setEntries((prev) => setQuantity(prev, key, q))}
        onCondition={(key, condition) =>
          setEntries((prev) => reclassify(prev, key, { condition }))}
        onVariant={(key, variant, unitPrice) =>
          setEntries((prev) => reclassify(prev, key, { variant, unitPrice }))}
        onRepoint={(key, card, variant, price) =>
          setEntries((prev) => repoint(prev, key, card, variant, price))}
        onGrade={(key, grade: Grade | null) =>
          setEntries((prev) => regrade(prev, key, grade))}
        onDelete={(key) => {
          setEntries((prev) => setQuantity(prev, key, 0));
          setSheet(null);
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: s.xl, gap: s.md,
  },
  muted: { ...t.meta, color: c.dim, textAlign: 'center' },
  err: { ...t.body, color: c.bad },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: c.line,
    backgroundColor: c.surface,
    paddingTop: 7, paddingBottom: 5,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabText: { fontSize: 10.5, color: c.faint, fontWeight: '700', letterSpacing: 0.1 },
  tabTextOn: { color: c.accent, fontWeight: '800' },
  loadCard: {
    alignItems: 'center', gap: s.md, paddingHorizontal: s.xl, paddingVertical: s.xxl,
    borderRadius: r.xl, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.lineSoft, ...shadow.high,
  },
  brand: { ...t.title, fontSize: 27, color: c.text, letterSpacing: -0.6 },
  brandDot: { color: c.accent },
  loadHint: { ...t.tiny, color: c.faint, textAlign: 'center' },
});
