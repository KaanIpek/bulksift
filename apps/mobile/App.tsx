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
import ScannerScreen from './src/ScannerScreen';
import SetsScreen from './src/SetsScreen';
import {
  addScan, defaultVariant, entryValue, reclassify, repoint, setQuantity,
  type ConditionId, type Entry, type WishEntry,
} from './src/collection';
import { loadCollection, saveCollection } from './src/collectionStore';
import { loadEngine, type LoadedEngine } from './src/engine';
import { c, s, t } from './src/ui/theme';

type Tab = 'scan' | 'collection' | 'sets' | 'browse';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scan', label: 'Scan' },
  { id: 'collection', label: 'Collection' },
  { id: 'sets', label: 'Sets' },
  { id: 'browse', label: 'Browse' },
];

export default function App() {
  const [engine, setEngine] = useState<LoadedEngine | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('scan');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [wishlist, setWishlist] = useState<WishEntry[]>([]);
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
      void saveCollection({ version: 1, entries, wishlist });
    }, 700);
    return () => clearTimeout(id);
  }, [entries, wishlist, loaded]);

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

  // Keep the open sheet pointing at live data as the collection changes.
  const sheetTarget = useMemo(() => {
    if (!sheet) return null;
    const fresh = entries.find((e) => e.key === sheet.entry.key);
    return fresh ? { ...sheet, entry: fresh } : null;
  }, [sheet, entries]);

  const ownedIds = useMemo(() => new Set(entries.map((e) => e.cardId)), [entries]);
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
          <ActivityIndicator color={c.accent} />
          <Text style={styles.muted}>Loading 20,000 card fingerprints…</Text>
        </View>
      </Shell>
    );
  }

  return (
    <Shell>
      <View style={{ flex: 1 }}>
        {tab === 'scan' ? (
          <ScannerScreen
            engine={engine}
            onHit={onHit}
            sessionCount={sessionEntries.reduce((n, e) => n + e.quantity, 0)}
            sessionValue={sessionEntries.reduce((v, e) => v + entryValue(e), 0)}
            onOpenCollection={() => setTab('collection')}
          />
        ) : null}

        {tab === 'collection' ? (
          <CollectionScreen
            entries={entries}
            onOpen={openEntry}
            onScan={() => setTab('scan')}
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
          />
        ) : null}
      </View>

      <View style={styles.tabs}>
        {TABS.map((x) => (
          <Pressable
            key={x.id}
            style={styles.tab}
            onPress={() => {
              if (x.id === 'scan' && tab !== 'scan') sessionStart.current = Date.now();
              if (x.id === 'browse' && tab !== 'browse') setSetFilter(null);
              setTab(x.id);
            }}
          >
            <View style={[styles.tabDot, tab === x.id && styles.tabDotOn]} />
            <Text style={[styles.tabText, tab === x.id && styles.tabTextOn]}>{x.label}</Text>
          </Pressable>
        ))}
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
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 9, paddingBottom: 7, gap: 5 },
  tabDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabDotOn: { backgroundColor: c.accent },
  tabText: { ...t.tiny, color: c.faint, fontWeight: '600' },
  tabTextOn: { color: c.text, fontWeight: '800' },
});
