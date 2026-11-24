/**
 * What happens when the scans run out.
 *
 * Three ways forward, and it is deliberate that the free one is offered first:
 * watch a video, buy a pack, or subscribe. An app that has just stopped someone
 * mid-task and leads with its most expensive option reads as a toll gate.
 *
 * The rewarded ad is offered *here* and never on the scan screen. That is not
 * squeamishness - a bright surface next to a glossy card is the single most
 * damaging thing that can happen to a read, worth 210 bits of match quality
 * against 86 for motion blur, so an ad living beside the viewfinder would make
 * the product measurably worse at its one job.
 *
 * Nothing in this file talks to a store or an ad network. It calls back, and
 * the app decides - which is what lets every number below be checked without a
 * sandbox account.
 */

import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LIMITS, type Entitlement } from './entitlement';
import {
  ctaLabel, defaultPlan, planLine, planName, savingPercent, termsLine, type Period, type Plan,
} from './plans';
import type { Product } from './store';
import { CheckIcon, CloseIcon, ScanIcon } from './ui/icons';
import { Badge, Button } from './ui/parts';
import { c, r, s, shadow, t } from './ui/theme';

/** Why the paywall opened, so it can lead with the relevant thing. */
export type PaywallReason =
  | 'out-of-scans' | 'collections' | 'export' | 'browse' | 'settings' | 'welcome';

/** Where the two documents Apple requires beside a subscription live. */
const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const PRIVACY_URL = 'https://kaanipek.github.io/bulksift/privacy.html';

const HEADLINE: Record<PaywallReason, { title: string; sub: string }> = {
  'out-of-scans': {
    title: 'Out of scans for today',
    sub: 'Your free scans come back tomorrow. Until then, there are three ways on.',
  },
  collections: {
    title: 'One collection on the free plan',
    sub: 'Pro keeps the box you are selling apart from the binder you are keeping.',
  },
  export: {
    title: 'Export is a Pro feature',
    sub: 'A CSV of everything you own, priced, ready to list.',
  },
  browse: {
    title: 'BulkSift Pro',
    sub: 'Unlimited scanning, unlimited collections, and export.',
  },
  // Opened deliberately from Settings rather than by hitting a wall, so it
  // leads with what Pro is instead of with what just stopped working.
  settings: {
    title: 'BulkSift Pro',
    sub: 'Unlimited scanning, unlimited collections, and export.',
  },
  // Shown once, before the first scan, and only on an offer that asks for it
  // (see `offer.ts`). It says what the free plan gives before it says what Pro
  // costs, and "Not now" is a real button rather than a faint cross.
  welcome: {
    title: 'Sort a whole box in one sitting',
    sub: 'Every card is named, priced and called to its pile by sound. '
      + 'Try it free, or go unlimited from the start.',
  },
};

const PRO_POINTS = [
  'Unlimited scanning',
  'As many collections as you like',
  'CSV export, priced and ready to list',
  // "Weekly price updates" stood here until 2026-11-24. Prices refresh daily
  // for everyone, paying or not - a point that sold something free was a claim
  // the app could not back, on the one screen where claims are about money.
];

