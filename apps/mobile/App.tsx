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
  ActivityIndicator, AppState, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { CardRecord, PriceBook, PricedVariant, ScanHit } from '@bulksift/core';
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
  addScan, defaultVariant, entryKey, entryValue, reclassify, regrade, repoint, reprice,
  repriceWishlist, setQuantity,
  toggleWish, totalCards, totalValue, wishlistValue,
  type ConditionId, type Entry, type Grade, type WishEntry,
} from './src/collection';
import { load, save } from './src/collectionStore';
import { freshness, isStale, refreshDue, type PriceState } from './src/prices';
import { cached, refresh as fetchPrices } from './src/pricesStore';
import {
  canScan, canWatchAd, fresh, grantAd, grantPack, refill, refund, retune, scansLeft, setLimits,
  setPro, spend, type Entitlement,
} from './src/entitlement';
import { DEFAULT_OFFER, OFFERS, pickOffer, shouldWelcome, type OfferId } from './src/offer';
import { fetchOffer } from './src/offerStore';

/*
 * Looking at the paywall in a browser.
 *
 * The web target is how every screen gets looked at, and the store does not
 * exist there - so the plan picker, the one part of the paywall that states a
 * price, could not be seen anywhere but a phone with a sandbox account. In a
 * development web build only:
 *
 *   ?demo=settings        open the paywall for that reason, with sample plans
 *   ?demo=welcome&offer=tight&weekly=1
 *
 * The sample plans and packs have the store's shape. Their amounts are the US
 * prices in docs/SETUP.md, typed here by hand - which is exactly what the real
 * paywall never does - except the weekly one, which does not exist and is
 * invented. Nothing can be bought: the purchase handlers below still refuse
 * while the real store is not ready. `__DEV__` is false in every build that
 * ships, so none of this runs on a phone.
 */
const DEMO = __DEV__ && Platform.OS === 'web' && typeof location !== 'undefined'
  ? new URLSearchParams(location.search) : null;
const DEMO_REASON = DEMO?.get('demo') ?? null;
const DEMO_PLANS: Plan[] = DEMO_REASON ? [
  { id: 'demo.yearly', price: '$29.99', amount: 29.99, period: 'year' },
  { id: 'demo.monthly', price: '$4.99', amount: 4.99, period: 'month' },
  ...(DEMO?.get('weekly')
    ? [{ id: 'demo.weekly', price: '$3.99', amount: 3.99, period: 'week' as const, trialDays: 3 }]
    : []),
] : [];
const DEMO_PACKS: Product[] = DEMO_REASON ? [
  { id: 'com.rldgames.bulksift.credits.200', title: '200 scans', price: '$1.99', credits: 200 },
  { id: 'com.rldgames.bulksift.credits.1000', title: '1,000 scans', price: '$5.99', credits: 1000 },
  { id: 'com.rldgames.bulksift.credits.5000', title: '5,000 scans', price: '$14.99', credits: 5000 },
] : [];
import {
  active, add as addCollection, freshLibrary, moveCard, remove as removeCollection,
  rename as renameCollection, setActive, update as updateCollection,
  type Collection, type Library,
} from './src/library';
import Paywall, { type PaywallReason } from './src/Paywall';
import SettingsScreen from './src/SettingsScreen';
import { syncOnce, type Bases } from './src/sync';
import { authState, restoreSession } from './src/auth';
import { runSelfTest } from './src/selfTest';
import { shareCapture, type CapturedRead } from './src/capture';
import { setSoundEnabled } from './src/feedback';
import {
  DEFAULT_RULE, emptyTally, firstEditionSetAside, pileFor, pileOfHit, sortable, sortPrice, tally,
  type SortRule,
} from './src/sort';
import CollectionBar from './src/CollectionBar';
import AddCardSheet, { type AddTarget } from './src/AddCardSheet';
import {
  adsAvailable, buy, configure as configureStore, currentPro, plans as storePlans,
  products as storeProducts, restore, showRewardedAd, storeState, subscribe, configureAds,
  type Plan, type Product,
} from './src/store';
import { record, type Point } from './src/history';
import { loadEngine, type LoadedEngine } from './src/engine';
import {
  CollectionIcon, ScanIcon, SearchIcon,
  SettingsIcon, SetsIcon, type IconProps,
} from './src/ui/icons';
import {
  ScanFeed, ScanOverlay, ScanSummary, ScanViewport, type ScannedRow,
} from './src/ui/ScanChrome';
import { c, r, s, shadow, t } from './src/ui/theme';

