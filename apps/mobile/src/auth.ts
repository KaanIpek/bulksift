/**
 * Accounts, for the one thing that actually needs one: a collection on two
 * devices.
 *
 * Everything else works signed out and stays that way. Recognition, prices,
 * collections, the allowance and every purchase are on the device - so the
 * account is a convenience laid on top, and the app has to be completely usable
 * without one. That is not a principle borrowed from somewhere; it is what
 * makes this app work at a card show with no signal.
 *
 * `@supabase/supabase-js` is plain JavaScript over fetch, so it costs no native
 * module. Sign in with Apple does need one, and Apple requires it: an app that
 * offers any third-party or social sign-in must offer theirs too. Email is
 * offered as well, because an account tied to one Apple ID is a poor way to
 * move a collection to an Android phone later.
 *
 * Both are loaded lazily so the web build and the Node suite never touch them.
 */

import { Platform } from 'react-native';

import { appleAuthSdk } from './native';

/**
 * Where the project lives.
 *
 * The key is Supabase's *publishable* key, which is meant to ship inside the
 * app - it identifies the project and authorises nothing on its own. Row-level
 * security is what actually protects the data: the `collections` table has RLS
 * on with a policy of `auth.uid() = user_id`, so this key can only ever reach
 * rows belonging to whoever is signed in.
 *
 * The *secret* key is the dangerous one. It bypasses RLS entirely and must
 * never appear in the app, in this repo, or in a build log.
 */
export const SUPABASE_URL: string | null = 'https://jyauggpngoihtpqlnsme.supabase.co';
export const SUPABASE_ANON_KEY: string | null =
  'sb_publishable_gQywwHQ7UoxXkcDkz6osxg_tm6ha6WD';

export interface Account {
  id: string;
  email: string | null;
  /** How they signed in, for the settings screen to say something true. */
  provider: 'apple' | 'email';
}

export type AuthState = 'unavailable' | 'signed-out' | 'signed-in';

export interface AuthResult {
  ok: boolean;
  account?: Account;
  /** Absent when the user simply backed out of the Apple sheet. */
  reason?: string;
  cancelled?: boolean;
}

const NOT_CONFIGURED = 'Accounts are not connected in this build yet.';

type SupabaseClient = import('@supabase/supabase-js').SupabaseClient;

let client: SupabaseClient | null = null;
let account: Account | null = null;

/**
 * The Supabase client, built once.
 *
 * The session is kept in AsyncStorage rather than memory so signing in survives
 * the app being closed, and `detectSessionInUrl` is off because there is no URL
 * to detect one in on a phone - leaving it on makes the client reach for
 * browser globals that do not exist.
 */
function db(): SupabaseClient | null {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { createClient } = require('@supabase/supabase-js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const storage = require('@react-native-async-storage/async-storage').default;
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }) as SupabaseClient;
    return client;
  } catch {
    return null;
  }
}

export function authState(): AuthState {
  if (!db()) return 'unavailable';
  return account ? 'signed-in' : 'signed-out';
}

export const currentAccount = (): Account | null => account;

/** Pick up an existing session at launch. Never blocks anything. */
export async function restoreSession(): Promise<Account | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    account = {
      id: user.id,
      email: user.email ?? null,
      provider: user.app_metadata?.provider === 'apple' ? 'apple' : 'email',
    };
    return account;
  } catch {
    return null;
  }
}

/**
 * Sign in with Apple.
 *
 * The identity token from Apple is handed to Supabase, which verifies it
 * against Apple's keys - the app never sees a password and never holds one.
 */
export async function signInWithApple(): Promise<AuthResult> {
  const c = db();
  if (!c) return { ok: false, reason: NOT_CONFIGURED };
  if (Platform.OS !== 'ios') return { ok: false, reason: 'Only on iOS.' };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const apple = appleAuthSdk<any>();
    if (!apple) return { ok: false, reason: NOT_CONFIGURED };
    const credential = await apple.signInAsync({
      requestedScopes: [
        apple.AppleAuthenticationScope.FULL_NAME,
        apple.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      return { ok: false, reason: 'Apple did not return an identity token.' };
    }
    const { data, error } = await c.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error || !data.user) return { ok: false, reason: error?.message ?? 'Sign-in failed.' };
    account = { id: data.user.id, email: data.user.email ?? null, provider: 'apple' };
    return { ok: true, account };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // Backing out of the Apple sheet is not an error and must not raise one.
    if (err.code === 'ERR_REQUEST_CANCELED') return { ok: false, cancelled: true };
    return { ok: false, reason: err.message ?? 'Sign-in failed.' };
  }
}

/**
 * Email sign-in, by one-time code.
 *
 * A code rather than a magic link: a link has to come back into the app through
 * a custom URL scheme, which is a whole class of failure - mail clients that
 * strip it, a link opened on the wrong device - for no benefit over six digits
 * that can be typed anywhere.
 */
export async function sendEmailCode(email: string): Promise<AuthResult> {
  const c = db();
  if (!c) return { ok: false, reason: NOT_CONFIGURED };
  try {
    const { error } = await c.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'Could not send the code.' };
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  const c = db();
  if (!c) return { ok: false, reason: NOT_CONFIGURED };
  try {
    const { data, error } = await c.auth.verifyOtp({
      email: email.trim(), token: code.trim(), type: 'email',
    });
    if (error || !data.user) return { ok: false, reason: error?.message ?? 'That code did not work.' };
    account = { id: data.user.id, email: data.user.email ?? null, provider: 'email' };
    return { ok: true, account };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'That code did not work.' };
  }
}

export async function signOut(): Promise<void> {
  const c = db();
  account = null;
  if (!c) return;
  try { await c.auth.signOut(); } catch { /* the local session is already gone */ }
}

/**
 * Delete the account and everything synced with it.
 *
 * Required by App Review of any app that lets someone create an account, and it
 * has to be reachable from inside the app rather than by writing to support.
 *
 * The collection on the device is deliberately left alone. Deleting the account
 * removes the copy on the server, not the cards someone spent hours scanning -
 * conflating those two would be the worst possible reading of "delete my
 * account".
 */
export async function deleteAccount(): Promise<AuthResult> {
  const c = db();
  if (!c || !account) return { ok: false, reason: NOT_CONFIGURED };
  try {
    // A user cannot delete themselves with an anon key, so this calls an edge
    // function that does it with the service role and cascades the rows.
    const { error } = await c.functions.invoke('delete-account');
    if (error) return { ok: false, reason: error.message };
    await signOut();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'Could not delete the account.' };
  }
}

/** The client, for the sync layer. Null when there is no project or no session. */
export function authed(): SupabaseClient | null {
  return account ? db() : null;
}