export default function Paywall({
  reason,
  entitlement,
  onClose,
  onWatchAd,
  onBuyCredits,
  packs = [],
  plans = [],
  prefer = null,
  onSubscribe,
  onRestore,
  busy,
  storeReady = false,
  adsReady = false,
}: {
  reason: PaywallReason | null;
  entitlement: Entitlement;
  onClose: () => void;
  /** Offer a rewarded video. Resolves when the SDK says the reward was earned. */
  onWatchAd: () => void;
  onBuyCredits: (productId: string) => void;
  /** Subscribe on the plan the buyer picked. Never called without one. */
  onSubscribe: (planId: string) => void;
  onRestore: () => void;
  /** A purchase or an ad is in flight; every action is disabled meanwhile. */
  busy?: boolean;
  /**
   * Whether the store and the ad network are actually connected.
   *
   * A paywall whose buttons do nothing is worse than one that says why. This
   * is the difference between "we are not finished" and "it is broken", and
   * only one of those is honest.
   */
  storeReady?: boolean;
  adsReady?: boolean;
  /** Credit packs on sale, straight from the store. */
  packs?: Product[];
  /**
   * Subscription plans on sale, straight from the store, best value first.
   * The price on the button is the one in here and nowhere else.
   */
  plans?: Plan[];
  /** The plan length to select first, when it is on sale. */
  prefer?: Period | null;
}) {
  /*
   * Which plan is selected. Reset whenever the paywall opens or the list
   * changes, so a choice made last week on a plan that has since left the
   * store cannot be the one that gets bought.
   */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const planKey = plans.map((p) => p.id).join('|');
  useEffect(() => {
    setPickedId(defaultPlan(plans, prefer)?.id ?? null);
    // `plans` is a fresh array each render; `planKey` is what it contains.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason, planKey, prefer]);

  if (!reason) return null;
  const head = HEADLINE[reason];
  const adsLeft = Math.max(0, LIMITS.adsPerDay - entitlement.adsToday);
  const picked = plans.find((p) => p.id === pickedId) ?? defaultPlan(plans, prefer);
  const canBuy = storeReady && !!picked && !entitlement.pro;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
          <CloseIcon size={17} color={c.dim} />
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: s.xxl }}>
          <Text style={styles.title}>{head.title}</Text>
          <Text style={styles.sub}>{head.sub}</Text>

          {/*
            What is left, stated plainly. A limit that will not tell you where
            you stand is the thing people actually resent, more than the limit.
          */}
          <View style={styles.state}>
            <View style={styles.stateRow}>
              <Text style={styles.stateLabel}>Free scans today</Text>
              <Text style={styles.stateValue}>
                {entitlement.freeLeft} of {Math.max(LIMITS.freePerDay, entitlement.freeLeft)}
              </Text>
            </View>
            <View style={styles.stateRow}>
              <Text style={styles.stateLabel}>Credits</Text>
              <Text style={styles.stateValue}>{entitlement.credits}</Text>
            </View>
            {entitlement.scansEver > 0 ? (
              <View style={styles.stateRow}>
                <Text style={styles.stateLabel}>Scanned all time</Text>
                <Text style={styles.stateValue}>
                  {entitlement.scansEver.toLocaleString('en-US')}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 1. Free. Offered first on purpose. */}
          {reason === 'out-of-scans' ? (
            <View style={styles.option}>
              <View style={styles.optionHead}>
                <Text style={styles.optionTitle}>Watch a short video</Text>
                <Badge label="FREE" tone="good" />
              </View>
              <Text style={styles.optionSub}>
                {adsLeft > 0
                  ? `Adds ${LIMITS.perAd} scans. ${adsLeft} left today.`
                  : 'You have watched today’s videos. They come back tomorrow.'}
              </Text>
              <Button
                label={adsReady ? `Watch for ${LIMITS.perAd} scans` : 'Not available yet'}
                onPress={onWatchAd}
                disabled={busy || !adsReady || adsLeft <= 0 || entitlement.pro}
                icon={<ScanIcon size={15} color={c.text} />}
              />
            </View>
          ) : null}

          {/* 2. A one-off purchase, for people who will not subscribe. */}
          {reason === 'out-of-scans' ? (
            <View style={styles.option}>
              <View style={styles.optionHead}>
                <Text style={styles.optionTitle}>Buy a pack of scans</Text>
              </View>
              <Text style={styles.optionSub}>
                A one-off purchase. No subscription, and the scans never expire.
              </Text>
              {/*
                The packs come from the store, so the prices are the ones the
                user will actually be charged in their own currency - never a
                number typed into this file.
              */}
              {storeReady && packs.length ? (
                <View style={styles.packs}>
                  {packs.map((pack) => (
                    <Pressable
                      key={pack.id}
                      onPress={() => onBuyCredits(pack.id)}
                      disabled={busy}
                      style={({ pressed }) => [styles.pack, pressed && { opacity: 0.75 }]}
                    >
                      <Text style={styles.packCredits}>
                        {(pack.credits ?? 0).toLocaleString('en-US')}
                      </Text>
                      <Text style={styles.packLabel}>scans</Text>
                      <Text style={styles.packPrice}>{pack.price}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Button label="Not available yet" onPress={() => {}} disabled />
              )}
            </View>
          ) : null}

          {/* 3. The subscription. */}
          <View style={[styles.option, styles.pro]}>
            <View style={styles.optionHead}>
              <Text style={styles.proTitle}>BulkSift Pro</Text>
              <Badge label="BEST FOR BULK" tone="accent" />
            </View>
            {PRO_POINTS.map((line) => (
              <View key={line} style={styles.point}>
                <CheckIcon size={15} color={c.accent} strong />
                <Text style={styles.pointText}>{line}</Text>
              </View>
            ))}

            {/*
              The plans, each with its price and its length, before anything
              can be bought. One is always selected and it is the one the
              button names - so what is charged was on screen first.
            */}
            {canBuy && plans.length > 1 ? (
              <View style={styles.plans}>
                {plans.map((plan) => {
                  const on = plan.id === picked?.id;
                  const save = savingPercent(plan, plans);
                  return (
                    <Pressable
                      key={plan.id}
                      onPress={() => setPickedId(plan.id)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${planName(plan)}, ${planLine(plan)}`}
                      style={[styles.plan, on && styles.planOn]}
                    >
                      <View style={[styles.radio, on && styles.radioOn]}>
                        {on ? <View style={styles.radioDot} /> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planName}>{planName(plan)}</Text>
                        {plan.trialDays ? (
                          <Text style={styles.planTrial}>
                            {plan.trialDays} day{plan.trialDays === 1 ? '' : 's'} free first
                          </Text>
                        ) : null}
                      </View>
                      {save ? <Badge label={`SAVE ${save}%`} tone="good" /> : null}
                      <Text style={styles.planPrice}>{planLine(plan)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Button
              label={
                entitlement.pro ? 'You have Pro'
                  : canBuy && picked ? ctaLabel(picked) : 'Not available yet'
              }
              kind="primary"
              onPress={() => { if (picked) onSubscribe(picked.id); }}
              disabled={busy || !canBuy}
            />
            {canBuy && picked ? (
              <Text style={styles.terms}>{termsLine(picked)}</Text>
            ) : null}
            {!canBuy && !entitlement.pro ? (
              <Text style={styles.pending}>
                {storeReady
                  ? 'The store has not listed a plan yet. Try again in a moment.'
                  : 'Purchases are not connected in this build.'}
                {' '}Everything you have scanned is yours and stays on this phone
                either way.
              </Text>
            ) : null}
          </View>

          {reason === 'welcome' ? (
            <Button
              label={`Not now - ${entitlement.freeLeft} free scans today`}
              kind="quiet"
              onPress={onClose}
              disabled={busy}
            />
          ) : null}

          <Pressable onPress={onRestore} disabled={busy} style={styles.restore}>
            <Text style={styles.restoreText}>Restore purchases</Text>
          </Pressable>

          {/* Required beside a subscription, and reachable before buying one. */}
          <View style={styles.legal}>
            <Pressable onPress={() => void Linking.openURL(TERMS_URL)} hitSlop={8}>
              <Text style={styles.legalText}>Terms of Use</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} hitSlop={8}>
              <Text style={styles.legalText}>Privacy Policy</Text>
            </Pressable>
          </View>

          {/*
            Said once, plainly. Recognition and prices are on the device; the
            limit is on how many cards may be added, not on the app working.
          */}
          <Text style={styles.note}>
            Scanning happens on this phone. Nothing is uploaded, and your
            collection stays yours whether you pay or not.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(3,5,10,0.68)' },
  sheet: {
    backgroundColor: c.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: c.line,
    paddingHorizontal: s.lg, paddingTop: s.sm,
    maxHeight: '92%',
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
  title: { ...t.title, fontSize: 24, color: c.text, paddingRight: 34 },
  sub: { ...t.meta, color: c.dim, marginTop: 5, lineHeight: 19 },

  state: {
    backgroundColor: c.surface, borderRadius: r.md, borderWidth: 1, borderColor: c.lineSoft,
    padding: s.md, marginTop: s.lg, gap: 7,
  },
  stateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stateLabel: { ...t.meta, color: c.dim },
  stateValue: { ...t.money, color: c.text },

  option: {
    backgroundColor: c.surface, borderRadius: r.lg, borderWidth: 1, borderColor: c.lineSoft,
    padding: s.lg, marginTop: s.md, gap: s.sm,
  },
  pro: { borderColor: c.accentLine, backgroundColor: c.accentWash, ...shadow.low },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  optionTitle: { ...t.subtitle, color: c.text, flex: 1 },
  proTitle: { ...t.title, color: c.text, flex: 1 },
  optionSub: { ...t.meta, color: c.dim, lineHeight: 18 },
  point: { flexDirection: 'row', alignItems: 'center', gap: s.sm },
  pointText: { ...t.meta, color: c.text },

  packs: { flexDirection: 'row', gap: s.sm },
  pack: {
    flex: 1, alignItems: 'center', paddingVertical: s.md, borderRadius: r.md,
    backgroundColor: c.surfaceHi, borderWidth: 1, borderColor: c.line,
  },
  packCredits: { ...t.title, color: c.text },
  packLabel: { ...t.tiny, color: c.faint, marginTop: -2 },
  packPrice: { ...t.money, color: c.accent, marginTop: 5 },
  pending: { ...t.tiny, color: c.faint, textAlign: 'center', lineHeight: 15 },
  plans: { gap: s.sm, marginTop: s.xs },
  plan: {
    flexDirection: 'row', alignItems: 'center', gap: s.sm,
    paddingVertical: s.md, paddingHorizontal: s.md, borderRadius: r.md,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  planOn: { borderColor: c.accent, backgroundColor: c.surfaceHi },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.faint,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: c.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
  planName: { ...t.subtitle, fontSize: 15, color: c.text },
  planTrial: { ...t.tiny, color: c.good, marginTop: 1 },
  planPrice: { ...t.money, color: c.text },
  // Not `faint`: this is the sentence that says what is charged, and it has to
  // be readable, not merely present.
  terms: { ...t.tiny, fontWeight: '500', color: c.dim, textAlign: 'center', lineHeight: 16 },
  legal: { flexDirection: 'row', justifyContent: 'center', gap: s.sm, paddingBottom: s.md },
  legalText: { ...t.tiny, color: c.dim, textDecorationLine: 'underline' },
  legalDot: { ...t.tiny, color: c.faint },
  restore: { paddingVertical: s.md, alignItems: 'center' },
  restoreText: { ...t.meta, color: c.dim },
  note: {
    ...t.tiny, color: c.faint, textAlign: 'center', lineHeight: 16, paddingHorizontal: s.md,
  },
});