type Tab = 'scan' | 'collection' | 'sets' | 'browse' | 'settings';

const TABS: Array<{
  id: Tab; label: string; Icon: (p: IconProps) => React.ReactElement;
}> = [
  { id: 'scan', label: 'Scan', Icon: ScanIcon },
  { id: 'collection', label: 'Collection', Icon: CollectionIcon },
  { id: 'sets', label: 'Sets', Icon: SetsIcon },
  { id: 'browse', label: 'Browse', Icon: SearchIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function App() {
  const [engine, setEngine] = useState<LoadedEngine | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('scan');

  /**
   * Every collection, and which one is on screen.
   *
   * The screens below still receive one collection's entries, wishlist and
   * history exactly as they did when there was only ever one - the library is
   * unwrapped here rather than pushed down into five components that have no
   * business knowing there is more than one box.
   */
  const [library, setLibrary] = useState<Library>(() => freshLibrary(Date.now()));
  const [ent, setEnt] = useState<Entitlement>(() => fresh(Date.now()));
  const [loaded, setLoaded] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  /*
   * The engine self-test, run from Settings.
   *
   * It lives up here rather than inside the screen because it needs the loaded
   * engine, and because App Review has to be able to reach it in a release
   * build - it used to run only under __DEV__, which meant the one audience
   * that cannot test this app with real cards was also the one audience that
   * could not run it.
   */
  const [selfTest, setSelfTest] = useState<string[] | null>(null);
  /*
   * Waiting for the scanner to hand back one rectified card.
   *
   * Armed from Settings and consumed by the next processed frame, so the user
   * arms it, points at the card that will not read, and the file appears. The
   * alternative - capturing continuously and keeping the last one - costs a
   * rectify on every frame for something wanted about twice a month.
   */
  const [sound, setSound] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  /*
   * The engine's numbers, off by default.
   *
   * Kept in memory rather than saved: it is a thing you turn on to answer one
   * question and should not still be there tomorrow.
   */
  const [showDiag, setShowDiag] = useState(false);
  /** What each collection was last agreed on with the server. See `Saved`. */
  const [bases, setBases] = useState<Bases>({});
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddTarget | null>(null);
  /**
   * The price book actually in use, and when it was last checked.
   *
   * The engine ships with a snapshot so a fresh install works offline on day
   * one. A newer file downloaded yesterday is preferred over it, and a refresh
   * replaces both - and then walks the collection, because a price stored on an
   * entry when it was scanned is a price from whatever date that was.
   */
  const [priceState, setPriceState] = useState<PriceState>({ updated: '', checkedAt: 0 });
  const [refreshing, setRefreshing] = useState(false);
  /** Packs on sale, and whether a purchase is in flight. */
  const [packs, setPacks] = useState<Product[]>([]);
  /** Subscription plans on sale. The paywall shows these and buys one by id. */
  const [plans, setPlans] = useState<Plan[]>([]);
  const [buying, setBuying] = useState(false);
  /*
   * Which offer this install is on, and whether its introductory paywall has
   * been shown. Both are saved: the offer so a phone with no signal stays on
   * the one it was last told, the flag so "once" survives a restart.
   */
  const [offerId, setOfferId] = useState<OfferId>(DEFAULT_OFFER);
  const [welcomed, setWelcomed] = useState(false);
  /** Counts returns to the foreground, so once-a-day checks can run on one. */
  const [resumes, setResumes] = useState(0);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [setFilter, setSetFilter] = useState<string | null>(null);

  /**
   * What this scanning session has actually put in, counted as it happens.
   *
   * It used to be derived: every entry whose `updatedAt` had moved since the
   * session began, summed by quantity. But `addScan` stamps `updatedAt` on the
   * pile it increments while the quantity stays the running total, so scanning
   * a thirteenth copy of a card you already owned made the two biggest numbers
   * on the scan screen read thirteen cards. Sifting a second box of a set you
   * have touched before - the normal case - made both figures arbitrary.
   *
   * Undo and redirect made it worse rather than better: both route through
   * `setQuantity`, which also stamps `updatedAt`, so undoing a scan left the
   * whole pre-existing pile counted and correcting a misread counted both
   * piles. The one place a mistake could be fixed inflated the number above it.
   *
   * A ledger has none of that: one card in, one card out, and it says only what
   * it was told.
   */
  const [session, setSession] = useState({ count: 0, value: 0 });

  /**
   * The sort lines, and how many cards have landed on each pile this session.
   *
   * The tally is a ledger for the same reason the session total above is: one
   * card on, one card off, and it says only what it was told. It is kept beside
   * `session` rather than inside it so that turning sorting on half-way through
   * a box does not have to invent piles for the cards already passed.
   */
  const [sortRule, setSortRule] = useState<SortRule>(DEFAULT_RULE);
  const [piles, setPiles] = useState(emptyTally);

  /**
   * The last few cards, held here rather than in the scanner.
   *
   * ScannerScreen is unmounted whenever another tab is on top, so keeping this
   * inside it meant the feed's own "Open collection" link destroyed every undo
   * the user might have wanted to reach.
   */
  const [recent, setRecent] = useState<ScannedRow[]>([]);
  /** Read by `undoScan`, which is created once and cannot close over the list. */
  const recentRef = useRef<ScannedRow[]>(recent);
  recentRef.current = recent;

  /*
   * The active collection, unwrapped.
   *
   * Every screen below still takes `entries`, `wishlist` and `history` exactly
   * as it did when there was one collection. The setters write back into
   * whichever collection is active, so switching collections is a one-line
   * state change here and nothing at all anywhere else.
   */
  const current = active(library);
  const { entries, wishlist, history } = current;

  const inActive = useCallback(
    (change: (c: Collection) => Collection) =>
      setLibrary((lib) => updateCollection(lib, lib.activeId, change, Date.now())),
    [],
  );
  const setEntries = useCallback(
    (next: Entry[] | ((prev: Entry[]) => Entry[])) =>
      inActive((c) => ({
        ...c, entries: typeof next === 'function' ? next(c.entries) : next,
      })),
    [inActive],
  );
  const setWishlist = useCallback(
    (next: WishEntry[] | ((prev: WishEntry[]) => WishEntry[])) =>
      inActive((c) => ({
        ...c, wishlist: typeof next === 'function' ? next(c.wishlist) : next,
      })),
    [inActive],
  );
  const setHistory = useCallback(
    (next: Point[] | ((prev: Point[]) => Point[])) =>
      inActive((c) => ({
        ...c, history: typeof next === 'function' ? next(c.history) : next,
      })),
    [inActive],
  );

  /*
   * Start the store, and ask it once whether the subscription is active.
   *
   * Only the subscription is read back. A pack is granted at the moment it is
   * bought; re-reading it here would grant it again on every launch, because a
   * consumable stays in the purchase history forever.
   */
  useEffect(() => {
    let cancelled = false;
    void configureAds();
    void configureStore().then(async () => {
      if (cancelled) return;
      const pro = await currentPro();
      if (!cancelled && pro != null) setEnt((e) => setPro(e, pro));
      const list = await storeProducts();
      if (!cancelled) setPacks(list.filter((x) => x.credits));
      const subs = await storePlans();
      if (!cancelled) setPlans(subs);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((e) => { if (!cancelled) setEngine(e); })
      .catch((err: unknown) => {
        const msg = String((err as Error)?.message ?? err);
        console.log(`[BulkSift] engine load failed: ${msg}`);
        if (!cancelled) setBootError(msg);
      });
    load()
      .then((data) => {
        if (cancelled) return;
        setLibrary(data.library);
        setBases(data.bases);
        setSortRule(data.sort ?? DEFAULT_RULE);
        // The offer this phone was last told it is on comes first, because
        // the refill below hands out that offer's ration.
        const stored = pickOffer(null, data.offer);
        setLimits(OFFERS[stored].limits);
        setOfferId(stored);
        setWelcomed(data.welcomed === true);
        // Refill on open, not on a timer: an app that was closed overnight has
        // to notice the new day the moment it is looked at.
        setEnt(retune(refill(data.entitlement, Date.now())));
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
      void save({
        library, entitlement: ent, bases, sort: sortRule, offer: offerId, welcomed,
      });
    }, 700);
    return () => clearTimeout(id);
  }, [library, ent, bases, sortRule, loaded, offerId, welcomed]);

  /*
   * Ask which offer is live.
   *
   * On open and each time the app comes back to the front. No answer changes
   * nothing: an install keeps the offer it has rather than falling back to a
   * default every time it loses signal.
   */
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const ask = () => {
      void fetchOffer().then((remote) => {
        if (cancelled || !remote) return;
        setOfferId(remote);
      });
    };
    const forced = DEMO?.get('offer');
    if (forced) setOfferId(pickOffer(forced, null));
    else ask();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !forced) ask();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [loaded]);

  /* A changed offer changes the ration; the record follows it here. */
  useEffect(() => {
    if (!loaded) return;
    setLimits(OFFERS[offerId].limits);
    setEnt((e) => retune(e));
  }, [offerId, loaded]);

  /*
   * A new day while the app was open.
   *
   * The allowance used to refill only in `load`, which runs once per process.
   * iOS keeps a suspended app alive for days, so someone who ran out on Monday
   * and came back on Tuesday without force-quitting was still "out of scans
   * for today" - and the paywall told them the scans would be back tomorrow.
   * The price check had the same shape: due once a day, asked only at launch.
   */
  useEffect(() => {
    if (!loaded) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setEnt((e) => refill(e, Date.now()));
      setResumes((n) => n + 1);
    });
    return () => sub.remove();
  }, [loaded]);

  /*
   * Ask the store again when the paywall opens with nothing to sell.
   *
   * The lists above are read once, at launch. A phone that was offline then -
   * the basement, the card show - would otherwise show a paywall with no plans
   * for as long as the app stayed in memory, even after the signal came back.
   */
  useEffect(() => {
    if (!paywall || plans.length) return;
    let cancelled = false;
    void storePlans().then((subs) => { if (!cancelled && subs.length) setPlans(subs); });
    void storeProducts().then((list) => {
      const found = list.filter((x) => x.credits);
      if (!cancelled && found.length) setPacks(found);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paywall]);

  useEffect(() => {
    if (!loaded || !DEMO_REASON || DEMO_REASON === 'welcome') return;
    setPaywall(DEMO_REASON as PaywallReason);
  }, [loaded]);

  /* The introductory paywall: once, before the first scan, if the offer asks. */
  useEffect(() => {
    if (!loaded || paywall) return;
    if (!shouldWelcome(OFFERS[offerId], ent, welcomed)) return;
    setWelcomed(true);
    setPaywall('welcome');
  }, [loaded, offerId, ent, welcomed, paywall]);

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

  /**
   * Pull, merge, push - once.
   *
   * The merge itself is in `merge.ts` and is where the difficulty lives: a pile
   * has a quantity, so last-write-wins is wrong. Three here and two on a tablet
   * is five, not three.
   *
   * Nothing is written unless the whole round trip worked. The device's own
   * collection is the thing that must survive, and a half-applied sync is worse
   * than no sync - which is also why the agreed base is only recorded after the
   * push succeeds.
   */
  const runSync = useCallback(async (announce: boolean) => {
    if (syncing || !loaded) return;
    setSyncing(true);
    try {
      const out = await syncOnce(library, bases, Date.now());
      if (out.status === 'synced') {
        setLibrary(out.library);
        if (out.bases) setBases(out.bases);
        if (announce) setSyncNote('Collections synced.');
      } else if (announce) {
        setSyncNote(out.status === 'signed-out'
          ? 'Sign in to sync between devices.'
          : `Could not sync: ${out.reason}`);
      }
    } finally {
      setSyncing(false);
    }
  }, [library, bases, syncing, loaded]);

  /*
   * The latest `runSync`, reachable from a listener that outlives it.
   *
   * `runSync` closes over the collection, so it is a different function on
   * every scan - several times a second during a bulk session. A listener
   * registered once therefore holds the version from the moment it was
   * registered, which is app launch, and would sync the collection as it was
   * then: an evening of scanning would not be pushed at all, and against a
   * server that already had some of those cards the stale base would subtract
   * them. Re-registering instead would tear the listener down and rebuild it
   * several times a second.
   *
   * A ref is the way out of that pair: one listener, always the current
   * function.
   */
  const syncRef = useRef(runSync);
  syncRef.current = runSync;

  /*
   * Sync when the app is opened and whenever it comes back to the front.
   *
   * Not on every change: a bulk session touches hundreds of piles a minute and
   * pushing each one would be hundreds of round trips to compute something the
   * merge needs all of at once. Coming back to the front is the moment the
   * other device's copy might have moved.
   */
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void restoreSession().then(() => {
      if (!cancelled) void syncRef.current(false);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncRef.current(false);
    });
    return () => { cancelled = true; sub.remove(); };
  }, [loaded]);

  const variantsFor = useCallback(
    (cardId: string): PricedVariant[] => engine?.scanner.pricesFor(cardId) ?? [],
    [engine],
  );

  /*
   * Returns the collection key the scan landed in.
   *
   * The scan feed needs it to undo or redirect a row. Recomputing the key in
   * the feed would work today and break the first time a scan merges into an
   * existing pile under a different condition, so the writer says where it
   * wrote instead of the reader guessing.
   */
  const onHit = useCallback((hit: ScanHit): string => {
    /*
     * The allowance is spent here, at the one place a scan actually becomes a
     * card. Checking it on the scan screen instead would mean the engine could
     * recognise a card, show it, and then not record it - which reads as a bug
     * rather than a limit.
     */
    // Refilled first: a session that runs past midnight is on a new day, and
    // `refill` returns the same object when it is not, so this costs nothing.
    if (canScan(refill(ent, Date.now())) !== 'none') {
      setPaywall('out-of-scans');
      return '';
    }
    setEnt((e) => spend(refill(e, Date.now())));
    const variants = engine?.scanner.pricesFor(hit.card.i) ?? [];
    const pick = defaultVariant(variants);
    // A card the sorter judged without its 1st Edition printing is flagged the
    // same way an unsettled reprint is: PICK PRINTING, so the stamp gets looked at.
    const checkPrinting = !!hit.ambiguity || firstEditionSetAside(variants);
    setEntries((prev) =>
      addScan(prev, hit.card, pick.name, pick.price, 'NM', checkPrinting),
    );
    // Outside the updater: React may re-invoke one, and a double-counted
    // session is precisely the drifting total this replaced.
    setSession((s) => ({ count: s.count + 1, value: s.value + (pick.price ?? 0) }));
    // The same call the scan screen makes for the sound, with the same inputs,
    // so the pile that was heard is the pile that is counted.
    const pile = pileOfHit(hit, (id) => engine?.scanner.pricesFor(id) ?? [], sortRule);
    if (pile) setPiles((t) => tally(t, pile, pick.price));
    return entryKey(hit.card.i, pick.name, 'NM');
  }, [engine, ent, sortRule]);

  /**
   * Take one copy back off a pile - the scan feed's "that was not a card".
   *
   * The scan is given back too. A read that was never a card should not cost
   * an allowance, and the alternative - charging for the app's own mistake -
   * is the kind of thing that turns a limit into a grievance.
   */
  const undoScan = useCallback((key: string) => {
    setEnt(refund);
    // Take it off the pile it was counted on. The row remembers which, because
    // the rule may have been changed since and re-deriving it would then take
    // the card off a pile it was never on.
    const row = recentRef.current.find((r) => r.entryKey === key);
    if (row?.pile) {
      // Outside the updater below: React may re-invoke one, and a card taken
      // off its pile twice is the drifting total the ledger exists to prevent.
      const pile = row.pile;
      const value = row.price;
      setPiles((t) => tally(t, pile, value, -1));
    }
    setEntries((prev) => {
      const found = prev.find((e) => e.key === key);
      if (!found) return prev;
      setSession((s) => ({
        count: Math.max(0, s.count - 1),
        value: Math.max(0, s.value - (found.unitPrice ?? 0)),
      }));
      return setQuantity(prev, key, found.quantity - 1);
    });
    setRecent((prev) => prev.filter((r) => r.entryKey !== key));
  }, []);

  /**
   * The scanner was close but wrong: take the copy off the card it chose and
   * put one on the card the user picked instead.
   */
  const redirectScan = useCallback((key: string, cardId: string): string => {
    const card = engine?.byId.get(cardId);
    if (!card) return key;
    const variants = engine!.scanner.pricesFor(cardId);
    const pick = defaultVariant(variants);
    const was = entries.find((e) => e.key === key)?.unitPrice ?? 0;
    setEntries((prev) => {
      const found = prev.find((e) => e.key === key);
      const without = found ? setQuantity(prev, key, found.quantity - 1) : prev;
      return addScan(without, card, pick.name, pick.price, 'NM', firstEditionSetAside(variants));
    });
    // The card count is unchanged - one card was scanned and it is still one
    // card. Only what it is worth moves.
    setSession((s) => ({ ...s, value: Math.max(0, s.value + (pick.price ?? 0) - (was ?? 0)) }));
    const nextKey = entryKey(cardId, pick.name, 'NM');
    /*
     * A corrected card may belong on a different pile, so move it - and point
     * the row at its new collection key, which also fixes an older gap: the
     * feed tracked the new key privately, so a later undo could not find the
     * row here and left it on screen.
     */
    const row = recentRef.current.find((r) => r.entryKey === key);
    const nextPile = row?.pile
      ? pileFor(sortPrice(sortable(variants).map((v) => v.market)), sortRule)
      : null;
    if (row?.pile && nextPile) {
      const from = row.pile;
      setPiles((t) => tally(tally(t, from, was, -1), nextPile, pick.price));
    }
    setRecent((prev) => prev.map((r) => (
      r.entryKey === key ? { ...r, entryKey: nextKey, pile: nextPile ?? r.pile } : r
    )));
    return nextKey;
  }, [engine, entries, sortRule]);

  /**
   * Add by hand, with every choice made explicitly.
   *
   * Unlike a scan this costs no allowance: nothing was recognised, the user
   * typed a name and picked a printing themselves, and charging for that would
   * be charging for using a search box.
   */
  const addManual = useCallback(
    (
      card: CardRecord, variant: string, price: number | null,
      condition: ConditionId, quantity: number, collectionId: string,
    ) => {
      setLibrary((lib) => updateCollection(lib, collectionId, (col) => {
        let entries = col.entries;
        for (let i = 0; i < quantity; i++) {
          entries = addScan(entries, card, variant, price, condition, false);
        }
        return { ...col, entries };
      }, Date.now()));
    },
    [],
  );

  /**
   * Take a newer price book into use, and re-price everything already collected.
   *
   * The second half is the point. Without it a refresh moves the prices shown
   * in Browse and leaves the collection quoting whatever the market said on the
   * day each card was scanned - so the headline total is a mixture of dates and
   * the value chart records when someone scanned rather than what the market
   * did.
   */
  const applyPrices = useCallback((book: PriceBook) => {
    if (!engine) return;
    engine.scanner.usePrices(book);
    setLibrary((lib) => ({
      ...lib,
      collections: lib.collections.map((col) => {
        const entries = reprice(col.entries, (cardId, variant) => {
          const v = engine.scanner.pricesFor(cardId).find((x) => x.variant === variant);
          return v?.market ?? null;
        });
        const wishlist = repriceWishlist(col.wishlist, (cardId) => {
          const v = engine.scanner.pricesFor(cardId).find((x) => x.market != null);
          return v?.market ?? null;
        });
        return entries === col.entries && wishlist === col.wishlist
          ? col
          : { ...col, entries, wishlist };
      }),
    }));
    setPriceState({ updated: book.updated, checkedAt: Date.now() });
  }, [engine]);

  /**
   * Check for newer prices.
   *
   * Free once a day for everyone, because serving the file costs us nothing and
   * an app whose prices are stale is not limited, it is wrong. Pro may ask any
   * time, which is a convenience rather than a correctness fix.
   */
  const refreshPrices = useCallback(async (force = false) => {
    if (refreshing || !engine) return;
    setRefreshing(true);
    try {
      const out = await fetchPrices(engine.scanner.priceBook, { force });
      if (out.status === 'updated') applyPrices(out.book);
      else if (out.status === 'current') setPriceState((p) => ({ ...p, checkedAt: Date.now() }));
    } finally {
      setRefreshing(false);
    }
  }, [engine, refreshing, applyPrices]);

  /*
   * On open: prefer a file downloaded earlier over the bundled snapshot, then
   * check for a newer one once a calendar day.
   */
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    void cached().then((book) => {
      if (cancelled || !book) return;
      if (book.updated > engine.scanner.priceUpdated) applyPrices(book);
      else setPriceState({ updated: engine.scanner.priceUpdated, checkedAt: 0 });
    });
    return () => { cancelled = true; };
  }, [engine, applyPrices]);

  useEffect(() => {
    if (!engine || !loaded) return;
    if (refreshDue(priceState, Date.now())) void refreshPrices(false);
    // Deliberately not depending on `refreshPrices`: it changes identity while
    // a refresh is in flight, and re-running this then would start a second.
    // `resumes` is here so the check also runs when the app comes back to the
    // front on a later day; `refreshDue` still makes it once per calendar day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, loaded, priceState.checkedAt, resumes]);

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
              sessionCount={session.count}
              sessionValue={session.value}
              sortRule={sortRule}
              piles={piles}
              recent={recent}
              onRecent={setRecent}
              onResetSession={() => {
                setSession({ count: 0, value: 0 }); setPiles(emptyTally()); setRecent([]);
              }}
              onOpenCollection={() => setTab('collection')}
              showDiag={showDiag}
              scansLeft={scansLeft(ent)}
              onUndo={undoScan}
              onRedirect={redirectScan}
              onCaptured={async (read: CapturedRead) => {
                setCapturing(false);
                try {
                  const name = await shareCapture(read, Date.now());
                  setCaptureNote(`Saved ${name}`);
                } catch (e) {
                  setCaptureNote(`Could not save: ${String((e as Error)?.message ?? e)}`);
                }
              }}
            />
          ) : (
            <ScanPreview
              sessionCount={session.count}
              sessionValue={session.value}
              recent={entries.slice(0, 4)}
              scansLeft={scansLeft(ent)}
              sortRule={sortRule}
              onOpenCollection={() => setTab('collection')}
              onResetSession={() => {
                setSession({ count: 0, value: 0 }); setPiles(emptyTally()); setRecent([]);
              }}
            />
          )
        ) : null}

        {tab === 'collection' ? (
          <View style={{ flex: 1 }}>
            <View style={styles.bar}>
              <CollectionBar
                library={library}
                pro={ent.pro}
                onSelect={(id) => setLibrary((lib) => setActive(lib, id))}
                onCreate={(name) => setLibrary((lib) => addCollection(lib, name, Date.now()))}
                onRename={(id, name) =>
                  setLibrary((lib) => renameCollection(lib, id, name, Date.now()))}
                onDelete={(id) => setLibrary((lib) => removeCollection(lib, id))}
                onWantPro={() => setPaywall('collections')}
              />
            </View>
            <CollectionScreen
            entries={entries}
            history={history}
            wishlist={wishlist}
            wishlistValue={wishlistValue(wishlist)}
            onOpen={openEntry}
            onScan={() => setTab('scan')}
            onBrowse={() => setTab('browse')}
            onBackUp={
              authState() === 'signed-in' ? undefined : () => setTab('settings')
            }
            onUnwish={(cardId) =>
              setWishlist((prev) => prev.filter((w) => w.cardId !== cardId))}
            priceNote={
              priceState.updated
                ? `Prices ${freshness(priceState.updated, Date.now())}`
                : 'Prices from this build'
            }
            priceStale={!!priceState.updated && isStale(priceState.updated, Date.now())}
            onRefreshPrices={() => void refreshPrices(true)}
            refreshing={refreshing}
            />
          </View>
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
            onAdd={(card) =>
              setAdding({ card, variants: variantsFor(card.i) })}
            wishedIds={wishedIds}
            onWish={(card, price) => setWishlist((prev) => toggleWish(prev, card, price))}
          />
        ) : null}
        {tab === 'settings' ? (
          <SettingsScreen
            ent={ent}
            priceUpdated={priceState.updated}
            onRefreshPrices={() => void refreshPrices(true)}
            refreshing={refreshing}
            onOpenPaywall={() => setPaywall('settings')}
            onProChanged={(pro) => setEnt((e) => setPro(e, pro))}
            onSync={() => void runSync(true)}
            syncing={syncing}
            syncNote={syncNote}
            sound={sound}
            onToggleSound={() => {
              const next = !sound;
              setSound(next);
              setSoundEnabled(next);
            }}
            sortRule={sortRule}
            onSortRule={setSortRule}
            onArmCapture={() => {
              if (!engine) return;
              engine.scanner.captureNext();
              setCapturing(true);
              setCaptureNote('Point at the card that will not read.');
              setTab('scan');
            }}
            capturing={capturing}
            captureNote={captureNote}
            showDiag={showDiag}
            onToggleDiag={() => setShowDiag((v) => !v)}
            onRunSelfTest={() => {
              if (!engine) return;
              setSelfTest(['running…']);
              void runSelfTest(engine.scanner)
                .then((r) => setSelfTest([
                  `engine self-test: ${r.correct}/${r.total} correct`, ...r.lines,
                ]))
                .catch((err: unknown) => setSelfTest([
                  `self-test failed: ${String((err as Error)?.message ?? err)}`,
                ]));
            }}
            selfTest={selfTest}
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

      <AddCardSheet
        target={adding}
        library={library}
        onClose={() => setAdding(null)}
        onAdd={addManual}
      />

      <Paywall
        reason={paywall}
        entitlement={ent}
        onClose={() => setPaywall(null)}
        storeReady={DEMO_PLANS.length > 0 || storeState() === 'ready'}
        adsReady={adsAvailable()}
        onWatchAd={() => {
          if (!adsAvailable() || buying) return;
          setBuying(true);
          // Credited only when the SDK says the reward was earned - not when
          // the video was merely shown, and not when it was closed.
          void showRewardedAd()
            .then((earned) => { if (earned) setEnt(grantAd); })
            .finally(() => setBuying(false));
        }}
        packs={DEMO_PACKS.length ? DEMO_PACKS : packs}
        plans={DEMO_PLANS.length ? DEMO_PLANS : plans}
        prefer={OFFERS[offerId].prefer}
        busy={buying}
        onBuyCredits={(productId) => {
          if (storeState() !== 'ready' || buying) return;
          setBuying(true);
          void buy(productId)
            .then((r) => {
              if (r.ok && r.credits) setEnt((e) => grantPack(e, r.credits!));
              if (r.ok && r.pro != null) setEnt((e) => setPro(e, r.pro!));
            })
            .finally(() => setBuying(false));
        }}
        onSubscribe={(planId) => {
          if (storeState() !== 'ready' || buying) return;
          setBuying(true);
          void subscribe(planId)
            .then((r) => { if (r.ok && r.pro) setEnt((e) => setPro(e, true)); })
            .finally(() => setBuying(false));
        }}
        onRestore={() => {
          if (buying) return;
          setBuying(true);
          void restore()
            .then((r) => { if (r.ok && r.pro != null) setEnt((e) => setPro(e, r.pro!)); })
            .finally(() => setBuying(false));
        }}
      />

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

/**
 * The scan screen without a camera, for working on it in a browser.
 *
 * The camera is a native module, so on the web the whole screen used to be one
 * line of apologetic text - which meant the app's most-used screen was the only
 * one whose layout could never be looked at without a ten-minute device build.
 * This renders the real chrome around a placeholder, driven by whatever is in
 * the collection, so the states that matter can be checked at phone size.
 *
 * It never ships: `ScannerScreen` is null only on web.
 */
function ScanPreview({
  sessionCount, sessionValue, recent, scansLeft, sortRule, onOpenCollection, onResetSession,
}: {
  /** So the sort tags and the pile strip can be looked at in a browser. */
  sortRule: SortRule;
  sessionCount: number;
  sessionValue: number;
  recent: Entry[];
  /** Real, not a placeholder - the point of this stand-in is to be checkable. */
  scansLeft: number | null;
  onOpenCollection: () => void;
  onResetSession: () => void;
}) {
  const [scanning, setScanning] = useState(true);
  const rows = recent.map((e, i) => ({
    key: e.key,
    entryKey: e.key,
    name: e.name,
    set: e.setName,
    cardId: e.cardId,
    number: e.number,
    rarity: e.rarity,
    price: e.unitPrice,
    unsure: !!e.needsPrinting,
    pile: sortRule.on ? pileFor(e.unitPrice, sortRule) : null,
    // Stand-ins for the matcher's runners-up, which only exist on a real scan.
    others: recent.filter((_, j) => j !== i).slice(0, 3).map((o) => ({
      cardId: o.cardId, name: o.name, set: o.setName,
      number: o.number, rarity: o.rarity, price: o.unitPrice,
    })),
  }));
  const live = recent[0]
    ? {
      name: recent[0].name,
      set: recent[0].setName,
      cardId: recent[0].cardId,
      number: recent[0].number,
    }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScanViewport>
        <View style={styles.noCam}>
          <Text style={styles.noCamText}>camera preview</Text>
        </View>
        <ScanOverlay aim={live ? 'good' : 'idle'} live={live} fps={31} />
      </ScanViewport>
      <ScanSummary
        scansLeft={scansLeft}
        value={sessionValue}
        count={sessionCount}
        piles={sortRule.on
          // Built from the rows on show, since nothing is being scanned here.
          ? recent.reduce(
            (acc, e) => tally(acc, pileFor(e.unitPrice, sortRule), e.unitPrice),
            emptyTally(),
          )
          : null}
        scanning={scanning}
        onToggle={() => setScanning((v) => !v)}
        onReset={onResetSession}
      />
      <ScanFeed
        rows={rows}
        onOpenCollection={onOpenCollection}
        onUndo={() => {}}
        onRedirect={(k) => k}
      />
    </View>
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
  bar: { paddingHorizontal: s.lg, paddingTop: s.sm },
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
  noCam: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1017',
  },
  noCamText: { ...t.tiny, color: c.faint, letterSpacing: 1.4 },
  loadHint: { ...t.tiny, color: c.faint, textAlign: 'center' },
});
