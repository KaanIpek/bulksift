# Connecting the services

Four things the app is wired for and cannot reach yet. Each one is a key in a
file in this repo, and each one is set to `null` on purpose: the app checks, and
every screen says "Not connected" rather than showing a button that fails.

Nothing here can be done from this repo. All four need an account, a browser and
a card on file, so this is the list of what to click and where the result goes.

Order matters only in one place: **AdMob before submitting to review.** The app
currently ships Google's test unit, which serves test ads. Shipping that to the
store is against AdMob's terms.

---

## 1. RevenueCat — Pro and scan credits

**Why:** the paywall, the credit packs and "Restore purchases" are all real code
already. Without a key, `storeState()` returns `unavailable` and they say so.

### In App Store Connect

Create the products first; RevenueCat imports them and cannot invent them.

| Product ID | Type | Suggested price |
|---|---|---|
| `com.rldgames.bulksift.credits.200` | Consumable | $1.99 |
| `com.rldgames.bulksift.credits.1000` | Consumable | $5.99 |
| `com.rldgames.bulksift.credits.5000` | Consumable | $14.99 |
| `com.rldgames.bulksift.pro.monthly` | Auto-renewable subscription | $4.99 |
| `com.rldgames.bulksift.pro.yearly` | Auto-renewable subscription | $29.99 |

The credit ids are not free choices — they are the keys of `CREDIT_PACKS` in
[`apps/mobile/src/store.ts`](../apps/mobile/src/store.ts). Change one, change
both.

Subscriptions need a **subscription group**; put monthly and yearly in the same
one so people can move between them without cancelling.

### In RevenueCat

1. New project, iOS app, bundle id `com.rldgames.bulksift`.
2. Upload the App Store Connect **in-app purchase key** (a `.p8`, from Users and
   Access > Integrations). This is what lets RevenueCat verify receipts.
3. Create an entitlement with the identifier **`pro`** — exactly that string;
   `PRO_ENTITLEMENT` in `store.ts` reads it — and attach both subscriptions.
4. Create an offering containing both subscriptions.
5. Copy the **public SDK key for Apple** (starts `appl_`).

### Then here

```ts
// apps/mobile/src/store.ts
export const REVENUECAT_IOS_KEY: string | null = 'appl_xxxxxxxxxxxxxxxxxxxx';
```

Public by design — it identifies the app, it does not authorise anything. The
`.p8` is the secret and it never leaves RevenueCat.

---

## 2. AdMob — rewarded video

**Why:** ten scans per video, up to five videos a day. The reward is granted only
on `EARNED_REWARD`, never on the ad closing, so skipping pays nothing.

1. AdMob > Apps > Add app > iOS, bundle id `com.rldgames.bulksift`.
2. Ad units > **Rewarded**. Name it anything; copy the unit id.
3. Copy the **App ID** too — the format is `ca-app-pub-…~…`, with a tilde, and
   it is different from the unit id, which uses a slash.

```ts
// apps/mobile/src/ads.ts
export const REWARDED_UNIT_ID: string | null = 'ca-app-pub-…/…';
```

```json5
// apps/mobile/app.json — under plugins, react-native-google-mobile-ads
"iosAppId": "ca-app-pub-…~…"
```

Then link a payment profile in AdMob, or the unit serves nothing.

**App Tracking Transparency** becomes mandatory the moment this is live. The
prompt must appear before the first ad request, and the reward must not depend on
the answer - it does not, and it must stay that way.

---

## 3. Supabase — accounts and collection sync

**Why:** everything except sync works signed out, deliberately. This is only for
one collection on two devices.

1. New project. From Settings > API copy the **Project URL** and the **anon**
   key.

```ts
// apps/mobile/src/auth.ts
export const SUPABASE_URL: string | null = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY: string | null = 'eyJ…';
```

The anon key is meant to be in the app; row-level security is what protects the
data. The **service role** key must never go near it.

2. SQL editor, once:

```sql
create table collections (
  id         text primary key,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  body       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table collections enable row level security;

create policy "own rows" on collections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index collections_user on collections (user_id);
```

One row per collection, not per card: a bulk session touches hundreds of piles
and the merge needs the whole before-and-after at once, so per-card rows would
be hundreds of round trips to compute something that needs all of it anyway.

3. Authentication > Providers > **Apple**: on. Apple requires it in any app
   offering another sign-in method, and email is offered here.

   Needs a Services ID and a key from the Apple developer portal. Supabase's
   Apple page lists the exact fields.

4. Deploy the account-deletion function, which is in this repo:

```bash
supabase functions deploy delete-account
```

Without it the Delete account row fails, and an app that can make an account but
not delete one is rejected.

---

## 4. Somewhere to host `prices.json`

**Why:** so "Refresh prices now" has something to fetch. Until then the app uses
the snapshot baked into the build, which is correct but frozen.

The file is 1.73 MB, and **0.26 MB gzipped**. At 10,000 users refreshing daily
that is about 79 GB a month.

**Cloudflare R2** is the recommendation: zero egress fees, so the whole thing
costs cents for storage and nothing for traffic. A plain bucket with public read
is enough - there is no API, just a file.

```ts
// apps/mobile/src/pricesStore.ts
export const PRICE_HOST: string | null = 'https://prices.bulksift.app';
```

Two files go in the bucket, side by side:

- `prices.json` — the whole book.
- `prices-meta.json` — a few bytes carrying the same `updated` date.

The app fetches the manifest first and only pulls the book when that date has
moved, so a refresh that finds nothing new transfers almost nothing. Uploading
`prices.json` without updating the manifest means no device ever notices it.

Refresh the file with:

```bash
npm run prices
```

That rebuilds `prices.json` from public sources and syncs it into the app. Upload
the result plus the manifest beside it.

---

## What is deliberately not sold

Price freshness. It costs cents to serve, so gating it would be charging for
something that is free to give - and an app that shows stale prices to free users
is an app whose numbers cannot be trusted by anyone. Pro sells unlimited
scanning, unlimited collections and export.

---

## Checking

Each service reports itself in the app, so this needs no separate tooling:

- **Settings > Purchases** reads "Restore purchases" instead of "Not connected".
- **Settings > Account** offers Continue with Apple instead of "Sync — Not
  connected".
- **Settings > Prices** shows a date, and Refresh moves it.
- Ads: the scan screen offers a video when the daily free scans run out.
