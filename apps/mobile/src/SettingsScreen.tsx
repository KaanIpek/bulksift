/**
 * Settings: the account, what has been paid for, and the things Apple requires
 * to be reachable from inside the app.
 *
 * Three of these rows are not optional, and each one is a rejection on its own:
 * restoring purchases must not need a support email, an account that can be
 * created must be deletable in about the same number of taps, and a camera app
 * has to be testable by a reviewer who does not own a single card.
 *
 * Everything here degrades to a truthful sentence when its service is not
 * connected. A build with no RevenueCat key says so rather than showing a buy
 * button that fails, because a dead button is a worse answer than an honest one.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import {
  authState, currentAccount, deleteAccount, sendEmailCode, signInWithApple, signOut,
  verifyEmailCode, type Account,
} from './auth';
import { allowanceLabel, scansLeft, type Entitlement } from './entitlement';
import { freshness } from './prices';
import { restore, storeState } from './store';
import { c, shadow, t } from './ui/theme';
import { Button, Card, SectionLabel } from './ui/parts';
import { CheckIcon, ChevronIcon } from './ui/icons';

/** One tappable line. The whole row is the target, not the text inside it. */
function Row({
  label, value, onPress, tone, last,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: 'plain' | 'danger' | 'accent';
  last?: boolean;
}) {
  const body = (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={[
        styles.rowLabel,
        tone === 'danger' ? { color: c.bad } : null,
        tone === 'accent' ? { color: c.accent } : null,
      ]}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        {/*
          * Values are usually a word - "Free", "Pro", a date - but a sync
          * failure arrives here as a whole sentence from the server. Without a
          * shrink and a line cap that sentence pushes the label off the row.
          */}
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
        ) : null}
        {onPress ? <ChevronIcon size={14} color={c.faint} /> : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
      {body}
    </Pressable>
  );
}

