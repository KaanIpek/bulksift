# App Store listing - BulkSift

**The copy lives in `tools/store_listing.py`**, which checks every length limit,
checks that no keyword repeats a word from the name or subtitle, and with
`--write` drafts it to App Store Connect through the API and reads back what was
stored. Written there on 2026-11-24: name, subtitle, keywords, promotional text,
description, review notes and contact, categories (Reference, then Utilities),
age rating (4+, advertising: yes), privacy / support / marketing URLs, copyright.
Nothing was submitted.

## Why the listing says "scanner" again (2026-11-24)

The 16 November repositioning called "scanner" a lost position and led with
"sorting station". Measured against the App Store itself, that was half wrong:

- The search "pokemon bulk" is empty: the first result has 16 ratings after
  three years. Nobody types the word this app was going to be found by.
- The scanner searches are where the people are, and newcomers still get in:
  several apps released since 2025 hold 3,000-25,000 ratings.
- But ratings are not revenue, and those newcomers did not get there by search.
  Every one whose growth could be traced runs paid Meta ads (HoloDex ~590 ads,
  FoilSnap ~120, Acorn ~64), behind an onboarding paywall with a weekly plan.
  Of ~36 scanner apps released since 2025, ~22 have under 110 ratings.
- In ~500 recent reviews per incumbent, bulk scanning comes up 2-12 times. It
  is a reason to prefer an app, not a reason to go looking for one.

So: the name carries the search term ("TCG Card Scanner", which is what the
category calls itself, and no rights holder's mark), the subtitle carries the
difference (sorting by price, hands-free), and "pokemon" sits only in the hidden
keyword field. **That last one is a judgement call for the owner**: almost every
rival does it and no rejection over it was found, but it is someone else's mark.
Dropping it is a one-word edit.

## What is still missing before this can be submitted

- **Screenshots**, 6.9" (1320 x 2868) and 6.5" (1242 x 2688), from the phone.
  The list is below. Keep real card artwork out of the first two: the surviving
  apps blur the card or show an invented one.
- ~~A review screenshot for each of the five products.~~ Done 2026-11-24: all
  five are `READY_TO_SUBMIT`. The picture is the browser render in
  `docs/review/` scaled to 1242 x 2688 (Apple refuses any size that is not a
  device screenshot size, with `IMAGE_INCORRECT_DIMENSIONS`). It shows the real
  screen with the US prices typed in, and "Not available yet" on the video
  button because there are no ads in a browser. **Replace it with a phone
  capture before submitting** if the phone's paywall looks any different.
  The screenshot was not the only thing missing - see `docs/SETUP.md`.
- **Content rights declaration** - the question is whether the app shows
  third-party content and whether the owner has the right to. It shows card
  pictures. That answer is the owner's to give, so it was left blank.
- **A build attached to the version.** It must be 139 or later. Build 138 has a
  subscribe button with no price on it ("Go Pro"), which guideline 3.1.2
  rejects; 139 shows each plan's price and period, the renewal sentence, and
  Terms / Privacy links. `docs/review/paywall-web-preview.jpg` is a browser
  render of that screen with sample prices - a stand-in for looking at, not the
  review screenshot, which should come from the phone with the store's prices.
- **The App Privacy questionnaire** below; it has no public API.

## Name, subtitle, promotional text, description, keywords

In `tools/store_listing.py`. Two rules it enforces that are easy to break by hand:

- **Do not repeat a name or subtitle word in the keywords.** Apple indexes those
  two fields on their own, and a repeat wastes a slot.
- **Every claim is a claim about the code.** While writing this version the old
  line "Several collections, so bulk, keepers and trade stock stay apart" turned
  out to be a Pro feature (`CollectionBar.tsx`: a free user gets one), and the
  card count was a rebuild out of date. No numbers in the copy that a rebuild or
  a pricing change would falsify.

## Support URL / Marketing URL

Required. A single static page is enough; App Review rejects a placeholder or a
404. Needs a contact route on it.

## Age rating

4+. No user-generated content, no chat, no gambling, no purchases of physical
goods. The rewarded video is an ad, which the questionnaire asks about
separately - answer yes to "third-party advertising".

---

## Privacy — App Privacy questionnaire

Answer honestly and narrowly. The app is unusual in how little it takes, which
is worth stating plainly rather than hedging.

| Data type | Collected | Linked to user | Tracking | Why |
|---|---|---|---|---|
| Photos or video (camera) | No | - | - | Frames are recognised in memory and discarded. Nothing is written or sent. |
| Email address | Yes, optional | Yes | No | Only if the user makes an account to sync collections. |
| User content (collection) | Yes, optional | Yes | No | Only with an account, to sync between devices. |
| Purchases | Yes | Yes | No | Handled by RevenueCat for subscription state. |
| Identifiers (IDFA) | Yes | No | **Yes** | The rewarded ad SDK. This one makes App Tracking Transparency mandatory. |
| Diagnostics | No | - | - | No analytics or crash SDK is linked. |

The camera row is the one people get wrong. Answer **No** for photo collection:
the frames never leave the buffer. Say so in the review notes too.

### App Tracking Transparency

Required because of the ad SDK, not because of anything the app does with the
camera. The prompt must appear before any ad request, and the purpose string
should be honest about the exchange:

```
Allow tracking so the free scan videos can show relevant ads. Declining does not
reduce the scans you earn - the ads are just less relevant.
```

That is true, and it has to stay true: rewards must not depend on the answer.

---

## Review notes

In `tools/store_listing.py` (`REVIEW_NOTES`). They tell the reviewer how to test
without owning a card: Settings > Diagnostics > Run engine self-test.

---

## Screenshots

Required: 6.9" (1320 x 2868) and 6.5" (1242 x 2688). Everything else is
inherited by App Store Connect.

Six frames, in this order. The first two are what most people ever see.

1. **Scanning, mid-pile** — the card under the reticle, the feed filling
   underneath. Caption: *Pass the pile under your phone.*
2. **A collection with a total** — real cards, a real number. Caption:
   *Every card priced, on the device.*
3. **The scan feed being corrected** — a row mid-swap to its runner-up.
   Caption: *Wrong call? One tap to fix it.*
4. **Card detail** — art, set, variants, price history. Caption:
   *Variants and market prices for each.*
5. **Several collections** — bulk, keepers, trade. Caption:
   *Keep bulk and keepers apart.*
6. **Offline** — the same scan with airplane mode on in the status bar.
   Caption: *Works with no signal at all.*

Number 6 is the one competitors cannot copy, so it is worth a slot even though
"works offline" sounds like a footnote.

---

## Already done, despite what this file used to say

The five products exist in App Store Connect with names and prices, RevenueCat
is connected, and AdMob has a real rewarded unit. See `docs/SETUP.md`.