export default function SettingsScreen({
  ent,
  priceUpdated,
  onRefreshPrices,
  refreshing,
  onOpenPaywall,
  onProChanged,
  onSync,
  syncing,
  syncNote,
  onArmCapture,
  capturing,
  captureNote,
  showDiag,
  onToggleDiag,
  onRunSelfTest,
  selfTest,
}: {
  ent: Entitlement;
  priceUpdated: string;
  onRefreshPrices: () => void;
  refreshing: boolean;
  onOpenPaywall: () => void;
  onProChanged: (pro: boolean) => void;
  onSync: () => void;
  syncing: boolean;
  syncNote: string | null;
  onArmCapture: () => void;
  capturing: boolean;
  captureNote: string | null;
  showDiag: boolean;
  onToggleDiag: () => void;
  onRunSelfTest: () => void;
  selfTest: string[] | null;
}) {
  const [account, setAccount] = useState<Account | null>(currentAccount());
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const auth = authState();
  const left = scansLeft(ent);

  useEffect(() => { setAccount(currentAccount()); }, [auth]);

  const withBusy = useCallback(async (what: string, run: () => Promise<void>) => {
    setBusy(what);
    setNote(null);
    try { await run(); } finally { setBusy(null); }
  }, []);

  const onApple = () => withBusy('apple', async () => {
    const r = await signInWithApple();
    // Backing out of Apple's sheet is not a failure and must not read as one.
    if (r.cancelled) return;
    if (!r.ok) { setNote(r.reason ?? 'Sign-in failed.'); return; }
    setAccount(r.account ?? null);
    // Pull straight away: someone signing in on a second device expects their
    // collection to be there, not after the next time they background the app.
    onSync();
  });

  const onSendCode = () => withBusy('code', async () => {
    const r = await sendEmailCode(email);
    if (!r.ok) { setNote(r.reason ?? 'Could not send the code.'); return; }
    setCodeSent(true);
    setNote('Code sent to ' + email.trim() + '.');
  });

  const onVerify = () => withBusy('verify', async () => {
    const r = await verifyEmailCode(email, code);
    if (!r.ok) { setNote(r.reason ?? 'That code did not work.'); return; }
    setAccount(r.account ?? null);
    setCodeSent(false);
    setCode('');
    onSync();
  });

  /*
   * Deleting an account is irreversible, so it asks twice and says plainly what
   * survives: the cards on this phone. Someone who has spent an evening
   * scanning a bulk box must not be able to lose it by tapping the wrong row.
   */
  const onDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This removes your account and the synced copy of your collections.\n\n'
      + 'The cards on this phone stay exactly where they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void withBusy('delete', async () => {
            const r = await deleteAccount();
            if (!r.ok) { setNote(r.reason ?? 'Could not delete the account.'); return; }
            setAccount(null);
            setNote('Account deleted.');
          }),
        },
      ],
    );
  };

  const onRestore = () => withBusy('restore', async () => {
    const r = await restore();
    if (!r.ok) { setNote(r.reason ?? 'Nothing to restore.'); return; }
    onProChanged(!!r.pro);
    setNote(r.pro ? 'Pro restored.' : 'Nothing to restore on this Apple ID.');
  });

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h1}>Settings</Text>

      <SectionLabel>Scanning</SectionLabel>
      <Card style={styles.card}>
        <Row label="Plan" value={ent.pro ? 'Pro' : 'Free'} />
        <Row label="Scans left today" value={left == null ? 'Unlimited' : String(left)} />
        <Row
          label={ent.pro ? 'Manage Pro' : 'Get Pro'}
          onPress={onOpenPaywall}
          tone="accent"
          last
        />
      </Card>
      <Text style={styles.hint}>{allowanceLabel(ent)}</Text>

      <SectionLabel>Prices</SectionLabel>
      <Card style={styles.card}>
        <Row
          label="Last updated"
          value={priceUpdated ? freshness(priceUpdated, Date.now()) : '—'}
        />
        <Row
          label={refreshing ? 'Refreshing…' : 'Refresh prices now'}
          onPress={refreshing ? undefined : onRefreshPrices}
          tone="accent"
          last
        />
      </Card>
      <Text style={styles.hint}>
        Refreshing re-prices every card you have already scanned, not just the next one.
      </Text>

      <SectionLabel>Account</SectionLabel>
      {auth === 'unavailable' ? (
        <Card style={styles.card}>
          <Row label="Sync" value="Not connected" last />
        </Card>
      ) : account ? (
        <Card style={styles.card}>
          <Row
            label="Signed in"
            value={account.email ?? (account.provider === 'apple' ? 'Apple ID' : 'Account')}
          />
          <Row
            label="Sign out"
            onPress={() => void withBusy('out', async () => {
              await signOut();
              setAccount(null);
            })}
          />
          <Row
            label={syncing ? 'Syncing…' : 'Sync now'}
            value={syncNote ?? undefined}
            onPress={syncing ? undefined : onSync}
            tone="accent"
          />
          <Row
            label={busy === 'delete' ? 'Deleting…' : 'Delete account'}
            onPress={onDelete}
            tone="danger"
            last
          />
        </Card>
      ) : (
        <Card style={styles.card}>
          {Platform.OS === 'ios' ? (
            <View style={styles.pad}>
              <Button
                label={busy === 'apple' ? 'Signing in…' : 'Continue with Apple'}
                onPress={onApple}
                kind="primary"
                disabled={busy != null}
                grow
              />
            </View>
          ) : null}
          <View style={styles.pad}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={c.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
            />
            {codeSent ? (
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor={c.faint}
                keyboardType="number-pad"
                style={[styles.input, { marginTop: 8 }]}
              />
            ) : null}
            <View style={{ height: 8 }} />
            <Button
              label={codeSent
                ? (busy === 'verify' ? 'Checking…' : 'Sign in')
                : (busy === 'code' ? 'Sending…' : 'Email me a code')}
              onPress={codeSent ? onVerify : onSendCode}
              disabled={busy != null || (codeSent ? code.length < 4 : !email.includes('@'))}
              grow
            />
          </View>
        </Card>
      )}
      <Text style={styles.hint}>
        An account only syncs collections between devices. Scanning, prices and everything
        else works signed out, with no signal.
      </Text>

      <SectionLabel>Purchases</SectionLabel>
      <Card style={styles.card}>
        <Row
          label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          onPress={storeState() === 'ready' ? onRestore : undefined}
          value={storeState() === 'ready' ? undefined : 'Not connected'}
          last
        />
      </Card>

      <SectionLabel>Diagnostics</SectionLabel>
      <Card style={styles.card}>
        {/*
          * Here so App Review can test recognition without owning a card. It
          * replays frames bundled in the app through the real engine, which
          * also makes it the fastest way to tell a broken install from bad
          * light.
          */}
        <Row
          label="Engine readout on the scan screen"
          value={showDiag ? 'On' : 'Off'}
          onPress={onToggleDiag}
        />
        <Row
          label="Run engine self-test"
          onPress={onRunSelfTest}
          tone="accent"
        />
        {/*
          * Saves the card exactly as the engine rectified it, so a read that
          * fails on a real table can be measured rather than guessed at. Four
          * theories about why shiny cards are hard were each tested against
          * synthetic frames and each was either fixed or refuted; the gap that
          * is left only exists on real cards.
          */}
        <Row
          label={capturing ? 'Point at the card…' : 'Capture a failing read'}
          value={captureNote ?? undefined}
          onPress={capturing ? undefined : onArmCapture}
          tone="accent"
          last={!selfTest}
        />
        {selfTest ? (
          <View style={styles.testOut}>
            {selfTest.map((line, i) => (
              <Text key={i} style={styles.mono} numberOfLines={1}>{line}</Text>
            ))}
          </View>
        ) : null}
      </Card>
      <Text style={styles.hint}>
        Replays card frames bundled in the app. No camera and no cards needed.
      </Text>

      <SectionLabel>About</SectionLabel>
      <Card style={styles.card}>
        {/*
          * Points at the page that actually exists rather than at a domain that
          * has not been bought. App Review follows this link, and a 404 here is
          * a rejection on its own.
          */}
        <Row
          label="Privacy policy"
          onPress={() => void Linking.openURL('https://kaanipek.github.io/bulksift/privacy.html')}
        />
        <Row
          label="Support"
          onPress={() => void Linking.openURL('https://kaanipek.github.io/bulksift/support.html')}
        />
        <Row
          label="Terms of use"
          onPress={() => void Linking.openURL(
            'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
          )}
          last
        />
      </Card>

      {note ? (
        <View style={styles.note}>
          <CheckIcon size={14} color={c.dim} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}

      {/*
       * The trademark line. It belongs in the app and not only on the store
       * page: the rights holders are active about this, and the sentence costs
       * nothing.
       */}
      <Text style={styles.legal}>
        BulkSift is not affiliated with, endorsed by, or sponsored by Nintendo, Creatures Inc.,
        GAME FREAK inc., The Pok&eacute;mon Company, or Wizards of the Coast. All card names,
        images and trademarks are the property of their respective owners. Prices are estimates
        gathered from public sources and are not offers to buy or sell.
      </Text>
      <View style={{ height: 28 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  h1: { ...t.hero, color: c.text, marginBottom: 18 },
  card: { padding: 0, marginBottom: 6, ...shadow.low },
  pad: { padding: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { ...t.body, color: c.text, flexShrink: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  rowValue: { ...t.meta, color: c.dim, flexShrink: 1, textAlign: 'right' },
  input: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: c.text,
    ...t.body,
  },
  hint: { ...t.meta, color: c.faint, marginTop: 2, marginBottom: 18, lineHeight: 17 },
  testOut: { paddingHorizontal: 14, paddingBottom: 12, gap: 3 },
  mono: { ...t.tiny, color: c.dim, fontVariant: ['tabular-nums'] },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  noteText: { ...t.meta, color: c.dim, flexShrink: 1 },
  legal: { ...t.tiny, color: c.faint, lineHeight: 16, marginTop: 22 },
});
